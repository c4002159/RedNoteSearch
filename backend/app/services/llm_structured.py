"""Ask a model for JSON that must match a schema, with a bounded number of corrective retries.

Model output is never trusted: it is parsed and validated against a pydantic model. When it does not
validate, the model is shown a short description of the problem and asked again, at most
``max_attempts`` calls in total. After that ``LlmOutputError`` is raised (no endless loops, TC-018).
"""

import json
import re
from dataclasses import dataclass

from pydantic import BaseModel, ValidationError

from app.ports.llm import LlmClient, LlmMessage, LlmRequest, LlmResponse
from app.services.errors import ServiceError

_FENCE = re.compile(r"^```(?:json)?\s*(.*?)\s*```$", re.DOTALL | re.IGNORECASE)


class LlmOutputError(ServiceError):
    """The model kept returning output that does not match the expected schema."""


@dataclass(frozen=True)
class StructuredResult[T: BaseModel]:
    value: T
    responses: tuple[LlmResponse, ...]

    @property
    def attempts(self) -> int:
        return len(self.responses)


def extract_json_text(text: str) -> str:
    """Strip Markdown fences and any prose around the outermost JSON object."""
    stripped = text.strip()
    fenced = _FENCE.match(stripped)
    if fenced:
        stripped = fenced.group(1).strip()
    start, end = stripped.find("{"), stripped.rfind("}")
    if start != -1 and end > start:
        return stripped[start : end + 1]
    return stripped


def _problem(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        parts = [
            f"{'.'.join(str(p) for p in e['loc']) or 'root'}: {e['msg']}"
            for e in exc.errors()[:5]
        ]
        return "; ".join(parts)
    return "the answer was not valid JSON"


def generate_structured[T: BaseModel](
    client: LlmClient,
    request: LlmRequest,
    schema: type[T],
    *,
    max_attempts: int = 3,
) -> StructuredResult[T]:
    """Call the model until its answer validates against ``schema``.

    ``ModelUnavailableError`` from the client is not caught here: an unreachable model is a different
    failure from a malformed answer and must reach the caller.
    """
    messages = list(request.messages)
    responses: list[LlmResponse] = []
    problem = ""
    for _ in range(max(1, max_attempts)):
        response = client.complete(
            LlmRequest(
                messages=tuple(messages),
                temperature=request.temperature,
                max_tokens=request.max_tokens,
                json_mode=True,
                purpose=request.purpose,
            )
        )
        responses.append(response)
        try:
            value = schema.model_validate(json.loads(extract_json_text(response.text)))
        except (ValidationError, ValueError) as exc:
            problem = _problem(exc)
            messages += [
                LlmMessage("assistant", response.text),
                LlmMessage(
                    "user",
                    f"Your last answer was rejected: {problem}. "
                    "Reply again with a single JSON object that matches the requested format, "
                    "and nothing else.",
                ),
            ]
            continue
        return StructuredResult(value=value, responses=tuple(responses))
    raise LlmOutputError(
        f"The model did not return valid structured output after {len(responses)} attempts ({problem})"
    )

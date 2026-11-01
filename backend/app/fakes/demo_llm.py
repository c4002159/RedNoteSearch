"""A text-matching stand-in for the chat model, for demos and tests that have no API key.

It is switched on with ``LLM_MODE=demo_fake`` and is never the default. It writes the note by copying
sentences out of the retrieved sources and "judges" a claim by looking for it in the sources, so the
whole flow (generate, evidence, risk hints) can be walked through. It says nothing about how a real
model behaves: the model name on every version is ``demo-fake`` so a result is never mistaken for one.
"""

import json
import re
from decimal import Decimal

from app.ports.llm import LlmRequest, LlmResponse, LlmUsage

MODEL_NAME = "demo-fake"
_SOURCE_LINE = re.compile(
    r"^\[(?P<ref>[^\]]+)\]（(?:已审核资料|任务资料，未审核)）(?P<text>.+)$",
    re.MULTILINE,
)
_PRODUCT = re.compile(r"^商品：(?P<name>[^（，\n]+)", re.MULTILINE)
_SENTENCE = re.compile(r"[^。！？\n]+[。！？]?")
_MAX_SENTENCES = 2
_MAX_SENTENCE_CHARS = 60


def _sentences(text: str) -> list[str]:
    found = [s.strip() for s in _SENTENCE.findall(text) if len(s.strip()) >= 6]
    return [s for s in found if len(s) <= _MAX_SENTENCE_CHARS]


def _generate(request: LlmRequest) -> str:
    prompt = "\n".join(m.content for m in request.messages if m.role == "user")
    product = _PRODUCT.search(prompt)
    name = product.group("name").strip() if product else "这款商品"
    picked: list[str] = []
    for match in _SOURCE_LINE.finditer(prompt):
        for sentence in _sentences(match.group("text")):
            if sentence not in picked:
                picked.append(sentence)
            if len(picked) >= _MAX_SENTENCES:
                break
        if len(picked) >= _MAX_SENTENCES:
            break
    body = "".join(s if s[-1] in "。！？" else s + "。" for s in picked)
    if not body:
        body = "演示用假模型：没有检索到资料，这里只写感受，不写事实。"
    return json.dumps(
        {
            "title_candidates": [f"{name}的日常感受"[:18]],
            "body": body,
            "hashtags": ["演示"],
            "cover_candidates": [name[:10]],
        },
        ensure_ascii=False,
    )


def _extract_claims(request: LlmRequest) -> str:
    text = request.messages[-1].content
    body = text.split("正文：\n", 1)[-1].split("\n\n标签：", 1)[0]
    return json.dumps(
        {"claims": [s for s in _sentences(body) if "演示用假模型" not in s]},
        ensure_ascii=False,
    )


def _judge(request: LlmRequest) -> str:
    text = request.messages[-1].content
    claim = text.split("说法：", 1)[-1].split("\n\n资料：", 1)[0].strip()
    stripped = claim.rstrip("。！？")
    for match in re.finditer(r"^\[(?P<ref>[^\]]+)\] (?P<text>.+)$", text, re.MULTILINE):
        if stripped and stripped in match.group("text"):
            return json.dumps(
                {
                    "verdict": "supported",
                    "source_ref": match.group("ref"),
                    "quote": stripped,
                    "rationale": "演示用假模型：资料里有同样的文字",
                },
                ensure_ascii=False,
            )
    return json.dumps(
        {
            "verdict": "insufficient",
            "source_ref": None,
            "quote": None,
            "rationale": "演示用假模型：资料里没有同样的文字",
        },
        ensure_ascii=False,
    )


_ANSWERS = {
    "generate": _generate,
    "claim_extraction": _extract_claims,
    "evidence_judgement": _judge,
    "compliance_context": lambda _r: json.dumps({"findings": []}),
}


class DemoLlmClient:
    """``LlmClient`` that answers by text matching. Purposes it does not know get ``{}``, which the
    structured-output layer rejects, so those steps end in their normal error state."""

    provider = "demo-fake"
    model = MODEL_NAME

    def complete(self, request: LlmRequest) -> LlmResponse:
        answer = _ANSWERS.get(request.purpose)
        return LlmResponse(
            text=answer(request) if answer else "{}",
            provider=self.provider,
            model=self.model,
            usage=LlmUsage(prompt_tokens=0, completion_tokens=0),
            latency_ms=1,
            cost=Decimal(0),
            price_version="demo-fake",
        )

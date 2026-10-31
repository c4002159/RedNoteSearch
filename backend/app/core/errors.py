"""Unified error responses (docs/API_CONTRACT.md, section 1.1).

Every error leaves the API as ``{"error": {"code", "message", "details", "request_id"}}``. The request id
comes from the ``X-Request-ID`` header when the client sends a sane one, otherwise it is generated, and it is
echoed in the ``X-Request-ID`` response header. Tracebacks, keys and raw model output are never returned.
"""

import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.services.errors import (
    ConflictError,
    InvalidInputError,
    InvalidStateError,
    ModelUnavailableError,
    NotFoundError,
    ParseError,
)

logger = logging.getLogger(__name__)

REQUEST_ID_HEADER = "X-Request-ID"
_VALID_REQUEST_ID = re.compile(r"^[A-Za-z0-9._-]{1,64}$")

# HTTP status -> error code. Codes such as INVALID_STATE or FILE_TOO_LARGE are raised explicitly by
# the code that knows the reason; this table is the fallback for plain HTTPException.
STATUS_CODES: dict[int, str] = {
    400: "BAD_REQUEST",
    401: "UNAUTHENTICATED",
    403: "FORBIDDEN",
    404: "NOT_FOUND",
    405: "METHOD_NOT_ALLOWED",
    409: "CONFLICT",
    422: "VALIDATION_ERROR",
    429: "RATE_LIMITED",
    503: "MODEL_UNAVAILABLE",
}


def get_request_id(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if not request_id:
        request_id = uuid.uuid4().hex
        request.state.request_id = request_id
    return str(request_id)


def error_response(
    request: Request,
    *,
    status_code: int,
    code: str,
    message: str,
    details: dict[str, Any] | None = None,
    headers: dict[str, str] | None = None,
) -> JSONResponse:
    request_id = get_request_id(request)
    response_headers = dict(headers or {})
    response_headers[REQUEST_ID_HEADER] = request_id
    return JSONResponse(
        status_code=status_code,
        content={
            "error": {
                "code": code,
                "message": message,
                "details": details or {},
                "request_id": request_id,
            }
        },
        headers=response_headers,
    )


def _http_exception_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, StarletteHTTPException)
    code = STATUS_CODES.get(exc.status_code, f"HTTP_{exc.status_code}")
    detail = exc.detail
    if isinstance(detail, str):
        message, details = detail, None
    else:  # a structured detail: keep it under details and use a generic message
        message, details = "Request failed", {"detail": detail}
    return error_response(
        request,
        status_code=exc.status_code,
        code=code,
        message=message,
        details=details,
        headers=dict(exc.headers) if exc.headers else None,
    )


def _validation_exception_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, RequestValidationError)
    errors = [
        {"loc": [str(part) for part in e["loc"]], "msg": e["msg"], "type": e["type"]}
        for e in exc.errors()
    ]
    return error_response(
        request,
        status_code=422,
        code="VALIDATION_ERROR",
        message="Request validation failed",
        details={"errors": errors},
    )


def _not_found_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, NotFoundError)
    return error_response(
        request, status_code=404, code="NOT_FOUND", message=exc.message
    )


def _conflict_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, ConflictError)
    return error_response(
        request, status_code=409, code="CONFLICT", message=exc.message
    )


def _invalid_state_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, InvalidStateError)
    return error_response(
        request, status_code=409, code="INVALID_STATE", message=exc.message
    )


def _invalid_input_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, InvalidInputError)
    return error_response(
        request, status_code=422, code="VALIDATION_ERROR", message=exc.message
    )


def _parse_error_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, ParseError)
    return error_response(
        request, status_code=422, code="PARSE_FAILED", message=exc.message
    )


def _model_unavailable_handler(request: Request, exc: Exception) -> Response:
    assert isinstance(exc, ModelUnavailableError)
    return error_response(
        request, status_code=503, code="MODEL_UNAVAILABLE", message=exc.message
    )


def _unhandled_exception_handler(request: Request, exc: Exception) -> Response:
    request_id = get_request_id(request)
    logger.error(
        "Unhandled exception (request_id=%s)", request_id, exc_info=exc
    )  # the traceback goes to the log only
    return error_response(
        request,
        status_code=500,
        code="INTERNAL_ERROR",
        message="Internal server error",
    )


def install_error_handling(app: FastAPI) -> None:
    @app.middleware("http")
    async def request_id_middleware(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get(REQUEST_ID_HEADER, "")
        request.state.request_id = (
            incoming if _VALID_REQUEST_ID.match(incoming) else uuid.uuid4().hex
        )
        response = await call_next(request)
        response.headers[REQUEST_ID_HEADER] = request.state.request_id
        return response

    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.add_exception_handler(RequestValidationError, _validation_exception_handler)
    app.add_exception_handler(NotFoundError, _not_found_handler)
    app.add_exception_handler(ConflictError, _conflict_handler)
    app.add_exception_handler(InvalidStateError, _invalid_state_handler)
    app.add_exception_handler(InvalidInputError, _invalid_input_handler)
    app.add_exception_handler(ParseError, _parse_error_handler)
    app.add_exception_handler(ModelUnavailableError, _model_unavailable_handler)
    app.add_exception_handler(Exception, _unhandled_exception_handler)

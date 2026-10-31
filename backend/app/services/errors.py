from typing import Any


class ServiceError(Exception):
    """Base class for errors raised by the service layer (mapped to HTTP responses in app.main)."""

    def __init__(self, message: str, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details = details or {}


class NotFoundError(ServiceError):
    """The requested resource does not exist."""


class ConflictError(ServiceError):
    """The request conflicts with the current state (duplicate, last admin, ...)."""


class InvalidStateError(ServiceError):
    """The resource is not in a state that allows the action (for example reviewing a non-pending document)."""


class ParseError(ServiceError):
    """An uploaded file could not be read or contains no usable text."""


class UnsupportedFileTypeError(ParseError):
    """The file's extension is not on the allow-list."""


class FileTooLargeError(ParseError):
    """The file is larger than the limit for its type (``details['limit_bytes']``)."""


class ModelUnavailableError(ServiceError):
    """A model provider could not be reached or returned an error."""


class InvalidInputError(ServiceError):
    """A value the request carried is not acceptable (for example an unsafe regular expression)."""


class InvalidModelOutputError(InvalidInputError):
    """Structural analysis remains invalid after its bounded correction attempt."""


class MaterialTooLongError(InvalidInputError):
    """Parsed task material exceeds the text limit."""


class MaterialLimitExceededError(InvalidInputError):
    """A task already contains the maximum number of material snapshots."""

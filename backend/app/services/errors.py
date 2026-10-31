class ServiceError(Exception):
    """Base class for errors raised by the service layer (mapped to HTTP responses in app.main)."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(ServiceError):
    """The requested resource does not exist."""


class ConflictError(ServiceError):
    """The request conflicts with the current state (duplicate, last admin, ...)."""

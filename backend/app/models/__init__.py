"""SQLModel models, split into modules by owner (ADR-001).

Every module that defines a table must be imported here, otherwise Alembic cannot see the table
(``alembic/env.py`` reads ``SQLModel.metadata`` from this package). Existing imports such as
``from app.models import User`` keep working.

Planned modules (add a module and import it below; each member writes the migrations of their own tables):

* member A: ``identity`` (this file set), ``catalog`` (brand, product, voice profile), ``knowledge``
* member B: ``generation``, ``compliance``, ``evaluation``
"""

from sqlmodel import SQLModel

from app.models.common import Message, get_datetime_utc
from app.models.identity import (
    NewPassword,
    Token,
    TokenPayload,
    UpdatePassword,
    User,
    UserBase,
    UserCreate,
    UserPublic,
    UserRegister,
    UsersPublic,
    UserUpdate,
    UserUpdateMe,
)

__all__ = [
    "Message",
    "NewPassword",
    "SQLModel",
    "Token",
    "TokenPayload",
    "UpdatePassword",
    "User",
    "UserBase",
    "UserCreate",
    "UserPublic",
    "UserRegister",
    "UserUpdate",
    "UserUpdateMe",
    "UsersPublic",
    "get_datetime_utc",
]

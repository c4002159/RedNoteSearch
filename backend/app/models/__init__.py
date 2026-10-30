"""SQLModel models, split into modules by owner (ADR-001).

Every module that defines a table must be imported here, otherwise Alembic cannot see the table
(``alembic/env.py`` reads ``SQLModel.metadata`` from this package). Existing imports such as
``from app.models import User`` keep working.

Modules:

* member A: ``identity`` (users, tokens), ``catalog`` (tenant, brand, brand members; product and voice
  profile come next), ``knowledge`` (documents, reviews, chunks)
* member B (to be added): ``generation``, ``compliance``, ``evaluation``
"""

from sqlmodel import SQLModel

from app.models.catalog import Brand, BrandCategory, BrandMember, MemberRole, Tenant
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
from app.models.knowledge import (
    EMBEDDING_DIMENSIONS,
    DocumentStatus,
    DocumentType,
    IndexStatus,
    KbChunk,
    KbDocument,
    KbReview,
    ReviewAction,
)

__all__ = [
    "EMBEDDING_DIMENSIONS",
    "Brand",
    "BrandCategory",
    "BrandMember",
    "DocumentStatus",
    "DocumentType",
    "IndexStatus",
    "KbChunk",
    "KbDocument",
    "KbReview",
    "MemberRole",
    "Message",
    "NewPassword",
    "ReviewAction",
    "SQLModel",
    "Tenant",
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

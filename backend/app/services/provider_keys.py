"""API keys and model lists set by a platform administrator in the web page.

Lookup order for a provider's key: the encrypted value in ``provider_credential``, then the server
``.env``. The key is encrypted with a Fernet key derived from ``SECRET_KEY``; changing ``SECRET_KEY``
makes stored keys unreadable, which is treated as "not set in the database" (the ``.env`` value, if any,
is used) and logged, never raised.
"""

import base64
import logging
import uuid

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.hkdf import HKDF
from sqlalchemy.exc import SQLAlchemyError
from sqlmodel import Session

from app.core.config import settings
from app.core.db import engine
from app.models import Provider, ProviderCredential, ProviderPublic
from app.models.common import get_datetime_utc
from app.services.audit import record_audit
from app.services.errors import ConflictError

logger = logging.getLogger(__name__)

PROVIDERS: tuple[Provider, ...] = ("deepseek", "dashscope")
LABELS = {"deepseek": "DeepSeek（生成、检查、评测）", "dashscope": "百炼（资料嵌入）"}


def _fernet() -> Fernet:
    derived = HKDF(
        algorithm=hashes.SHA256(),
        length=32,
        salt=None,
        info=b"provider-credentials-v1",
    ).derive(settings.SECRET_KEY.encode())
    return Fernet(base64.urlsafe_b64encode(derived))


def encrypt(plain: str) -> str:
    return _fernet().encrypt(plain.encode()).decode()


def decrypt(token: str) -> str | None:
    try:
        return _fernet().decrypt(token.encode()).decode()
    except InvalidToken:
        logger.warning(
            "A stored provider key cannot be decrypted (SECRET_KEY changed?)"
        )
        return None


def _env_key(provider: str) -> str | None:
    return {
        "deepseek": settings.DEEPSEEK_API_KEY,
        "dashscope": settings.DASHSCOPE_API_KEY,
    }[provider]


def _row(provider: str) -> ProviderCredential | None:
    try:
        with Session(engine) as session:
            return session.get(ProviderCredential, provider)
    except SQLAlchemyError:
        logger.warning(
            "Provider credentials could not be read; using .env", exc_info=True
        )
        return None


def resolve_key(provider: str) -> str | None:
    """The key to call the provider with, or ``None`` when neither the database nor ``.env`` has one."""
    row = _row(provider)
    if row is not None and row.encrypted_key:
        plain = decrypt(row.encrypted_key)
        if plain:
            return plain
    return _env_key(provider)


def configured_models() -> list[str] | None:
    """The DeepSeek model list set in the web page, or ``None`` to use ``.env``."""
    row = _row("deepseek")
    return row.models if row is not None and row.models else None


def mask(key: str) -> str:
    return key[-4:] if len(key) >= 8 else ""


def describe(session: Session, provider: Provider) -> ProviderPublic:
    row = session.get(ProviderCredential, provider)
    db_key = bool(row and row.encrypted_key and decrypt(row.encrypted_key))
    env_key = bool(_env_key(provider))
    models_db = bool(provider == "deepseek" and row and row.models)
    if models_db and row:
        models = list(row.models or [])
    else:
        models = list(settings.DEEPSEEK_MODELS) if provider == "deepseek" else []
    return ProviderPublic(
        provider=provider,
        label=LABELS[provider],
        key_source="database" if db_key else "env" if env_key else "none",
        key_hint=row.key_hint if db_key and row else None,
        models=models,
        models_source="database" if models_db else "env" if models else "none",
        updated_at=row.updated_at if row else None,
    )


def update(
    session: Session,
    *,
    provider: str,
    actor_id: uuid.UUID,
    api_key: str | None,
    models: list[str] | None,
) -> None:
    if models is not None and provider != "deepseek":
        raise ConflictError("Only DeepSeek has a configurable model list")
    row = session.get(ProviderCredential, provider) or ProviderCredential(
        provider=provider
    )
    changed: list[str] = []
    if api_key is not None:
        key = api_key.strip()
        row.encrypted_key = encrypt(key)
        row.key_hint = mask(key)
        changed.append("api_key")
    if models is not None:
        row.models = [m.strip() for m in models if m.strip()] or None
        changed.append("models")
    row.updated_by = actor_id
    row.updated_at = get_datetime_utc()
    session.add(row)
    record_audit(
        session,
        action="settings.provider.update",
        entity_type="provider_credential",
        actor_id=actor_id,
        detail={"provider": provider, "fields": changed},
    )
    session.commit()


def clear(session: Session, *, provider: str, actor_id: uuid.UUID) -> None:
    """Remove the stored key and model list so the server ``.env`` applies again."""
    row = session.get(ProviderCredential, provider)
    if row is not None:
        session.delete(row)
    record_audit(
        session,
        action="settings.provider.clear",
        entity_type="provider_credential",
        actor_id=actor_id,
        detail={"provider": provider},
    )
    session.commit()

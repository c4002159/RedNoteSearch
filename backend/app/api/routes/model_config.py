from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Path

from app.api.deps import CurrentUser, SessionDep, get_current_active_superuser
from app.models import (
    Message,
    Provider,
    ProviderPublic,
    ProvidersPublic,
    ProviderUpdate,
)
from app.services import provider_keys

router = APIRouter(
    prefix="/settings/providers",
    tags=["settings"],
    dependencies=[Depends(get_current_active_superuser)],
)
ProviderName = Annotated[Provider, Path(description="deepseek or dashscope")]


@router.get("", response_model=ProvidersPublic)
def read_providers(session: SessionDep) -> ProvidersPublic:
    """Where each provider's key and model list come from. The key itself is never returned."""
    return ProvidersPublic(
        items=[provider_keys.describe(session, p) for p in provider_keys.PROVIDERS]
    )


@router.put("/{provider}", response_model=ProviderPublic)
def update_provider(
    provider: ProviderName,
    body: ProviderUpdate,
    session: SessionDep,
    user: CurrentUser,
) -> ProviderPublic:
    """Platform administrators only. Stores the key encrypted; leave a field out to keep it."""
    if body.api_key is None and body.models is None:
        raise HTTPException(status_code=422, detail="Nothing to update")
    provider_keys.update(
        session,
        provider=provider,
        actor_id=user.id,
        api_key=body.api_key,
        models=body.models,
    )
    return provider_keys.describe(session, provider)


@router.delete("/{provider}", response_model=Message)
def clear_provider(
    provider: ProviderName, session: SessionDep, user: CurrentUser
) -> Message:
    """Forget the key and model list set here; the server ``.env`` applies again."""
    provider_keys.clear(session, provider=provider, actor_id=user.id)
    return Message(message="Cleared")

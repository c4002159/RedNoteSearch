from typing import Annotated

from fastapi import APIRouter, Query

from app.api.brand_deps import BrandAccessDep
from app.api.deps import SessionDep
from app.domain.tone import ToneSuggestions
from app.services.tone_suggestions import suggestions

router = APIRouter(tags=["tone"])


@router.get("/brands/{brand_id}/tone-suggestions", response_model=ToneSuggestions)
def read_tone_suggestions(
    access: BrandAccessDep,
    session: SessionDep,
    scene: Annotated[str | None, Query(min_length=1, max_length=20)] = None,
    limit: Annotated[int, Query(ge=1, le=20)] = 10,
) -> ToneSuggestions:
    """Scene filters task history and results; presets and structures remain brand-wide."""
    return suggestions(
        session=session, brand_id=access.brand_id, scene=scene, limit=limit
    )

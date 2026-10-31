from fastapi import APIRouter

from app.api.routes import (
    brands,
    compliance,
    evaluation,
    evidence,
    knowledge,
    login,
    private,
    products,
    rule_import,
    tasks,
    users,
    utils,
    versions,
    viral,
    voice_profile,
)
from app.core.config import settings

api_router = APIRouter()
api_router.include_router(login.router)
api_router.include_router(users.router)
api_router.include_router(utils.router)
api_router.include_router(brands.router)
api_router.include_router(products.router)
api_router.include_router(tasks.router)
api_router.include_router(evidence.router)
api_router.include_router(rule_import.router)
api_router.include_router(compliance.router)
api_router.include_router(evaluation.router)
api_router.include_router(versions.router)
api_router.include_router(knowledge.router)
api_router.include_router(voice_profile.router)
api_router.include_router(viral.router)


if settings.FASTAPI_ENV == "development":
    api_router.include_router(private.router)

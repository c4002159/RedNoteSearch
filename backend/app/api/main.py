from fastapi import APIRouter

from app.api.routes import (
    brands,
    compliance,
    creative_types,
    evaluation,
    evidence,
    extension,
    knowledge,
    login,
    model_config,
    private,
    products,
    results,
    rule_import,
    scenarios,
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
api_router.include_router(scenarios.router)
api_router.include_router(creative_types.router)
api_router.include_router(results.router)
api_router.include_router(extension.router)
api_router.include_router(evidence.router)
api_router.include_router(rule_import.router)
api_router.include_router(compliance.router)
api_router.include_router(evaluation.router)
api_router.include_router(versions.router)
api_router.include_router(knowledge.router)
api_router.include_router(voice_profile.router)
api_router.include_router(viral.router)
api_router.include_router(model_config.router)


if settings.FASTAPI_ENV == "development":
    api_router.include_router(private.router)

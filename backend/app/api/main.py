from fastapi import APIRouter

from app.api.routes import (
    brands,
    knowledge,
    login,
    private,
    products,
    tasks,
    users,
    utils,
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
api_router.include_router(knowledge.router)
api_router.include_router(voice_profile.router)


if settings.FASTAPI_ENV == "development":
    api_router.include_router(private.router)

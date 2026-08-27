from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api.routes import router
from .core.config import get_settings
from .core.migrations import run_migrations


@asynccontextmanager
async def lifespan(_app: FastAPI):
    run_migrations()
    yield


settings = get_settings()
if settings.environment.lower() == "production" and settings.secret_key == "change-this-secret-key-before-production":
    raise RuntimeError("SECRET_KEY must be replaced before running in production.")
app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)
app.include_router(router)


@app.get("/")
def root() -> dict[str, str]:
    return {"service": settings.app_name, "docs": "/docs"}

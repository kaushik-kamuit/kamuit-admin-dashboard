"""Kamuit Admin API — read-only aggregator across 3 Postgres DBs."""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.db import startup_pools, shutdown_pools
from app.routers import (
    auth, overview, users, drivers, rides, payments, preferences,
    analytics, driver_runs,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await startup_pools()
    try:
        yield
    finally:
        await shutdown_pools()


app = FastAPI(
    title="Kamuit Admin API",
    version="0.1.0",
    description="Read-only admin aggregator across user-management, kamuit-backend, and payment-backend.",
    lifespan=lifespan,
    # Avoid FastAPI's default 307 redirect when a trailing slash is missing:
    # most HTTP clients (axios included) strip the Authorization header on
    # redirects, which turned into "Missing token" 401s. We handle slash
    # tolerance explicitly where it matters.
    redirect_slashes=False,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(overview.router, prefix="/api/overview", tags=["overview"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(drivers.router, prefix="/api/drivers", tags=["drivers"])
app.include_router(rides.router, prefix="/api/rides", tags=["rides"])
app.include_router(preferences.router, prefix="/api/preferences", tags=["preferences"])
app.include_router(payments.router, prefix="/api/payments", tags=["payments"])
app.include_router(driver_runs.router, prefix="/api/driver-runs", tags=["driver_runs"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.ADMIN_API_HOST, port=settings.ADMIN_API_PORT, reload=True)

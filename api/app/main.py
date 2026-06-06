"""Kamuit Admin API — operations console across 3 Postgres DBs."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded

from app.config import settings
from app.db import startup_pools, shutdown_pools
from app.background import start_background_tasks, stop_background_tasks
from app.security import SecurityHeadersMiddleware, limiter
from app.routers import (
    auth, overview, users, drivers, rides, payments, preferences,
    analytics, driver_runs, operations,
    admin_users, audit_log, alerts, metrics, live, stripe_events,
    vehicle_review, cancellations, fraud, churn, exports,
    notifications, eta_tracking,
)
from app.routers.live import tracker

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await startup_pools()
    await tracker.start()
    start_background_tasks()
    try:
        yield
    finally:
        await stop_background_tasks()
        await tracker.stop()
        await shutdown_pools()


app = FastAPI(
    title="Kamuit Admin API",
    version="0.2.0",
    description="Operations console across user-management, kamuit-backend, and payment-backend.",
    lifespan=lifespan,
    redirect_slashes=False,
    docs_url="/api/docs" if settings.ENABLE_DOCS else None,
    redoc_url=None,
)

app.state.limiter = limiter

_allowed_origins = ["http://localhost:5173", "http://127.0.0.1:5173"]
if settings.CORS_EXTRA_ORIGINS:
    _allowed_origins.extend(o.strip() for o in settings.CORS_EXTRA_ORIGINS.split(",") if o.strip())

app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=_allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "Accept"],
)


@app.exception_handler(RateLimitExceeded)
async def _rate_limit_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
    return JSONResponse(
        status_code=429,
        content={"detail": "Too many requests. Please try again later."},
    )


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "ws_clients": str(tracker.count)}


# ── Existing routers ────────────────────────────────────────────────────────
app.include_router(auth.router, prefix="/api/auth", tags=["auth"])
app.include_router(overview.router, prefix="/api/overview", tags=["overview"])
app.include_router(users.router, prefix="/api/users", tags=["users"])
app.include_router(drivers.router, prefix="/api/drivers", tags=["drivers"])
app.include_router(rides.router, prefix="/api/rides", tags=["rides"])
app.include_router(preferences.router, prefix="/api/preferences", tags=["preferences"])
app.include_router(payments.router, prefix="/api/payments", tags=["payments"])
app.include_router(driver_runs.router, prefix="/api/driver-runs", tags=["driver_runs"])
app.include_router(analytics.router, prefix="/api/analytics", tags=["analytics"])
app.include_router(operations.router, prefix="/api/operations", tags=["operations"])

# ── New routers ─────────────────────────────────────────────────────────────
app.include_router(admin_users.router, prefix="/api/admin-users", tags=["admin_users"])
app.include_router(audit_log.router, prefix="/api/audit-log", tags=["audit_log"])
app.include_router(alerts.router, prefix="/api/alerts", tags=["alerts"])
app.include_router(metrics.router, prefix="/api/metrics", tags=["metrics"])
app.include_router(live.router, prefix="/api/live", tags=["live"])
app.include_router(stripe_events.router, prefix="/api/stripe-events", tags=["stripe_events"])
app.include_router(vehicle_review.router, prefix="/api/vehicle-review", tags=["vehicle_review"])
app.include_router(cancellations.router, prefix="/api/cancellations", tags=["cancellations"])
app.include_router(fraud.router, prefix="/api/fraud", tags=["fraud"])
app.include_router(churn.router, prefix="/api/churn", tags=["churn"])
app.include_router(exports.router, prefix="/api/exports", tags=["exports"])
app.include_router(notifications.router, prefix="/api/notifications", tags=["notifications"])
app.include_router(eta_tracking.router, prefix="/api/eta", tags=["eta"])


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=settings.ADMIN_API_HOST, port=settings.ADMIN_API_PORT, reload=True)

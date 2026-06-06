"""Driver churn prediction — activity trends, session decline, risk scores."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from app.auth import TokenPayload, require_role
from app.db import ka

router = APIRouter()


@router.get("/risk")
async def churn_risk(
    min_score: int = Query(0, ge=0, le=100),
    limit: int = Query(50, ge=1, le=200),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT driver_id, recent_runs, prior_runs,
               recent_sessions, prior_sessions,
               cancels_30d, total_30d,
               days_since_last_run,
               last_run_at::text,
               activity_decline_score,
               session_decline_score,
               inactivity_score,
               cancel_rate_score,
               churn_risk_score
        FROM v_driver_churn_risk
        WHERE churn_risk_score >= $1
        ORDER BY churn_risk_score DESC
        LIMIT $2
        """,
        min_score,
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/activity-trend")
async def activity_trend(
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT driver_id, runs_recent_7d, runs_prior_7d,
               completed_recent, cancelled_recent,
               last_run_at::text
        FROM v_driver_activity_trend
        ORDER BY runs_prior_7d - runs_recent_7d DESC
        LIMIT 100
        """
    )
    return [dict(r) for r in rows]


@router.get("/session-trend")
async def session_trend(
    _user: TokenPayload = Depends(require_role("viewer")),
):
    rows = await ka().fetch(
        """
        SELECT driver_id, sessions_recent_7d, sessions_prior_7d,
               ROUND(hours_recent_7d::numeric, 1) AS hours_recent_7d,
               ROUND(hours_prior_7d::numeric, 1)  AS hours_prior_7d,
               last_session_at::text
        FROM v_driver_session_trend
        ORDER BY sessions_prior_7d - sessions_recent_7d DESC
        LIMIT 100
        """
    )
    return [dict(r) for r in rows]


@router.get("/summary")
async def churn_summary(
    _user: TokenPayload = Depends(require_role("viewer")),
):
    row = await ka().fetchrow(
        """
        SELECT
            COUNT(*) AS total_active_drivers,
            COUNT(*) FILTER (WHERE churn_risk_score >= 75) AS critical_risk,
            COUNT(*) FILTER (WHERE churn_risk_score >= 50 AND churn_risk_score < 75) AS high_risk,
            COUNT(*) FILTER (WHERE churn_risk_score >= 25 AND churn_risk_score < 50) AS medium_risk,
            COUNT(*) FILTER (WHERE churn_risk_score < 25) AS low_risk,
            ROUND(AVG(churn_risk_score)::numeric, 1) AS avg_risk_score
        FROM v_driver_churn_risk
        """
    )
    return dict(row) if row else {}

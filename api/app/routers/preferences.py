from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends

from app.auth import require_admin
from app.db import ka


router = APIRouter()


@router.get("/funnel")
async def preference_funnel(_: str = Depends(require_admin)) -> dict:
    """
    Matching-quality funnel: of all booking sessions, how often does the
    PRIMARY preference succeed vs fall through to backups?
    """
    async with ka().acquire() as c:
        per_order = await c.fetch(
            """
            SELECT preference_order,
                   COUNT(*)                                      AS total,
                   COUNT(*) FILTER (WHERE status = 'ACCEPTED')   AS accepted,
                   COUNT(*) FILTER (WHERE status = 'DECLINED')   AS declined,
                   COUNT(*) FILTER (WHERE status = 'EXPIRED')    AS expired,
                   COUNT(*) FILTER (WHERE status = 'CANCELLED')  AS cancelled,
                   COUNT(*) FILTER (WHERE status = 'PENDING')    AS pending,
                   COUNT(*) FILTER (WHERE status = 'OFFERED')    AS offered
            FROM ride_preferences
            GROUP BY preference_order
            ORDER BY preference_order
            """
        )
        session_outcomes = await c.fetch(
            """
            WITH s AS (
              SELECT preference_session_id,
                     BOOL_OR(status = 'ACCEPTED')                                AS any_accepted,
                     BOOL_OR(status = 'ACCEPTED' AND is_primary)                 AS primary_accepted,
                     BOOL_OR(status = 'ACCEPTED' AND NOT is_primary)             AS backup_accepted,
                     COUNT(*)                                                    AS prefs_in_session
              FROM ride_preferences
              GROUP BY preference_session_id
            )
            SELECT
              COUNT(*)                                                   AS total_sessions,
              COUNT(*) FILTER (WHERE any_accepted)                       AS sessions_accepted_any,
              COUNT(*) FILTER (WHERE primary_accepted)                   AS sessions_primary_accepted,
              COUNT(*) FILTER (WHERE backup_accepted AND NOT primary_accepted) AS sessions_backup_accepted,
              AVG(prefs_in_session)                                       AS avg_prefs_per_session
            FROM s
            """
        )
        response_latencies = await c.fetch(
            """
            SELECT preference_order,
                   ROUND(EXTRACT(EPOCH FROM AVG(offered_at - selected_at)))        AS avg_seconds_to_offer,
                   ROUND(EXTRACT(EPOCH FROM AVG(responded_at - offered_at)))       AS avg_seconds_to_respond
            FROM ride_preferences
            WHERE offered_at IS NOT NULL
            GROUP BY preference_order
            ORDER BY preference_order
            """
        )

    return {
        "per_order": [dict(r) for r in per_order],
        "sessions": dict(session_outcomes[0]) if session_outcomes else {},
        "response_latencies": [dict(r) for r in response_latencies],
    }

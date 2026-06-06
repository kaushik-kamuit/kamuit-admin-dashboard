"""Push notification token overview and delivery health."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from app.auth import TokenPayload, require_role
from app.db import ka

router = APIRouter()


@router.get("/tokens")
async def push_tokens(
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    platform: str | None = Query(None, pattern="^(ios|android)$"),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    """List registered push tokens with optional platform filter."""
    conditions = ["1=1"]
    args: list = []
    idx = 1

    if platform:
        conditions.append(f"platform = ${idx}")
        args.append(platform)
        idx += 1

    args.extend([limit, offset])
    rows = await ka().fetch(
        f"""
        SELECT id::text, user_id, expo_push_token, platform,
               voip_push_token, created_at::text, updated_at::text
        FROM push_tokens
        WHERE {' AND '.join(conditions)}
        ORDER BY created_at DESC
        LIMIT ${idx} OFFSET ${idx + 1}
        """,
        *args,
    )
    return [dict(r) for r in rows]


@router.get("/summary")
async def notification_summary(
    _user: TokenPayload = Depends(require_role("viewer")),
):
    """Push token health: totals by platform, stale tokens, VoIP coverage."""
    row = await ka().fetchrow(
        """
        SELECT
            COUNT(*)                                           AS total_tokens,
            COUNT(DISTINCT user_id)                            AS unique_users,
            COUNT(*) FILTER (WHERE platform = 'ios')           AS ios_tokens,
            COUNT(*) FILTER (WHERE platform = 'android')       AS android_tokens,
            COUNT(*) FILTER (WHERE voip_push_token IS NOT NULL) AS voip_tokens,
            COUNT(*) FILTER (WHERE updated_at < now() - INTERVAL '30 days')
                                                               AS stale_tokens_30d,
            COUNT(*) FILTER (WHERE updated_at < now() - INTERVAL '90 days')
                                                               AS stale_tokens_90d
        FROM push_tokens
        """
    )
    return dict(row) if row else {}


@router.get("/per-user")
async def tokens_per_user(
    limit: int = Query(50, ge=1, le=200),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    """Users with the most registered push tokens (detect token sprawl)."""
    rows = await ka().fetch(
        """
        SELECT user_id,
               COUNT(*)                                              AS token_count,
               COUNT(*) FILTER (WHERE platform = 'ios')              AS ios,
               COUNT(*) FILTER (WHERE platform = 'android')          AS android,
               COUNT(*) FILTER (WHERE voip_push_token IS NOT NULL)   AS voip,
               MAX(updated_at)::text                                 AS latest_update
        FROM push_tokens
        GROUP BY user_id
        ORDER BY token_count DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]


@router.get("/ride-alerts")
async def ride_alert_subscriptions(
    limit: int = Query(50, ge=1, le=200),
    _user: TokenPayload = Depends(require_role("viewer")),
):
    """Active ride alert subscriptions (rider 'notify me' requests)."""
    rows = await ka().fetch(
        """
        SELECT id::text, passenger_id, origin_lat, origin_lng,
               destination_lat, destination_lng, trip_date::text,
               is_notified, created_at::text
        FROM ride_alerts
        ORDER BY created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]

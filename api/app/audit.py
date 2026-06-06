"""Audit log helper — records admin actions to admin_audit_log in the user_mgmt DB."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any

from app.db import um


async def log_action(
    username: str,
    action: str,
    *,
    role: str | None = None,
    resource: str | None = None,
    resource_id: str | None = None,
    detail: dict[str, Any] | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Insert a row into admin_audit_log. Fire-and-forget; swallows errors."""
    try:
        await um().execute(
            """
            INSERT INTO admin_audit_log (ts, username, role, action, resource, resource_id, detail, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
            """,
            datetime.now(timezone.utc),
            username,
            role,
            action,
            resource,
            resource_id,
            json.dumps(detail) if detail else None,
            ip_address,
            user_agent,
        )
    except Exception:
        pass

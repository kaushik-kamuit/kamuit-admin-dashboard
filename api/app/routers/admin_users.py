"""Admin user management (RBAC). Admin-only."""
from __future__ import annotations

from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import TokenPayload, hash_password, require_role
from app.audit import log_action
from app.db import um
from app.security import validate_password

router = APIRouter()


class CreateUser(BaseModel):
    username: str = Field(min_length=2, max_length=50)
    password: str = Field(min_length=4, max_length=128)
    role: str = Field(default="viewer", pattern="^(viewer|operator|admin)$")


class UpdateUser(BaseModel):
    role: str | None = Field(default=None, pattern="^(viewer|operator|admin)$")
    password: str | None = Field(default=None, min_length=4, max_length=128)
    is_active: bool | None = None


@router.get("")
async def list_users(user: TokenPayload = Depends(require_role("admin"))):
    rows = await um().fetch("""
        SELECT id, username, role, is_active, created_at, last_login
        FROM admin_users ORDER BY created_at
    """)
    return [dict(r) for r in rows]


@router.post("", status_code=201)
async def create_user(body: CreateUser, user: TokenPayload = Depends(require_role("admin"))):
    pw_err = validate_password(body.password)
    if pw_err:
        raise HTTPException(422, pw_err)
    existing = await um().fetchval("SELECT id FROM admin_users WHERE username = $1", body.username)
    if existing:
        raise HTTPException(409, "Username already exists")
    row = await um().fetchrow("""
        INSERT INTO admin_users (username, password_hash, role)
        VALUES ($1, $2, $3) RETURNING id, username, role, created_at
    """, body.username, hash_password(body.password), body.role)
    await log_action(user.sub, "create_admin_user", role=user.role,
                     resource="admin_user", resource_id=str(row["id"]),
                     detail={"target_username": body.username, "target_role": body.role})
    return dict(row)


@router.patch("/{user_id}")
async def update_user(user_id: int, body: UpdateUser, user: TokenPayload = Depends(require_role("admin"))):
    target = await um().fetchrow("SELECT * FROM admin_users WHERE id = $1", user_id)
    if not target:
        raise HTTPException(404, "User not found")
    changes = {}
    if body.role is not None:
        await um().execute("UPDATE admin_users SET role = $1, updated_at = $2 WHERE id = $3",
                           body.role, datetime.now(timezone.utc), user_id)
        changes["role"] = body.role
    if body.password is not None:
        pw_err = validate_password(body.password)
        if pw_err:
            raise HTTPException(422, pw_err)
        await um().execute("UPDATE admin_users SET password_hash = $1, updated_at = $2 WHERE id = $3",
                           hash_password(body.password), datetime.now(timezone.utc), user_id)
        changes["password"] = "changed"
    if body.is_active is not None:
        await um().execute("UPDATE admin_users SET is_active = $1, updated_at = $2 WHERE id = $3",
                           body.is_active, datetime.now(timezone.utc), user_id)
        changes["is_active"] = body.is_active
    await log_action(user.sub, "update_admin_user", role=user.role,
                     resource="admin_user", resource_id=str(user_id),
                     detail={"target": target["username"], **changes})
    return {"ok": True, "changes": changes}


@router.delete("/{user_id}")
async def delete_user(user_id: int, user: TokenPayload = Depends(require_role("admin"))):
    target = await um().fetchrow("SELECT username FROM admin_users WHERE id = $1", user_id)
    if not target:
        raise HTTPException(404, "User not found")
    if target["username"] == user.sub:
        raise HTTPException(400, "Cannot delete yourself")
    await um().execute("DELETE FROM admin_users WHERE id = $1", user_id)
    await log_action(user.sub, "delete_admin_user", role=user.role,
                     resource="admin_user", resource_id=str(user_id),
                     detail={"deleted": target["username"]})
    return {"ok": True}

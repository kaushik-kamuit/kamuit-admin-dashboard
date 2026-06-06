"""Auth endpoints — login (env-based bootstrap + DB-backed users), me, logout."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel

from app.auth import (
    TokenPayload, _GENERIC_AUTH_ERROR, create_access_token, get_current_user,
    hash_password, require_admin, verify_credentials, verify_password,
)
from app.audit import log_action
from app.config import settings
from app.db import um
from app.security import get_client_ip, get_user_agent, limiter

logger = logging.getLogger("kamuit.auth")

router = APIRouter()


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class LoginBody(BaseModel):
    username: str
    password: str


async def _check_lockout(username: str) -> None:
    """Raise 429 if the account has too many recent failed attempts."""
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(minutes=settings.LOGIN_LOCKOUT_MINUTES)
        count = await um().fetchval(
            """
            SELECT COUNT(*) FROM admin_audit_log
            WHERE username = $1 AND action = 'login_failed' AND ts > $2
            """,
            username, cutoff,
        )
        if count and count >= settings.LOGIN_MAX_ATTEMPTS:
            logger.warning("Account locked out: %s (%d attempts)", username, count)
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail=f"Account temporarily locked. Try again in {settings.LOGIN_LOCKOUT_MINUTES} minutes.",
            )
    except HTTPException:
        raise
    except Exception:
        pass


async def _try_db_login(username: str, password: str) -> tuple[bool, str]:
    """Check admin_users table. Returns (success, role)."""
    try:
        row = await um().fetchrow(
            "SELECT password_hash, role, is_active FROM admin_users WHERE username = $1", username
        )
        if row and row["is_active"] and verify_password(password, row["password_hash"]):
            await um().execute(
                "UPDATE admin_users SET last_login = $1 WHERE username = $2",
                datetime.now(timezone.utc), username,
            )
            return True, row["role"]
    except Exception:
        pass
    return False, ""


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login(request: Request, body: LoginBody) -> TokenResponse:
    await _check_lockout(body.username)

    ok, role = await _try_db_login(body.username, body.password)
    if not ok:
        if verify_credentials(body.username, body.password):
            role = "admin"
        else:
            ip = get_client_ip(request)
            ua = get_user_agent(request)
            try:
                await log_action(
                    body.username, "login_failed",
                    ip_address=ip, user_agent=ua,
                    detail={"reason": "bad_credentials"},
                )
            except Exception:
                pass
            logger.warning("Failed login attempt for '%s' from %s", body.username, ip)
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=_GENERIC_AUTH_ERROR,
            )

    ip = get_client_ip(request)
    ua = get_user_agent(request)
    token = create_access_token(body.username, role)
    try:
        await log_action(body.username, "login", role=role, ip_address=ip, user_agent=ua)
    except Exception:
        pass
    return TokenResponse(access_token=token)


@router.post("/login/form", response_model=TokenResponse)
@limiter.limit("5/minute")
async def login_form(request: Request, form: OAuth2PasswordRequestForm = Depends()) -> TokenResponse:
    await _check_lockout(form.username)

    ok, role = await _try_db_login(form.username, form.password)
    if not ok:
        if verify_credentials(form.username, form.password):
            role = "admin"
        else:
            ip = get_client_ip(request)
            try:
                await log_action(
                    form.username, "login_failed",
                    ip_address=ip, user_agent=get_user_agent(request),
                    detail={"reason": "bad_credentials"},
                )
            except Exception:
                pass
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail=_GENERIC_AUTH_ERROR,
            )
    return TokenResponse(access_token=create_access_token(form.username, role))


@router.get("/me")
async def me(user: TokenPayload = Depends(get_current_user)):
    return {"username": user.sub, "role": user.role}

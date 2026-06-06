"""RBAC admin auth with JWT bearer tokens.

Roles:
  - viewer:   read-only dashboard access
  - operator: viewer + approve/reject drivers, change ride/run status
  - admin:    operator + Query Studio, user management, audit log
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from app.config import settings

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto", bcrypt__rounds=12)
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

ROLE_HIERARCHY = {"viewer": 0, "operator": 1, "admin": 2}

_GENERIC_AUTH_ERROR = "Invalid username or password"


class TokenPayload(BaseModel):
    sub: str
    role: str
    exp: int


def hash_password(password: str) -> str:
    return pwd_ctx.hash(password)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_ctx.verify(plain, hashed)


def create_access_token(subject: str, role: str = "admin") -> str:
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ADMIN_JWT_EXPIRE_MINUTES)
    payload = {"sub": subject, "role": role, "exp": int(expire.timestamp())}
    return jwt.encode(payload, settings.ADMIN_JWT_SECRET, algorithm=settings.ADMIN_JWT_ALGORITHM)


def verify_credentials(username: str, password: str) -> bool:
    """Legacy single-user check (bootstrap admin from .env)."""
    return username == settings.ADMIN_USERNAME and password == settings.ADMIN_PASSWORD


def _decode_token(token: str) -> TokenPayload:
    decoded = jwt.decode(token, settings.ADMIN_JWT_SECRET, algorithms=[settings.ADMIN_JWT_ALGORITHM])
    if "role" not in decoded:
        decoded["role"] = "admin"
    return TokenPayload(**decoded)


async def get_current_user(token: Annotated[str | None, Depends(oauth2_scheme)]) -> TokenPayload:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        return _decode_token(token)
    except (JWTError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )


async def require_admin(token: Annotated[str | None, Depends(oauth2_scheme)]) -> str:
    """Backward-compat: returns username string. All roles accepted."""
    user = await get_current_user(token)
    return user.sub


def require_role(min_role: str):
    """Dependency factory: require at least `min_role` level."""
    min_level = ROLE_HIERARCHY.get(min_role, 0)

    async def _check(user: TokenPayload = Depends(get_current_user)) -> TokenPayload:
        user_level = ROLE_HIERARCHY.get(user.role, 0)
        if user_level < min_level:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Insufficient permissions. Required role: {min_role}",
            )
        return user
    return _check

"""Security hardening: rate limiter, security headers, IP extraction."""
from __future__ import annotations

import re
from typing import Callable

from fastapi import Request, Response
from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp


limiter = Limiter(key_func=get_remote_address, default_limits=[])


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Inject standard security headers on every response."""

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["Permissions-Policy"] = "geolocation=(), camera=(), microphone=()"
        response.headers["Cache-Control"] = "no-store"
        if request.url.scheme == "https":
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


def get_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


def get_user_agent(request: Request) -> str:
    return request.headers.get("user-agent", "unknown")[:512]


# --- Query Studio hardening ---

_DANGEROUS_PATTERNS = [
    re.compile(r"\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|REVOKE|COPY)\b", re.IGNORECASE),
    re.compile(r"\b(pg_read_file|pg_write_file|pg_ls_dir|lo_import|lo_export)\b", re.IGNORECASE),
    re.compile(r"\b(pg_sleep|dblink|dblink_exec)\b", re.IGNORECASE),
    re.compile(r";\s*\w", re.IGNORECASE),  # multi-statement
    re.compile(r"--.*$", re.MULTILINE),  # SQL comments (could hide payloads)
    re.compile(r"/\*.*?\*/", re.DOTALL),  # block comments
    re.compile(r"\bINTO\s+(OUTFILE|DUMPFILE|TEMP|TEMPORARY)\b", re.IGNORECASE),
    re.compile(r"\bEXEC(UTE)?\b", re.IGNORECASE),
    re.compile(r"\bSET\b", re.IGNORECASE),
]


def validate_readonly_sql(sql: str) -> str | None:
    """Return an error message if SQL is not safe for read-only execution, else None."""
    stripped = sql.strip().rstrip(";")
    lower = stripped.lower()

    if not (lower.startswith("select") or lower.startswith("with")):
        return "Only SELECT/CTE queries are allowed."

    for pattern in _DANGEROUS_PATTERNS:
        match = pattern.search(stripped)
        if match:
            return f"Forbidden SQL construct detected: '{match.group()}'"

    return None


# --- Password policy ---

_MIN_PASSWORD_LENGTH = 10


def validate_password(password: str) -> str | None:
    """Return an error message if password doesn't meet policy, else None."""
    if len(password) < _MIN_PASSWORD_LENGTH:
        return f"Password must be at least {_MIN_PASSWORD_LENGTH} characters."
    if not re.search(r"[A-Z]", password):
        return "Password must contain at least one uppercase letter."
    if not re.search(r"[a-z]", password):
        return "Password must contain at least one lowercase letter."
    if not re.search(r"\d", password):
        return "Password must contain at least one digit."
    if not re.search(r"[^A-Za-z0-9]", password):
        return "Password must contain at least one special character."
    return None

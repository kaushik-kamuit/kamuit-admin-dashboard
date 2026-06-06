"""Admin API configuration. Reads from ../.env at the project root."""
from __future__ import annotations

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env") if (PROJECT_ROOT / ".env").exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    # Shared defaults (backward-compat with local Docker setup)
    LOCAL_PG_USER: str = "kamuit_admin"
    LOCAL_PG_PASSWORD: str = "local_dev_only"

    # Per-DB credentials; fall back to LOCAL_PG_USER / LOCAL_PG_PASSWORD
    USER_MGMT_DB_HOST: str = "localhost"
    USER_MGMT_DB_PORT: int = 54321
    USER_MGMT_DB_NAME: str = "kamuit_user_management"
    USER_MGMT_DB_USER: str = ""
    USER_MGMT_DB_PASSWORD: str = ""

    KAMUIT_DB_HOST: str = "localhost"
    KAMUIT_DB_PORT: int = 54322
    KAMUIT_DB_NAME: str = "kamuit_backend"
    KAMUIT_DB_USER: str = ""
    KAMUIT_DB_PASSWORD: str = ""

    PAYMENT_DB_HOST: str = "localhost"
    PAYMENT_DB_PORT: int = 54323
    PAYMENT_DB_NAME: str = "kamuit_payment"
    PAYMENT_DB_USER: str = ""
    PAYMENT_DB_PASSWORD: str = ""

    ADMIN_API_HOST: str = "127.0.0.1"
    ADMIN_API_PORT: int = 8000

    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"

    ADMIN_JWT_SECRET: str = "change-me"
    ADMIN_JWT_ALGORITHM: str = "HS256"
    ADMIN_JWT_EXPIRE_MINUTES: int = 480

    CORS_EXTRA_ORIGINS: str = ""
    ENABLE_DOCS: bool = True
    LOGIN_MAX_ATTEMPTS: int = 5
    LOGIN_LOCKOUT_MINUTES: int = 15

    DB_SSLMODE: str = ""

    def _dsn(self, host: str, port: int, name: str, user: str, password: str) -> str:
        u = user or self.LOCAL_PG_USER
        p = password or self.LOCAL_PG_PASSWORD
        base = f"postgresql://{u}:{p}@{host}:{port}/{name}"
        if self.DB_SSLMODE:
            base += f"?sslmode={self.DB_SSLMODE}"
        return base

    @property
    def user_mgmt_dsn(self) -> str:
        return self._dsn(
            self.USER_MGMT_DB_HOST, self.USER_MGMT_DB_PORT, self.USER_MGMT_DB_NAME,
            self.USER_MGMT_DB_USER, self.USER_MGMT_DB_PASSWORD,
        )

    @property
    def kamuit_dsn(self) -> str:
        return self._dsn(
            self.KAMUIT_DB_HOST, self.KAMUIT_DB_PORT, self.KAMUIT_DB_NAME,
            self.KAMUIT_DB_USER, self.KAMUIT_DB_PASSWORD,
        )

    @property
    def payment_dsn(self) -> str:
        return self._dsn(
            self.PAYMENT_DB_HOST, self.PAYMENT_DB_PORT, self.PAYMENT_DB_NAME,
            self.PAYMENT_DB_USER, self.PAYMENT_DB_PASSWORD,
        )


settings = Settings()

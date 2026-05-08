"""Admin API configuration. Reads from ../.env at the project root."""
from __future__ import annotations

from pathlib import Path
from pydantic_settings import BaseSettings, SettingsConfigDict


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    LOCAL_PG_USER: str = "kamuit_admin"
    LOCAL_PG_PASSWORD: str = "local_dev_only"

    USER_MGMT_DB_HOST: str = "localhost"
    USER_MGMT_DB_PORT: int = 54321
    USER_MGMT_DB_NAME: str = "kamuit_user_management"

    KAMUIT_DB_HOST: str = "localhost"
    KAMUIT_DB_PORT: int = 54322
    KAMUIT_DB_NAME: str = "kamuit_backend"

    PAYMENT_DB_HOST: str = "localhost"
    PAYMENT_DB_PORT: int = 54323
    PAYMENT_DB_NAME: str = "kamuit_payment"

    ADMIN_API_HOST: str = "127.0.0.1"
    ADMIN_API_PORT: int = 8000

    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin"

    ADMIN_JWT_SECRET: str = "change-me"
    ADMIN_JWT_ALGORITHM: str = "HS256"
    ADMIN_JWT_EXPIRE_MINUTES: int = 480

    def dsn(self, host: str, port: int, name: str) -> str:
        return (
            f"postgresql://{self.LOCAL_PG_USER}:{self.LOCAL_PG_PASSWORD}"
            f"@{host}:{port}/{name}"
        )

    @property
    def user_mgmt_dsn(self) -> str:
        return self.dsn(self.USER_MGMT_DB_HOST, self.USER_MGMT_DB_PORT, self.USER_MGMT_DB_NAME)

    @property
    def kamuit_dsn(self) -> str:
        return self.dsn(self.KAMUIT_DB_HOST, self.KAMUIT_DB_PORT, self.KAMUIT_DB_NAME)

    @property
    def payment_dsn(self) -> str:
        return self.dsn(self.PAYMENT_DB_HOST, self.PAYMENT_DB_PORT, self.PAYMENT_DB_NAME)


settings = Settings()

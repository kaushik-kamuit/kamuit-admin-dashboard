"""Three asyncpg pools, one per DB. Created on startup, closed on shutdown."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import asyncpg

from app.config import settings


@dataclass
class Pools:
    user_mgmt: Optional[asyncpg.Pool] = None
    kamuit: Optional[asyncpg.Pool] = None
    payment: Optional[asyncpg.Pool] = None


pools = Pools()


async def startup_pools() -> None:
    pools.user_mgmt = await asyncpg.create_pool(
        dsn=settings.user_mgmt_dsn, min_size=1, max_size=8, command_timeout=30,
    )
    pools.kamuit = await asyncpg.create_pool(
        dsn=settings.kamuit_dsn, min_size=1, max_size=8, command_timeout=30,
    )
    pools.payment = await asyncpg.create_pool(
        dsn=settings.payment_dsn, min_size=1, max_size=8, command_timeout=30,
    )


async def shutdown_pools() -> None:
    for p in (pools.user_mgmt, pools.kamuit, pools.payment):
        if p is not None:
            await p.close()


def um() -> asyncpg.Pool:
    assert pools.user_mgmt is not None, "user_mgmt pool not initialized"
    return pools.user_mgmt


def ka() -> asyncpg.Pool:
    assert pools.kamuit is not None, "kamuit pool not initialized"
    return pools.kamuit


def pa() -> asyncpg.Pool:
    assert pools.payment is not None, "payment pool not initialized"
    return pools.payment

"""Live trip tracking via WebSocket + Postgres LISTEN/NOTIFY."""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, timezone

import asyncpg
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect
from jose import JWTError

from app.auth import _decode_token, require_role
from app.config import settings
from app.db import ka

logger = logging.getLogger("kamuit.live")
router = APIRouter()


class LiveTracker:
    """Manages a Postgres LISTEN connection and fans out to WebSocket clients."""

    def __init__(self):
        self._clients: set[WebSocket] = set()
        self._conn: asyncpg.Connection | None = None
        self._task: asyncio.Task | None = None

    async def start(self) -> None:
        try:
            self._conn = await asyncpg.connect(dsn=settings.kamuit_dsn)
            await self._conn.add_listener("live_pings", self._on_notify)
            logger.info("Live tracker: listening on 'live_pings' channel")
        except Exception as e:
            logger.warning(f"Live tracker: could not connect for LISTEN: {e}")

    async def stop(self) -> None:
        if self._conn:
            try:
                await self._conn.remove_listener("live_pings", self._on_notify)
                await self._conn.close()
            except Exception:
                pass

    def _on_notify(self, conn, pid, channel, payload):
        if not self._clients:
            return
        asyncio.create_task(self._broadcast(payload))

    async def _broadcast(self, payload: str) -> None:
        dead: set[WebSocket] = set()
        for ws in self._clients:
            try:
                await ws.send_text(payload)
            except Exception:
                dead.add(ws)
        self._clients -= dead

    def add(self, ws: WebSocket) -> None:
        self._clients.add(ws)

    def remove(self, ws: WebSocket) -> None:
        self._clients.discard(ws)

    @property
    def count(self) -> int:
        return len(self._clients)


tracker = LiveTracker()


@router.websocket("/ws")
async def live_ws(ws: WebSocket, token: str = Query(default="")):
    if not token:
        await ws.close(code=4001, reason="Missing authentication token")
        return
    try:
        _decode_token(token)
    except (JWTError, ValueError):
        await ws.close(code=4003, reason="Invalid or expired token")
        return

    await ws.accept()
    tracker.add(ws)
    try:
        # Send current active runs as initial state
        try:
            rows = await ka().fetch("""
                SELECT dr.id AS run_id, dr.driver_id, dr.status,
                       dr.route_polyline,
                       ST_Y(dr.origin_point::geometry) AS origin_lat,
                       ST_X(dr.origin_point::geometry) AS origin_lng,
                       ST_Y(dr.dest_point::geometry) AS dest_lat,
                       ST_X(dr.dest_point::geometry) AS dest_lng,
                       p.latitude AS lat, p.longitude AS lng,
                       p.heading, p.speed_mps, p.route_fraction,
                       p.recorded_at
                FROM driver_runs dr
                LEFT JOIN LATERAL (
                    SELECT dlp.latitude, dlp.longitude, dlp.heading,
                           dlp.speed_mps, dlp.route_fraction, dlp.recorded_at
                    FROM driver_location_pings dlp
                    WHERE dlp.driver_run_id = dr.id
                    ORDER BY dlp.recorded_at DESC LIMIT 1
                ) p ON true
                WHERE dr.status IN ('IN_PROGRESS', 'PARTIALLY_FILLED', 'OPEN')
            """)
            await ws.send_text(json.dumps({
                "type": "init",
                "runs": [{
                    "run_id": str(r["run_id"]),
                    "driver_id": str(r["driver_id"]),
                    "status": r["status"],
                    "route_polyline": r["route_polyline"],
                    "origin": [float(r["origin_lat"] or 0), float(r["origin_lng"] or 0)],
                    "destination": [float(r["dest_lat"] or 0), float(r["dest_lng"] or 0)],
                    "lat": float(r["lat"]) if r["lat"] else None,
                    "lng": float(r["lng"]) if r["lng"] else None,
                    "heading": float(r["heading"]) if r["heading"] else None,
                    "speed_mps": float(r["speed_mps"]) if r["speed_mps"] else None,
                    "route_fraction": float(r["route_fraction"]) if r["route_fraction"] else None,
                    "ts": r["recorded_at"].isoformat() if r["recorded_at"] else None,
                } for r in rows],
            }))
        except Exception as e:
            logger.warning(f"Live WS init error: {e}")

        while True:
            # Keep connection alive; client can send pings
            data = await ws.receive_text()
            if data == "ping":
                await ws.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        tracker.remove(ws)


@router.get("/active-runs")
async def active_runs(_user=Depends(require_role("viewer"))):
    """REST fallback for active run positions."""
    rows = await ka().fetch("""
        SELECT dr.id AS run_id, dr.driver_id, dr.status,
               dr.route_polyline,
               ST_Y(dr.origin_point::geometry) AS origin_lat,
               ST_X(dr.origin_point::geometry) AS origin_lng,
               ST_Y(dr.dest_point::geometry) AS dest_lat,
               ST_X(dr.dest_point::geometry) AS dest_lng,
               p.latitude AS lat, p.longitude AS lng,
               p.heading, p.speed_mps, p.route_fraction,
               p.recorded_at
        FROM driver_runs dr
        LEFT JOIN LATERAL (
            SELECT dlp.latitude, dlp.longitude, dlp.heading,
                   dlp.speed_mps, dlp.route_fraction, dlp.recorded_at
            FROM driver_location_pings dlp
            WHERE dlp.driver_run_id = dr.id
            ORDER BY dlp.recorded_at DESC LIMIT 1
        ) p ON true
        WHERE dr.status IN ('IN_PROGRESS', 'PARTIALLY_FILLED', 'OPEN')
    """)
    return [{
        "run_id": str(r["run_id"]),
        "driver_id": str(r["driver_id"]),
        "status": r["status"],
        "route_polyline": r["route_polyline"],
        "origin": [float(r["origin_lat"] or 0), float(r["origin_lng"] or 0)],
        "destination": [float(r["dest_lat"] or 0), float(r["dest_lng"] or 0)],
        "lat": float(r["lat"]) if r["lat"] else None,
        "lng": float(r["lng"]) if r["lng"] else None,
        "heading": float(r["heading"]) if r["heading"] else None,
        "speed_mps": float(r["speed_mps"]) if r["speed_mps"] else None,
        "route_fraction": float(r["route_fraction"]) if r["route_fraction"] else None,
        "ts": r["recorded_at"].isoformat() if r["recorded_at"] else None,
    } for r in rows]


def _run_row(r) -> dict:
    return {
        "run_id": str(r["run_id"]),
        "driver_id": str(r["driver_id"]),
        "status": r["status"],
        "route_polyline": r["route_polyline"],
        "origin_address": r["origin_address"],
        "dest_address": r["dest_address"],
        "origin": [float(r["origin_lat"] or 0), float(r["origin_lng"] or 0)],
        "destination": [float(r["dest_lat"] or 0), float(r["dest_lng"] or 0)],
        "ride_id": str(r["ride_id"]) if r.get("ride_id") else None,
        "rider_id": str(r["rider_id"]) if r.get("rider_id") else None,
        "created_at": r["created_at"].isoformat() if r["created_at"] else None,
    }


_MAP_RUNS_SQL = """
    SELECT dr.id AS run_id, dr.driver_id, dr.status::text AS status,
           dr.route_polyline, dr.origin_address, dr.dest_address,
           dr.created_at,
           ST_Y(dr.origin_point::geometry) AS origin_lat,
           ST_X(dr.origin_point::geometry) AS origin_lng,
           ST_Y(dr.dest_point::geometry)   AS dest_lat,
           ST_X(dr.dest_point::geometry)   AS dest_lng,
           ra.ride_id, r.rider_id
    FROM driver_runs dr
    LEFT JOIN LATERAL (
        SELECT ra2.ride_id
        FROM ride_assignments ra2
        WHERE ra2.driver_run_id = dr.id
        ORDER BY ra2.assigned_at DESC LIMIT 1
    ) ra ON true
    LEFT JOIN rides r ON r.id = ra.ride_id
    WHERE dr.route_polyline IS NOT NULL
"""


@router.get("/map-runs")
async def map_runs(
    _user=Depends(require_role("viewer")),
    limit: int = Query(200, ge=1, le=500),
):
    """All driver runs with polylines, categorised as active/completed/future."""
    async with ka().acquire() as c:
        active = await c.fetch(
            _MAP_RUNS_SQL + " AND dr.status IN ('IN_PROGRESS', 'PARTIALLY_FILLED') "
            "ORDER BY dr.created_at DESC LIMIT $1",
            limit,
        )
        completed = await c.fetch(
            _MAP_RUNS_SQL + " AND dr.status = 'COMPLETED' "
            "ORDER BY dr.updated_at DESC LIMIT $1",
            limit,
        )
        scheduled = await c.fetch(
            _MAP_RUNS_SQL + " AND dr.status = 'OPEN' "
            "ORDER BY dr.created_at ASC LIMIT $1",
            limit,
        )

    return {
        "active": [_run_row(r) for r in active],
        "completed": [_run_row(r) for r in completed],
        "scheduled": [_run_row(r) for r in scheduled],
    }

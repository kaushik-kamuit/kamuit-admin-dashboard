/**
 * Manages live vehicle positions for the LiveMap.
 *
 * Two data sources, unified into one vehicle state per active run:
 *
 * 1. WebSocket (/api/live/ws) — real driver pings forwarded by the backend
 *    via Postgres LISTEN/NOTIFY.  When real pings arrive they take priority.
 *
 * 2. Client-side simulation — for active runs that have a decoded polyline
 *    but no recent real pings.  Animates a car marker along the polyline at
 *    ~40 km/h so the dashboard looks alive during demos.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { decodePolyline } from "../lib/polyline";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface VehicleState {
  runId: string;
  driverId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number; // m/s
  source: "ws" | "sim";
  updatedAt: number; // Date.now()
}

interface ActiveRun {
  run_id: string;
  driver_id: string;
  route_polyline: string | null;
  origin: [number, number];
  destination: [number, number];
}

/* ------------------------------------------------------------------ */
/*  Geometry helpers                                                    */
/* ------------------------------------------------------------------ */

function bearing(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180;
  const dLng = (b[1] - a[1]) * toRad;
  const lat1 = a[0] * toRad;
  const lat2 = b[0] * toRad;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function haversineM(a: [number, number], b: [number, number]): number {
  const R = 6_371_000;
  const toRad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * toRad;
  const dLng = (b[1] - a[1]) * toRad;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(a[0] * toRad) * Math.cos(b[0] * toRad) * sinLng * sinLng;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function interpolate(
  a: [number, number],
  b: [number, number],
  t: number,
): [number, number] {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/* ------------------------------------------------------------------ */
/*  Cumulative distances along a polyline                              */
/* ------------------------------------------------------------------ */

function cumulativeDistances(pts: [number, number][]): number[] {
  const d = [0];
  for (let i = 1; i < pts.length; i++) {
    d.push(d[i - 1] + haversineM(pts[i - 1], pts[i]));
  }
  return d;
}

function positionAtDistance(
  pts: [number, number][],
  cumDist: number[],
  dist: number,
): { pos: [number, number]; heading: number; segIdx: number } {
  const totalDist = cumDist[cumDist.length - 1];
  const d = Math.max(0, Math.min(dist, totalDist));

  for (let i = 1; i < cumDist.length; i++) {
    if (cumDist[i] >= d) {
      const segLen = cumDist[i] - cumDist[i - 1];
      const t = segLen > 0 ? (d - cumDist[i - 1]) / segLen : 0;
      return {
        pos: interpolate(pts[i - 1], pts[i], t),
        heading: bearing(pts[i - 1], pts[i]),
        segIdx: i - 1,
      };
    }
  }

  const last = pts.length - 1;
  return {
    pos: pts[last],
    heading: last > 0 ? bearing(pts[last - 1], pts[last]) : 0,
    segIdx: last - 1,
  };
}

/* ------------------------------------------------------------------ */
/*  Simulation state per run                                           */
/* ------------------------------------------------------------------ */

const SIM_SPEED_MPS = 11.1; // ~40 km/h
const SIM_TICK_MS = 50;
const SIM_STAGGER_MS = 8_000; // spread start offsets so cars don't clump

interface SimRun {
  runId: string;
  driverId: string;
  pts: [number, number][];
  cumDist: number[];
  totalDist: number;
  distTravelled: number;
  direction: 1 | -1; // loop back and forth
}

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useLiveVehicles(activeRuns: ActiveRun[]) {
  const [vehicles, setVehicles] = useState<Map<string, VehicleState>>(new Map());

  // Refs for mutable state used by the animation frame
  const simRuns = useRef<Map<string, SimRun>>(new Map());
  const wsVehicles = useRef<Map<string, VehicleState>>(new Map());
  const rafId = useRef<number>(0);
  const lastTick = useRef(0);

  /* ── WebSocket ──────────────────────────────────────────────── */
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const connectWs = useCallback(() => {
    const token = localStorage.getItem("kamuit_admin_token");
    if (!token) return;

    const baseUrl =
      (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8001";
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/api/live/ws?token=" + encodeURIComponent(token);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);

          // Real-time ping from NOTIFY
          if (msg.driver_run_id) {
            const v: VehicleState = {
              runId: msg.driver_run_id,
              driverId: msg.driver_id ?? "",
              lat: msg.lat,
              lng: msg.lng,
              heading: msg.heading ?? 0,
              speed: msg.speed_mps ?? 0,
              source: "ws",
              updatedAt: Date.now(),
            };
            wsVehicles.current.set(v.runId, v);
          }

          // Init message with latest pings for active runs
          if (msg.type === "init" && Array.isArray(msg.runs)) {
            for (const r of msg.runs) {
              if (r.lat != null && r.lng != null) {
                wsVehicles.current.set(r.run_id, {
                  runId: r.run_id,
                  driverId: r.driver_id ?? "",
                  lat: r.lat,
                  lng: r.lng,
                  heading: r.heading ?? 0,
                  speed: r.speed_mps ?? 0,
                  source: "ws",
                  updatedAt: Date.now(),
                });
              }
            }
          }
        } catch { /* ignore malformed */ }
      };

      ws.onclose = () => {
        wsRef.current = null;
        reconnectTimer.current = setTimeout(connectWs, 5_000);
      };
      ws.onerror = () => ws.close();

      // Keep-alive
      const ping = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, 25_000);
      ws.addEventListener("close", () => clearInterval(ping));
    } catch { /* can't open ws – will retry */ }
  }, []);

  useEffect(() => {
    connectWs();
    return () => {
      wsRef.current?.close();
      clearTimeout(reconnectTimer.current);
    };
  }, [connectWs]);

  /* ── Sync simulation runs with active runs prop ─────────────── */
  useEffect(() => {
    const current = simRuns.current;
    const activeIds = new Set(activeRuns.map((r) => r.run_id));

    // Remove runs no longer active
    for (const id of current.keys()) {
      if (!activeIds.has(id)) current.delete(id);
    }

    // Add new active runs
    let staggerIdx = 0;
    for (const run of activeRuns) {
      if (current.has(run.run_id)) continue;
      if (!run.route_polyline) continue;

      try {
        const pts = decodePolyline(run.route_polyline);
        if (pts.length < 2) continue;

        const cumDist = cumulativeDistances(pts);
        const totalDist = cumDist[cumDist.length - 1];
        if (totalDist < 100) continue; // skip trivially short routes

        // Stagger starting positions so cars are spread out
        const startDist = (SIM_STAGGER_MS * staggerIdx * SIM_SPEED_MPS) / 1000;
        staggerIdx++;

        current.set(run.run_id, {
          runId: run.run_id,
          driverId: run.driver_id,
          pts,
          cumDist,
          totalDist,
          distTravelled: startDist % totalDist,
          direction: 1,
        });
      } catch { /* bad polyline */ }
    }
  }, [activeRuns]);

  /* ── Animation loop ─────────────────────────────────────────── */
  useEffect(() => {
    function tick(now: number) {
      const dt = lastTick.current ? Math.min(now - lastTick.current, 200) : SIM_TICK_MS;
      lastTick.current = now;

      const next = new Map<string, VehicleState>();

      // 1. Real WS vehicles — always take priority
      for (const [id, v] of wsVehicles.current) {
        // Only show if ping is recent (< 5 min)
        if (Date.now() - v.updatedAt < 300_000) {
          next.set(id, v);
        }
      }

      // 2. Simulated vehicles — only for runs NOT covered by a recent WS ping
      for (const [id, sim] of simRuns.current) {
        if (next.has(id)) continue; // real ping takes precedence

        const move = SIM_SPEED_MPS * (dt / 1000);
        sim.distTravelled += move * sim.direction;

        // Bounce at endpoints
        if (sim.distTravelled >= sim.totalDist) {
          sim.distTravelled = sim.totalDist;
          sim.direction = -1;
        } else if (sim.distTravelled <= 0) {
          sim.distTravelled = 0;
          sim.direction = 1;
        }

        const { pos, heading: h } = positionAtDistance(sim.pts, sim.cumDist, sim.distTravelled);

        next.set(id, {
          runId: sim.runId,
          driverId: sim.driverId,
          lat: pos[0],
          lng: pos[1],
          heading: sim.direction === -1 ? (h + 180) % 360 : h,
          speed: SIM_SPEED_MPS,
          source: "sim",
          updatedAt: Date.now(),
        });
      }

      setVehicles(next);
      rafId.current = requestAnimationFrame(tick);
    }

    rafId.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId.current);
  }, []);

  return vehicles;
}

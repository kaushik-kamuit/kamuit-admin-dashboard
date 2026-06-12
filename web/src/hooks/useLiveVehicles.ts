/**
 * Manages live vehicle positions for the LiveMap.
 *
 * Single data source: WebSocket (/api/live/ws) consuming real driver pings
 * forwarded by the backend via Postgres LISTEN/NOTIFY.
 *
 * Cars appear on the map ONLY when actual drivers are sending GPS from the
 * mobile app.  No simulation, no faking.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface VehicleState {
  runId: string;
  driverId: string;
  lat: number;
  lng: number;
  heading: number;
  speed: number; // m/s
  updatedAt: number; // Date.now()
}

const STALE_THRESHOLD_MS = 5 * 60 * 1000; // hide after 5 min without a ping
const PRUNE_INTERVAL_MS = 30_000;

export function useLiveVehicles() {
  const [vehicles, setVehicles] = useState<Map<string, VehicleState>>(new Map());

  const vehiclesRef = useRef<Map<string, VehicleState>>(new Map());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();

  const flush = useCallback(() => {
    setVehicles(new Map(vehiclesRef.current));
  }, []);

  const upsert = useCallback(
    (v: VehicleState) => {
      vehiclesRef.current.set(v.runId, v);
      flush();
    },
    [flush],
  );

  /* ── WebSocket ──────────────────────────────────────────────── */
  const connectWs = useCallback(() => {
    const token = localStorage.getItem("kamuit_admin_token");
    if (!token) return;

    const baseUrl =
      (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8001";
    const wsUrl =
      baseUrl.replace(/^http/, "ws") +
      "/api/live/ws?token=" +
      encodeURIComponent(token);

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);

          // Real-time ping from NOTIFY
          if (msg.driver_run_id && msg.lat != null && msg.lng != null) {
            upsert({
              runId: msg.driver_run_id,
              driverId: msg.driver_id ?? "",
              lat: msg.lat,
              lng: msg.lng,
              heading: msg.heading ?? 0,
              speed: msg.speed_mps ?? 0,
              updatedAt: Date.now(),
            });
          }

          // Init message — latest ping per active run
          if (msg.type === "init" && Array.isArray(msg.runs)) {
            for (const r of msg.runs) {
              if (r.lat != null && r.lng != null) {
                vehiclesRef.current.set(r.run_id, {
                  runId: r.run_id,
                  driverId: r.driver_id ?? "",
                  lat: r.lat,
                  lng: r.lng,
                  heading: r.heading ?? 0,
                  speed: r.speed_mps ?? 0,
                  updatedAt: Date.now(),
                });
              }
            }
            flush();
          }
        } catch {
          /* ignore malformed */
        }
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
    } catch {
      /* can't open ws — will retry */
    }
  }, [upsert, flush]);

  useEffect(() => {
    connectWs();
    return () => {
      wsRef.current?.close();
      clearTimeout(reconnectTimer.current);
    };
  }, [connectWs]);

  /* ── Prune stale vehicles ───────────────────────────────────── */
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      let pruned = false;
      for (const [runId, v] of vehiclesRef.current) {
        if (now - v.updatedAt > STALE_THRESHOLD_MS) {
          vehiclesRef.current.delete(runId);
          pruned = true;
        }
      }
      if (pruned) flush();
    }, PRUNE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [flush]);

  return vehicles;
}

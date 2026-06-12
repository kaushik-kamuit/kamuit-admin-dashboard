import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { Map, CircleMarker, Polyline, Popup } from "../components/MapView";
import type { LatLng } from "../components/MapView";
import { decodePolyline } from "../lib/polyline";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type RunStatus = "IN_PROGRESS" | "PARTIALLY_FILLED" | "OPEN";

interface ActiveRun {
  run_id: string;
  driver_id: string;
  status: RunStatus;
  origin: LatLng;
  destination: LatLng;
  route_polyline: string | null;
  lat: number;
  lng: number;
  ts: string;
}

interface WsInitMessage {
  type: "init";
  runs: ActiveRun[];
}

interface WsPingMessage {
  driver_run_id: string;
  driver_id: string;
  lat: number;
  lng: number;
  ts: string;
}

type ConnectionMode = "ws" | "polling" | "disconnected";

const STATUS_COLOR: Record<RunStatus, string> = {
  IN_PROGRESS: "#22c55e",
  PARTIALLY_FILLED: "#3b82f6",
  OPEN: "#94a3b8",
};

const AUSTIN_CENTER: LatLng = [30.267, -97.743];
function getWsUrl(): string {
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8001";
  const wsBase = base.replace(/^http/, "ws");
  const token = localStorage.getItem("kamuit_admin_token") ?? "";
  return `${wsBase}/api/live/ws?token=${encodeURIComponent(token)}`;
}
const POLL_INTERVAL = 10_000;
const WS_KEEPALIVE_INTERVAL = 30_000;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LiveMap() {
  const [runs, setRuns] = useState<Record<string, ActiveRun>>({});
  const [connMode, setConnMode] = useState<ConnectionMode>("disconnected");
  const [wsClients, setWsClients] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  /* ---- REST fallback ---- */
  const { data: polledData } = useQuery({
    queryKey: ["live-active-runs"],
    queryFn: async () => (await api.get("/api/live/active-runs")).data,
    refetchInterval: connMode !== "ws" ? POLL_INTERVAL : false,
    enabled: connMode !== "ws",
  });

  useEffect(() => {
    if (connMode === "polling" && polledData?.runs) {
      const map: Record<string, ActiveRun> = {};
      for (const r of polledData.runs as ActiveRun[]) map[r.run_id] = r;
      setRuns(map);
      if (polledData.ws_clients != null) setWsClients(polledData.ws_clients);
    }
  }, [polledData, connMode]);

  /* ---- WebSocket ---- */
  const connectWs = useCallback(() => {
    if (wsRef.current) return;

    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnMode("ws");
      keepAliveRef.current = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send("ping");
      }, WS_KEEPALIVE_INTERVAL);
    };

    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data);

        if (msg.type === "init") {
          const init = msg as WsInitMessage;
          const map: Record<string, ActiveRun> = {};
          for (const r of init.runs) map[r.run_id] = r;
          setRuns(map);
          if ((msg as any).ws_clients != null) setWsClients((msg as any).ws_clients);
          return;
        }

        const ping = msg as WsPingMessage;
        setRuns((prev) => {
          const existing = prev[ping.driver_run_id];
          if (!existing) return prev;
          return {
            ...prev,
            [ping.driver_run_id]: {
              ...existing,
              lat: ping.lat,
              lng: ping.lng,
              ts: ping.ts,
            },
          };
        });
      } catch {
        // non-JSON frames (e.g. "pong") — ignore
      }
    };

    ws.onclose = () => {
      cleanup();
      setConnMode("polling");
      setTimeout(connectWs, 5_000);
    };

    ws.onerror = () => {
      ws.close();
    };
  }, []);

  const cleanup = useCallback(() => {
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    wsRef.current = null;
  }, []);

  useEffect(() => {
    connectWs();
    return () => {
      const ws = wsRef.current;
      if (ws) {
        ws.onclose = null; // prevent reconnect on intentional teardown
        ws.close();
      }
      cleanup();
    };
  }, [connectWs, cleanup]);

  /* ---- Derived ---- */
  const runList = Object.values(runs);
  const driversOnline = new Set(runList.map((r) => r.driver_id)).size;

  const connDot =
    connMode === "ws"
      ? "bg-green-500"
      : connMode === "polling"
        ? "bg-yellow-500"
        : "bg-red-500";

  const connLabel =
    connMode === "ws"
      ? "WebSocket connected"
      : connMode === "polling"
        ? "Polling (WS unavailable)"
        : "Disconnected";

  /* ---- Render ---- */
  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
          LIVE TRACKING
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Live Trip Map</h1>
        <p className="text-sm text-slate-500">
          Real-time driver positions and active trip tracking
        </p>
      </div>

      {/* Stats bar */}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-slate-200 bg-white px-5 py-3">
        {/* Connection indicator */}
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${connDot}`} />
          {connLabel}
        </div>

        <div className="mx-2 h-5 w-px bg-slate-200" />

        <Stat label="Active Runs" value={runList.length} />
        <Stat label="Drivers Online" value={driversOnline} />
        <Stat label="WS Clients" value={wsClients} />
      </div>

      {/* Map */}
      <div className="rounded-lg border border-slate-200 bg-white p-2">
        <Map center={AUSTIN_CENTER} zoom={11} height="calc(100vh - 280px)">
          {runList.map((run) => (
            <RunMarkers key={run.run_id} run={run} />
          ))}
        </Map>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center gap-1.5 text-sm">
      <span className="font-semibold text-slate-900">{value}</span>
      <span className="text-slate-500">{label}</span>
    </div>
  );
}

function RunMarkers({ run }: { run: ActiveRun }) {
  const color = STATUS_COLOR[run.status] ?? "#94a3b8";
  const lastPing = run.ts ? new Date(run.ts).toLocaleTimeString() : "—";

  const routePositions = useMemo<LatLng[]>(() => {
    if (run.route_polyline) {
      try {
        return decodePolyline(run.route_polyline);
      } catch {
        // fall through to straight-line fallback
      }
    }
    return [run.origin, run.destination];
  }, [run.route_polyline, run.origin, run.destination]);

  return (
    <>
      {/* Origin marker */}
      <CircleMarker
        center={run.origin}
        radius={5}
        pathOptions={{ color: "#6b7280", fillColor: "#6b7280", fillOpacity: 0.6, weight: 2 }}
      >
        <Popup>
          <span className="text-xs text-slate-600">Origin</span>
        </Popup>
      </CircleMarker>

      {/* Destination marker */}
      <CircleMarker
        center={run.destination}
        radius={5}
        pathOptions={{ color: "#6b7280", fillColor: "#6b7280", fillOpacity: 0.6, weight: 2 }}
      >
        <Popup>
          <span className="text-xs text-slate-600">Destination</span>
        </Popup>
      </CircleMarker>

      {/* Actual route polyline (road-following when data exists, straight-line fallback) */}
      <Polyline
        positions={routePositions}
        pathOptions={{
          color: run.route_polyline ? "#3b82f6" : "#9ca3af",
          weight: run.route_polyline ? 3 : 1.5,
          dashArray: run.route_polyline ? undefined : "6 4",
          opacity: 0.8,
        }}
      />

      {/* Driver position */}
      <CircleMarker
        center={[run.lat, run.lng]}
        radius={8}
        pathOptions={{ color, fillColor: color, fillOpacity: 0.85, weight: 2 }}
      >
        <Popup>
          <div className="space-y-1 text-sm min-w-[160px]">
            <div>
              <span className="text-slate-500">Run </span>
              <span className="font-mono font-semibold">{run.run_id.slice(0, 8)}</span>
            </div>
            <div>
              <span className="text-slate-500">Driver </span>
              <span className="font-mono font-semibold">{run.driver_id.slice(0, 8)}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-full"
                style={{ backgroundColor: color }}
              />
              <span className="font-medium">{run.status}</span>
            </div>
            <div className="text-xs text-slate-500">Last ping: {lastPing}</div>
          </div>
        </Popup>
      </CircleMarker>
    </>
  );
}

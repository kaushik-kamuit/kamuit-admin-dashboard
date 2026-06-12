import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { Map, CircleMarker, Polyline, Popup } from "../components/MapView";
import type { LatLng } from "../components/MapView";
import { decodePolyline } from "../lib/polyline";
import { useLiveVehicles } from "../hooks/useLiveVehicles";
import CarMarker from "../components/CarMarker";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface MapRun {
  run_id: string;
  driver_id: string;
  status: string;
  route_polyline: string | null;
  origin_address: string;
  dest_address: string;
  origin: LatLng;
  destination: LatLng;
  ride_id: string | null;
  rider_id: string | null;
  created_at: string | null;
}

type RunCategory = "active" | "completed" | "scheduled";

interface MapRunsResponse {
  active: MapRun[];
  completed: MapRun[];
  scheduled: MapRun[];
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const COLLEGE_STATION: LatLng = [30.6280, -96.3344];

const CATEGORY_CONFIG: Record<RunCategory, { label: string; color: string; icon: string }> = {
  active:    { label: "Active",    color: "#22c55e", icon: "●" },
  completed: { label: "Completed", color: "#6366f1", icon: "●" },
  scheduled: { label: "Scheduled", color: "#f59e0b", icon: "●" },
};

const POLL_INTERVAL = 15_000;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LiveMap() {
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Record<RunCategory, boolean>>({
    active: true,
    completed: true,
    scheduled: true,
  });

  const { data, isLoading } = useQuery<MapRunsResponse>({
    queryKey: ["live-map-runs"],
    queryFn: async () => (await api.get("/api/live/map-runs")).data,
    refetchInterval: POLL_INTERVAL,
  });

  const categorisedRuns = useMemo(() => {
    if (!data) return [];
    const result: { run: MapRun; category: RunCategory }[] = [];
    for (const cat of ["active", "completed", "scheduled"] as RunCategory[]) {
      if (!filters[cat]) continue;
      for (const run of data[cat] ?? []) {
        if (run.route_polyline) result.push({ run, category: cat });
      }
    }
    return result;
  }, [data, filters]);

  const counts = useMemo(() => ({
    active: data?.active?.length ?? 0,
    completed: data?.completed?.length ?? 0,
    scheduled: data?.scheduled?.length ?? 0,
  }), [data]);

  const toggle = (cat: RunCategory) =>
    setFilters((p) => ({ ...p, [cat]: !p[cat] }));

  const goToRun = (run: MapRun) => {
    if (run.ride_id) navigate(`/rides/${run.ride_id}`);
    else navigate(`/driver-runs/${run.run_id}`);
  };

  /* ── Live vehicle tracking (real pings only) ─────────────────── */
  const vehicles = useLiveVehicles();
  const vehicleCount = vehicles.size;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
          LIVE MAP
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">
          College Station — Route Map
        </h1>
        <p className="text-sm text-slate-500">
          All driver-run routes with polylines · click any route to view details
        </p>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3">
        {(["active", "completed", "scheduled"] as RunCategory[]).map((cat) => {
          const cfg = CATEGORY_CONFIG[cat];
          const on = filters[cat];
          return (
            <button
              key={cat}
              onClick={() => toggle(cat)}
              className={`
                flex items-center gap-2 rounded-full px-4 py-1.5 text-sm font-medium
                transition-all border
                ${on
                  ? "border-transparent text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-400"
                }
              `}
              style={on ? { backgroundColor: cfg.color } : undefined}
            >
              <span className="text-xs">{cfg.icon}</span>
              {cfg.label}
              <span className={`
                ml-1 rounded-full px-1.5 py-0.5 text-xs font-semibold
                ${on ? "bg-white/25 text-white" : "bg-slate-100 text-slate-400"}
              `}>
                {counts[cat]}
              </span>
            </button>
          );
        })}

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          {vehicleCount > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              <span className="text-green-600 font-medium">
                {vehicleCount} live vehicle{vehicleCount !== 1 ? "s" : ""}
              </span>
            </span>
          )}
          {isLoading && (
            <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
          )}
          <span>
            {categorisedRuns.length} route{categorisedRuns.length !== 1 ? "s" : ""} shown
          </span>
        </div>
      </div>

      {/* Map */}
      <div className="rounded-lg border border-slate-200 bg-white p-2 relative">
        <Map center={COLLEGE_STATION} zoom={13} height="calc(100vh - 280px)">
          {categorisedRuns.map(({ run, category }) => (
            <RouteLayer
              key={run.run_id}
              run={run}
              category={category}
              onClick={() => goToRun(run)}
            />
          ))}

          {/* Live vehicle markers */}
          {[...vehicles.values()].map((v) => {
            const run = data?.active?.find((r) => r.run_id === v.runId);
            return (
              <CarMarker
                key={`car-${v.runId}`}
                position={[v.lat, v.lng]}
                heading={v.heading}
                onClick={() => run && goToRun(run)}
              >
                <Popup>
                  <div className="text-xs space-y-1 min-w-[160px]">
                    <div className="font-semibold flex items-center gap-1.5">
                      <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
                      Live tracking
                    </div>
                    <div>
                      <span className="text-slate-400">Run </span>
                      <span className="font-mono">{v.runId.slice(0, 8)}...</span>
                    </div>
                    <div>
                      <span className="text-slate-400">Speed </span>
                      {(v.speed * 3.6).toFixed(0)} km/h
                    </div>
                    <div>
                      <span className="text-slate-400">Heading </span>
                      {v.heading.toFixed(0)}°
                    </div>
                  </div>
                </Popup>
              </CarMarker>
            );
          })}
        </Map>

        {/* Legend overlay */}
        <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-slate-200 bg-white/90 backdrop-blur-sm px-4 py-3 shadow-sm">
          <div className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 mb-2">
            Legend
          </div>
          <div className="space-y-1.5">
            {(["active", "completed", "scheduled"] as RunCategory[]).map((cat) => {
              const cfg = CATEGORY_CONFIG[cat];
              return (
                <div key={cat} className="flex items-center gap-2 text-xs text-slate-600">
                  <span
                    className="inline-block h-[3px] w-5 rounded"
                    style={{ backgroundColor: cfg.color, opacity: 0.7 }}
                  />
                  {cfg.label} routes
                </div>
              );
            })}
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="inline-block h-2 w-2 rounded-full bg-slate-700" />
              Origin / Destination
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span className="inline-block h-3 w-3 rounded-sm bg-green-500" />
              Active vehicle
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Route layer for a single run                                       */
/* ------------------------------------------------------------------ */

function RouteLayer({
  run,
  category,
  onClick,
}: {
  run: MapRun;
  category: RunCategory;
  onClick: () => void;
}) {
  const color = CATEGORY_CONFIG[category].color;

  const positions = useMemo<LatLng[]>(() => {
    if (run.route_polyline) {
      try {
        return decodePolyline(run.route_polyline);
      } catch { /* fallback */ }
    }
    return [run.origin, run.destination];
  }, [run.route_polyline, run.origin, run.destination]);

  const popupContent = (
    <div className="space-y-1 text-sm min-w-[200px]">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-semibold capitalize">{category}</span>
        <span className="text-slate-400">·</span>
        <span className="text-slate-500 text-xs">{run.status}</span>
      </div>
      <div className="text-xs">
        <span className="text-slate-400">From </span>
        <span className="text-slate-700">{run.origin_address || "—"}</span>
      </div>
      <div className="text-xs">
        <span className="text-slate-400">To </span>
        <span className="text-slate-700">{run.dest_address || "—"}</span>
      </div>
      <div className="text-xs text-slate-400">
        Run {run.run_id.slice(0, 8)}…
        {run.ride_id && <> · Ride {run.ride_id.slice(0, 8)}…</>}
      </div>
      <div className="pt-1 text-[11px] text-blue-600 font-medium cursor-pointer">
        Click to view details →
      </div>
    </div>
  );

  return (
    <>
      {/* Polyline */}
      <Polyline
        positions={positions}
        pathOptions={{
          color,
          weight: 4,
          opacity: 0.55,
          lineCap: "round",
          lineJoin: "round",
        }}
        eventHandlers={{ click: onClick }}
      >
        <Popup>{popupContent}</Popup>
      </Polyline>

      {/* Origin dot */}
      <CircleMarker
        center={run.origin}
        radius={5}
        pathOptions={{
          color: "#1e293b",
          fillColor: color,
          fillOpacity: 0.85,
          weight: 2,
        }}
        eventHandlers={{ click: onClick }}
      >
        <Popup>
          <div className="text-xs space-y-1">
            <div className="font-semibold">Origin</div>
            <div className="text-slate-600">{run.origin_address || "—"}</div>
            <div className="text-blue-600 font-medium cursor-pointer">Click to view →</div>
          </div>
        </Popup>
      </CircleMarker>

      {/* Destination dot */}
      <CircleMarker
        center={run.destination}
        radius={5}
        pathOptions={{
          color: "#1e293b",
          fillColor: "#1e293b",
          fillOpacity: 0.7,
          weight: 2,
        }}
        eventHandlers={{ click: onClick }}
      >
        <Popup>
          <div className="text-xs space-y-1">
            <div className="font-semibold">Destination</div>
            <div className="text-slate-600">{run.dest_address || "—"}</div>
            <div className="text-blue-600 font-medium cursor-pointer">Click to view →</div>
          </div>
        </Popup>
      </CircleMarker>
    </>
  );
}

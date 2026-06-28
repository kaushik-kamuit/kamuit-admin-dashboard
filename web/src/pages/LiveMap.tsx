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

type MarketId =
  | "austin"
  | "college-station"
  | "houston"
  | "bay-area"
  | "new-york"
  | "chicago"
  | "dallas-fort-worth"
  | "los-angeles"
  | "seattle"
  | "miami";

type Bounds = [LatLng, LatLng];

interface Market {
  id: MarketId;
  label: string;
  center: LatLng;
  bounds: Bounds;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const MARKETS: Market[] = [
  {
    id: "austin",
    label: "Austin",
    center: [30.2672, -97.7431],
    bounds: [[30.05, -98.05], [30.55, -97.45]],
  },
  {
    id: "college-station",
    label: "College Station",
    center: [30.6280, -96.3344],
    bounds: [[30.30, -96.55], [30.75, -96.02]],
  },
  {
    id: "houston",
    label: "Houston",
    center: [29.7604, -95.3698],
    bounds: [[29.45, -95.85], [30.15, -94.95]],
  },
  {
    id: "bay-area",
    label: "Bay Area",
    center: [37.60, -122.05],
    bounds: [[37.05, -122.75], [38.20, -121.40]],
  },
  {
    id: "new-york",
    label: "New York",
    center: [40.7128, -74.0060],
    bounds: [[40.45, -74.35], [41.05, -73.65]],
  },
  {
    id: "chicago",
    label: "Chicago",
    center: [41.8781, -87.6298],
    bounds: [[41.60, -88.10], [42.10, -87.45]],
  },
  {
    id: "dallas-fort-worth",
    label: "Dallas-Fort Worth",
    center: [32.7767, -96.7970],
    bounds: [[32.45, -97.55], [33.20, -96.35]],
  },
  {
    id: "los-angeles",
    label: "Los Angeles",
    center: [34.0522, -118.2437],
    bounds: [[33.70, -118.70], [34.35, -117.85]],
  },
  {
    id: "seattle",
    label: "Seattle",
    center: [47.6062, -122.3321],
    bounds: [[47.35, -122.55], [47.85, -122.05]],
  },
  {
    id: "miami",
    label: "Miami",
    center: [25.7617, -80.1918],
    bounds: [[25.50, -80.45], [26.05, -79.95]],
  },
];

const DEFAULT_MARKET_ID: MarketId = "college-station";

const CATEGORY_CONFIG: Record<RunCategory, { label: string; color: string }> = {
  active: { label: "Active", color: "#22c55e" },
  completed: { label: "Completed", color: "#6366f1" },
  scheduled: { label: "Scheduled", color: "#f59e0b" },
};

const POLL_INTERVAL = 15_000;

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function LiveMap() {
  const navigate = useNavigate();
  const [selectedMarketId, setSelectedMarketId] = useState<MarketId>(DEFAULT_MARKET_ID);
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

  const selectedMarket = useMemo(
    () => MARKETS.find((market) => market.id === selectedMarketId) ?? MARKETS[0],
    [selectedMarketId],
  );

  const marketRunsByCategory = useMemo(() => {
    const result: Record<RunCategory, MapRun[]> = {
      active: [],
      completed: [],
      scheduled: [],
    };

    if (!data) return result;

    for (const cat of ["active", "completed", "scheduled"] as RunCategory[]) {
      for (const run of data[cat] ?? []) {
        if (run.route_polyline && runTouchesBounds(run, selectedMarket.bounds)) {
          result[cat].push(run);
        }
      }
    }

    return result;
  }, [data, selectedMarket.bounds]);

  const counts = useMemo(() => ({
    active: marketRunsByCategory.active.length,
    completed: marketRunsByCategory.completed.length,
    scheduled: marketRunsByCategory.scheduled.length,
  }), [marketRunsByCategory]);

  const categorisedRuns = useMemo(() => {
    const result: { run: MapRun; category: RunCategory }[] = [];

    for (const cat of ["active", "completed", "scheduled"] as RunCategory[]) {
      if (!filters[cat]) continue;
      for (const run of marketRunsByCategory[cat]) {
        result.push({ run, category: cat });
      }
    }

    return result;
  }, [filters, marketRunsByCategory]);

  const toggle = (cat: RunCategory) =>
    setFilters((p) => ({ ...p, [cat]: !p[cat] }));

  const goToRun = (run: MapRun) => {
    if (run.ride_id) navigate(`/rides/${run.ride_id}`);
    else navigate(`/driver-runs/${run.run_id}`);
  };

  const vehicles = useLiveVehicles();
  const visibleVehicles = useMemo(
    () => [...vehicles.values()].filter((vehicle) => latLngInBounds([vehicle.lat, vehicle.lng], selectedMarket.bounds)),
    [vehicles, selectedMarket.bounds],
  );
  const vehicleCount = visibleVehicles.length;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
          LIVE MAP
        </div>
        <h1 className="mb-1 text-2xl font-bold text-slate-900">
          {selectedMarket.label} Route Map
        </h1>
        <p className="text-sm text-slate-500">
          Driver-run routes, scheduled trips, and live vehicle pings in the selected market.
        </p>
      </div>

      <div className="rounded-lg border border-slate-200 bg-white px-5 py-3">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Market
            </div>
            <div className="text-sm text-slate-600">
              Selecting a city moves the map and filters the live layers to that area.
            </div>
          </div>
          <div className="text-xs font-medium text-slate-400">
            {MARKETS.length} markets
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {MARKETS.map((market) => {
            const active = market.id === selectedMarket.id;
            return (
              <button
                key={market.id}
                type="button"
                onClick={() => setSelectedMarketId(market.id)}
                className={`
                  rounded border px-3 py-1.5 text-sm font-medium transition-colors
                  ${active
                    ? "border-[#0BA26D] bg-[#0BA26D] text-white"
                    : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }
                `}
              >
                {market.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-5 py-3">
        {(["active", "completed", "scheduled"] as RunCategory[]).map((cat) => {
          const cfg = CATEGORY_CONFIG[cat];
          const on = filters[cat];
          return (
            <button
              key={cat}
              type="button"
              onClick={() => toggle(cat)}
              className={`
                flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-medium transition-all
                ${on
                  ? "border-transparent text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-400"
                }
              `}
              style={on ? { backgroundColor: cfg.color } : undefined}
            >
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: on ? "currentColor" : cfg.color }}
              />
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
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
              </span>
              <span className="font-medium text-green-600">
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

      <div className="relative rounded-lg border border-slate-200 bg-white p-2">
        <Map
          center={selectedMarket.center}
          zoom={12}
          bounds={selectedMarket.bounds}
          height="max(420px, calc(100vh - 360px))"
        >
          {categorisedRuns.map(({ run, category }) => (
            <RouteLayer
              key={run.run_id}
              run={run}
              category={category}
              onClick={() => goToRun(run)}
            />
          ))}

          {visibleVehicles.map((v) => {
            const run = data?.active?.find((r) => r.run_id === v.runId);
            return (
              <CarMarker
                key={`car-${v.runId}`}
                position={[v.lat, v.lng]}
                heading={v.heading}
                onClick={() => run && goToRun(run)}
              >
                <Popup>
                  <div className="min-w-[160px] space-y-1 text-xs">
                    <div className="flex items-center gap-1.5 font-semibold">
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
                      {v.heading.toFixed(0)} deg
                    </div>
                  </div>
                </Popup>
              </CarMarker>
            );
          })}
        </Map>

        <div className="absolute bottom-4 left-4 z-[1000] rounded-lg border border-slate-200 bg-white/90 px-4 py-3 shadow-sm backdrop-blur-sm">
          <div className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
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
              Origin / destination
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
      } catch {
        // Fall back to a straight line when an old route has a bad polyline.
      }
    }
    return [run.origin, run.destination];
  }, [run.route_polyline, run.origin, run.destination]);

  const popupContent = (
    <div className="min-w-[200px] space-y-1 text-sm">
      <div className="flex items-center gap-2">
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <span className="font-semibold capitalize">{category}</span>
        <span className="text-slate-400">/</span>
        <span className="text-xs text-slate-500">{run.status}</span>
      </div>
      <div className="text-xs">
        <span className="text-slate-400">From </span>
        <span className="text-slate-700">{run.origin_address || "-"}</span>
      </div>
      <div className="text-xs">
        <span className="text-slate-400">To </span>
        <span className="text-slate-700">{run.dest_address || "-"}</span>
      </div>
      <div className="text-xs text-slate-400">
        Run {run.run_id.slice(0, 8)}...
        {run.ride_id && <> / Ride {run.ride_id.slice(0, 8)}...</>}
      </div>
      <div className="cursor-pointer pt-1 text-[11px] font-medium text-blue-600">
        Open details
      </div>
    </div>
  );

  return (
    <>
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
          <div className="space-y-1 text-xs">
            <div className="font-semibold">Origin</div>
            <div className="text-slate-600">{run.origin_address || "-"}</div>
            <div className="cursor-pointer font-medium text-blue-600">Open details</div>
          </div>
        </Popup>
      </CircleMarker>

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
          <div className="space-y-1 text-xs">
            <div className="font-semibold">Destination</div>
            <div className="text-slate-600">{run.dest_address || "-"}</div>
            <div className="cursor-pointer font-medium text-blue-600">Open details</div>
          </div>
        </Popup>
      </CircleMarker>
    </>
  );
}

function runTouchesBounds(run: MapRun, bounds: Bounds) {
  if (latLngInBounds(run.origin, bounds) || latLngInBounds(run.destination, bounds)) {
    return true;
  }

  if (!run.route_polyline) return false;

  try {
    return decodePolyline(run.route_polyline).some((point) => latLngInBounds(point, bounds));
  } catch {
    return false;
  }
}

function latLngInBounds(point: LatLng, bounds: Bounds) {
  const [[latA, lngA], [latB, lngB]] = bounds;
  const south = Math.min(latA, latB);
  const north = Math.max(latA, latB);
  const west = Math.min(lngA, lngB);
  const east = Math.max(lngA, lngB);
  const [lat, lng] = point;

  return lat >= south && lat <= north && lng >= west && lng <= east;
}

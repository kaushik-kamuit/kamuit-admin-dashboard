import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { api } from "../api/client";
import { Map, CircleMarker, Popup } from "../components/MapView";

type Layer = "rides_pickup" | "rides_drop" | "runs_origin" | "runs_dest" | "pings";
type Res = "500m" | "2km" | "10km";

const LAYERS: { value: Layer; label: string; endpoint: string; params: any; color: string }[] = [
  { value: "rides_pickup", label: "Ride pickups", endpoint: "/api/analytics/heatmap/rides",
    params: { side: "pickup" }, color: "#f59e0b" },
  { value: "rides_drop", label: "Ride dropoffs", endpoint: "/api/analytics/heatmap/rides",
    params: { side: "drop" }, color: "#8b5cf6" },
  { value: "runs_origin", label: "Driver-run origins", endpoint: "/api/analytics/heatmap/driver-runs",
    params: { side: "origin" }, color: "#10b981" },
  { value: "runs_dest", label: "Driver-run destinations", endpoint: "/api/analytics/heatmap/driver-runs",
    params: { side: "dest" }, color: "#ef4444" },
  { value: "pings", label: "Driver GPS density", endpoint: "/api/analytics/heatmap/pings",
    params: {}, color: "#2563eb" },
];

const RIDE_STATUSES = ["REQUESTED", "OFFER_SENT", "ACCEPTED", "PICKUP_ARRIVING", "IN_PROGRESS", "COMPLETED", "CANCELLED"];

export default function Heatmap() {
  const [layer, setLayer] = useState<Layer>("rides_pickup");
  const [resolution, setResolution] = useState<Res>("2km");
  const [status, setStatus] = useState<string>("");

  const cfg = LAYERS.find((l) => l.value === layer)!;
  const isRides = layer.startsWith("rides_");

  const { data, isLoading } = useQuery({
    queryKey: ["heatmap", layer, resolution, status],
    queryFn: async () => {
      const params: any = { ...cfg.params, resolution };
      if (isRides && status) params.status = status;
      return (await api.get(cfg.endpoint, { params })).data;
    },
  });

  const cells = (data?.cells ?? []) as any[];
  const maxN = useMemo(
    () => cells.reduce((m, c) => Math.max(m, Number(c.n || 0)), 1),
    [cells],
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Heatmap</h1>

      <div className="bg-white rounded shadow-sm p-4 flex flex-wrap gap-3 items-center">
        <select value={layer} onChange={(e) => setLayer(e.target.value as Layer)} className="border rounded px-2 py-1 text-sm">
          {LAYERS.map((l) => (<option key={l.value} value={l.value}>{l.label}</option>))}
        </select>
        <select value={resolution} onChange={(e) => setResolution(e.target.value as Res)} className="border rounded px-2 py-1 text-sm">
          <option value="500m">500 m cells</option>
          <option value="2km">2 km cells</option>
          <option value="10km">10 km cells</option>
        </select>
        {isRides && (
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="border rounded px-2 py-1 text-sm">
            <option value="">All statuses</option>
            {RIDE_STATUSES.map((s) => (<option key={s} value={s}>{s}</option>))}
          </select>
        )}
        <div className="text-xs text-slate-500 ml-auto">
          {isLoading ? "Loading..." : `${cells.length} cells · max ${maxN} in one cell`}
        </div>
      </div>

      <div className="bg-white rounded shadow-sm p-3">
        <Map center={[30.27, -97.74]} zoom={11} height={580}>
          {cells.map((c) => {
            const weight = Math.sqrt(Number(c.n) / maxN);
            const radius = 6 + weight * 28;
            return (
              <CircleMarker
                key={c.cell_key}
                center={[Number(c.avg_lat), Number(c.avg_lng)]}
                radius={radius}
                pathOptions={{
                  color: cfg.color,
                  fillColor: cfg.color,
                  fillOpacity: 0.15 + weight * 0.55,
                  weight: 1,
                }}
              >
                <Popup>
                  <div className="text-sm">
                    <div><b>{c.n}</b> in this cell</div>
                    <div className="text-xs text-slate-500">
                      cell: {c.cell_key}<br />
                      center: {Number(c.center_lat).toFixed(4)}, {Number(c.center_lng).toFixed(4)}
                    </div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </Map>
      </div>

      <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded p-3">
        <b>Note:</b> Ride / driver-run origins and pickups are ALL data that was
        already in the DB but not aggregated. Pings are newly captured via the
        append-only <code>driver_location_pings</code> table written by a DB
        trigger on every <code>driver_locations</code> update (no app code
        changed). Cell sizes are approximate at US mid-latitudes.
      </div>
    </div>
  );
}

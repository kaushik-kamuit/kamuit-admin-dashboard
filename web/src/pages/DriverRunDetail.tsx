import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "react-router-dom";
import { api } from "../api/client";
import { Map, Polyline, CircleMarker, Popup, Marker } from "../components/MapView";
import { useMemo } from "react";
import L from "leaflet";
import { decodePolyline } from "../lib/polyline";

const driverIcon = L.divIcon({
  className: "",
  html: '<div style="background:#2563eb;border:2px solid #fff;border-radius:999px;width:14px;height:14px;box-shadow:0 0 0 1px #1e40af;"></div>',
  iconSize: [14, 14],
});
const originIcon = L.divIcon({
  className: "",
  html: '<div style="background:#10b981;border:2px solid #fff;border-radius:2px;width:16px;height:16px;box-shadow:0 0 0 1px #047857;"></div>',
  iconSize: [16, 16],
});
const destIcon = L.divIcon({
  className: "",
  html: '<div style="background:#ef4444;border:2px solid #fff;border-radius:2px;width:16px;height:16px;box-shadow:0 0 0 1px #b91c1c;"></div>',
  iconSize: [16, 16],
});
const pickupIcon = L.divIcon({
  className: "",
  html: '<div style="background:#f59e0b;border:2px solid #fff;border-radius:999px;width:10px;height:10px;"></div>',
  iconSize: [10, 10],
});
const dropoffIcon = L.divIcon({
  className: "",
  html: '<div style="background:#8b5cf6;border:2px solid #fff;border-radius:999px;width:10px;height:10px;"></div>',
  iconSize: [10, 10],
});

export default function DriverRunDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: detail } = useQuery({
    queryKey: ["driver-run", id],
    queryFn: async () => (await api.get(`/api/driver-runs/${id}`)).data,
    enabled: !!id,
  });

  const { data: pings } = useQuery({
    queryKey: ["driver-run-pings", id],
    queryFn: async () => (await api.get(`/api/analytics/pings/driver-run/${id}`)).data,
    enabled: !!id,
  });

  const { data: timeline } = useQuery({
    queryKey: ["driver-run-timeline", id],
    queryFn: async () => (await api.get(`/api/analytics/timeline/driver-run/${id}`)).data,
    enabled: !!id,
  });

  const run = detail?.driver_run;
  const assignments = detail?.assignments ?? [];

  const pathLatLngs = useMemo<[number, number][]>(
    () => (pings?.pings ?? []).map((p: any) => [p.latitude, p.longitude]),
    [pings],
  );

  const plannedRoute = useMemo<[number, number][]>(() => {
    if (run?.route_polyline) {
      try {
        return decodePolyline(run.route_polyline);
      } catch { /* ignore */ }
    }
    return [];
  }, [run?.route_polyline]);

  const bounds = useMemo(() => {
    if (!run) return undefined;
    const pts: [number, number][] = [];
    if (run.origin_lat && run.origin_lng) pts.push([run.origin_lat, run.origin_lng]);
    if (run.dest_lat && run.dest_lng) pts.push([run.dest_lat, run.dest_lng]);
    for (const p of pathLatLngs) pts.push(p);
    for (const p of plannedRoute) pts.push(p);
    for (const a of assignments) {
      if (a.pickup_lat) pts.push([a.pickup_lat, a.pickup_lng]);
      if (a.drop_lat) pts.push([a.drop_lat, a.drop_lng]);
    }
    return pts.length > 0 ? (pts as any) : undefined;
  }, [run, pathLatLngs, plannedRoute, assignments]);

  if (!run) return <div className="p-6">Loading...</div>;

  const center: [number, number] = [run.origin_lat ?? 30.27, run.origin_lng ?? -97.74];

  return (
    <div className="space-y-6">
      <div>
        <Link to="/driver-runs" className="text-sm text-blue-600 hover:underline">← Back to driver runs</Link>
        <h1 className="text-2xl font-semibold mt-2">
          Driver Run <span className="font-mono text-sm text-slate-500">{run.id.slice(0, 8)}…</span>
        </h1>
        <div className="text-sm text-slate-600">
          Driver: {run.driver?.full_name ?? "—"} ({run.driver?.email})
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 text-sm">
        <Stat label="Status" value={run.status} />
        <Stat label="Seats" value={`${run.seats_left} / ${run.seats_total}`} />
        <Stat label="Route distance" value={fmtMeters(run.route_distance_meters)} />
        <Stat label="Route duration" value={fmtSeconds(run.route_duration_seconds)} />
      </div>

      <div className="bg-white rounded shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="font-medium">Route snapshot & trip replay</div>
          <div className="text-xs text-slate-500">
            pings: {pings?.ping_count ?? 0}
            {detail?.pings_summary?.avg_speed_mps !== undefined &&
              ` · avg speed ${fmtSpeed(detail.pings_summary.avg_speed_mps)}`}
          </div>
        </div>

        <Map center={center} zoom={12} height={480} bounds={bounds as any}>
          {run.origin_lat && (
            <Marker position={[run.origin_lat, run.origin_lng]} icon={originIcon}>
              <Popup><b>Origin</b><br />{run.origin_address}</Popup>
            </Marker>
          )}
          {run.dest_lat && (
            <Marker position={[run.dest_lat, run.dest_lng]} icon={destIcon}>
              <Popup><b>Destination</b><br />{run.dest_address}</Popup>
            </Marker>
          )}
          {plannedRoute.length > 1 && (
            <Polyline positions={plannedRoute} pathOptions={{ color: "#94a3b8", weight: 4, opacity: 0.5, dashArray: pathLatLngs.length > 1 ? "6 4" : undefined }} />
          )}
          {pathLatLngs.length > 1 && (
            <Polyline positions={pathLatLngs} pathOptions={{ color: "#2563eb", weight: 3, opacity: 0.9 }} />
          )}
          {assignments.map((a: any) => (
            <span key={a.id}>
              {a.pickup_lat && (
                <Marker position={[a.pickup_lat, a.pickup_lng]} icon={pickupIcon}>
                  <Popup>
                    <b>Pickup</b><br />
                    Ride {a.ride_id.slice(0, 8)}…<br />
                    {a.pickup_address}<br />
                    fraction: {a.pickup_fraction?.toFixed(2)}
                  </Popup>
                </Marker>
              )}
              {a.drop_lat && (
                <Marker position={[a.drop_lat, a.drop_lng]} icon={dropoffIcon}>
                  <Popup>
                    <b>Dropoff</b><br />
                    Ride {a.ride_id.slice(0, 8)}…<br />
                    {a.drop_address}<br />
                    fraction: {a.drop_fraction?.toFixed(2)}
                  </Popup>
                </Marker>
              )}
            </span>
          ))}
          {pathLatLngs.length > 0 && (
            <CircleMarker
              center={pathLatLngs[pathLatLngs.length - 1]}
              radius={7}
              pathOptions={{ color: "#2563eb", fillColor: "#2563eb", fillOpacity: 1 }}
            >
              <Popup>Latest ping</Popup>
            </CircleMarker>
          )}
        </Map>

        <div className="mt-3 flex gap-4 text-xs text-slate-600">
          <LegendDot color="#10b981" label="Run origin" />
          <LegendDot color="#ef4444" label="Run destination" />
          <LegendDot color="#f59e0b" label="Rider pickup" />
          <LegendDot color="#8b5cf6" label="Rider dropoff" />
          <LegendDot color="#94a3b8" label="Planned route" />
          <LegendDot color="#2563eb" label="Actual GPS path" />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white rounded shadow-sm p-4">
          <div className="font-medium mb-2">Status events</div>
          <Timeline events={(timeline?.status_events ?? []).map((e: any) => ({
            at: e.occurred_at,
            label: `${e.from_status ?? "∅"} → ${e.to_status}`,
            sub: `reason: ${e.reason_code}${e.seats_left !== null ? ` · seats ${e.seats_left}/${e.seats_total}` : ""}`,
          }))} />
        </div>

        <div className="bg-white rounded shadow-sm p-4">
          <div className="font-medium mb-2">Assignments ({assignments.length})</div>
          <div className="space-y-2 text-sm">
            {assignments.map((a: any) => (
              <div key={a.id} className="border rounded p-2">
                <div className="flex justify-between">
                  <div className="text-xs font-mono text-slate-500">{a.ride_id.slice(0, 8)}…</div>
                  <span className="px-2 py-0.5 text-xs bg-slate-100 rounded">{a.ride_status}</span>
                </div>
                <div className="text-xs mt-1">
                  Pickup at fraction {a.pickup_fraction?.toFixed(2)} · Drop at {a.drop_fraction?.toFixed(2)}
                </div>
                <div className="text-xs text-slate-500">
                  Rider: {a.rider?.full_name ?? "—"}
                </div>
                <Link to={`/rides/${a.ride_id}`} className="text-xs text-blue-600 hover:underline">Open ride →</Link>
              </div>
            ))}
            {assignments.length === 0 && <div className="text-xs text-slate-500">No assignments yet.</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-white rounded shadow-sm p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-base font-medium mt-0.5">{value ?? "—"}</div>
    </div>
  );
}

function LegendDot({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span style={{ background: color, width: 10, height: 10, borderRadius: 999, display: "inline-block" }} />
      {label}
    </span>
  );
}

function Timeline({ events }: { events: { at: string; label: string; sub?: string }[] }) {
  if (events.length === 0) return <div className="text-xs text-slate-500">No events.</div>;
  return (
    <ol className="relative border-l border-slate-200 ml-2 space-y-3 text-sm">
      {events.map((e, i) => (
        <li key={i} className="ml-4">
          <div className="absolute w-2 h-2 bg-slate-400 rounded-full -left-[5px] mt-2" />
          <div className="font-medium">{e.label}</div>
          {e.sub && <div className="text-xs text-slate-500">{e.sub}</div>}
          <div className="text-xs text-slate-400">{new Date(e.at).toLocaleString()}</div>
        </li>
      ))}
    </ol>
  );
}

function fmtMeters(m?: number | null) {
  if (m == null) return "—";
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
function fmtSeconds(s?: number | null) {
  if (s == null) return "—";
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m} min`;
}
function fmtSpeed(mps?: number | null) {
  if (mps == null) return "—";
  return `${(mps * 3.6).toFixed(1)} km/h`;
}

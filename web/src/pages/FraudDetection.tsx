import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

type FraudSummary = {
  gps_spoofing_signals: number;
  duplicate_rides: number;
  ghost_trips: number;
  suspicious_short_trips: number;
  total_signals: number;
};

type GpsSpoofing = {
  driver_run_id: string;
  recorded_at: string;
  prev_recorded_at: string;
  lat: number;
  lng: number;
  prev_lat: number;
  prev_lng: number;
  distance_m: number;
  dt_seconds: number;
  implied_kmh: number;
};

type DuplicateRide = {
  ride_a: string;
  ride_b: string;
  rider_id: string;
  status_a: string;
  status_b: string;
  created_a: string;
  created_b: string;
  pickup_a: string;
  pickup_b: string;
};

type GhostTrip = {
  ride_id: string;
  rider_id: string;
  pickup_address: string;
  drop_address: string;
  driver_run_id: string;
  driver_id: string;
  created_at: string;
  completed_at: string;
};

type ShortTrip = {
  ride_id: string;
  rider_id: string;
  pickup_address: string;
  drop_address: string;
  started_at: string;
  completed_at: string;
  duration_seconds: number;
};

type Tab = "gps" | "duplicates" | "ghost" | "short";

const TABS: { key: Tab; label: string }[] = [
  { key: "gps", label: "GPS Spoofing" },
  { key: "duplicates", label: "Duplicate Rides" },
  { key: "ghost", label: "Ghost Trips" },
  { key: "short", label: "Short Trips" },
];

export default function FraudDetection() {
  const [tab, setTab] = useState<Tab>("gps");

  const summaryQuery = useQuery<FraudSummary>({
    queryKey: ["fraud", "summary"],
    queryFn: async () => (await api.get("/api/fraud/summary")).data,
  });

  const gpsQuery = useQuery<GpsSpoofing[]>({
    queryKey: ["fraud", "gps-spoofing"],
    queryFn: async () => (await api.get("/api/fraud/gps-spoofing", { params: { limit: 50 } })).data,
    enabled: tab === "gps",
  });

  const duplicatesQuery = useQuery<DuplicateRide[]>({
    queryKey: ["fraud", "duplicate-rides"],
    queryFn: async () => (await api.get("/api/fraud/duplicate-rides", { params: { limit: 50 } })).data,
    enabled: tab === "duplicates",
  });

  const ghostQuery = useQuery<GhostTrip[]>({
    queryKey: ["fraud", "ghost-trips"],
    queryFn: async () => (await api.get("/api/fraud/ghost-trips", { params: { limit: 50 } })).data,
    enabled: tab === "ghost",
  });

  const shortQuery = useQuery<ShortTrip[]>({
    queryKey: ["fraud", "short-trips"],
    queryFn: async () => (await api.get("/api/fraud/short-trips", { params: { limit: 50 } })).data,
    enabled: tab === "short",
  });

  const summary = summaryQuery.data;

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
          FRAUD DETECTION
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Fraud Signals</h1>
        <p className="text-sm text-slate-500">
          Anomalous activity and suspected fraud indicators
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-4">
          <SignalCard label="GPS Spoofing" count={summary.gps_spoofing_signals} tone="red" />
          <SignalCard label="Duplicate Rides" count={summary.duplicate_rides} tone="amber" />
          <SignalCard label="Ghost Trips" count={summary.ghost_trips} tone="red" />
          <SignalCard label="Short Trips" count={summary.suspicious_short_trips} tone="amber" />
          <SignalCard label="Total Signals" count={summary.total_signals} tone="slate" />
        </div>
      )}

      <div className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t.key
                ? "bg-kamuit-500 text-white"
                : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        {tab === "gps" && <GpsSpoofingTable data={gpsQuery.data ?? []} loading={gpsQuery.isLoading} />}
        {tab === "duplicates" && <DuplicateRidesTable data={duplicatesQuery.data ?? []} loading={duplicatesQuery.isLoading} />}
        {tab === "ghost" && <GhostTripsTable data={ghostQuery.data ?? []} loading={ghostQuery.isLoading} />}
        {tab === "short" && <ShortTripsTable data={shortQuery.data ?? []} loading={shortQuery.isLoading} />}
      </div>
    </div>
  );
}

function GpsSpoofingTable({ data, loading }: { data: GpsSpoofing[]; loading: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
        <tr>
          <th className="px-3 py-2 text-left">Driver Run ID</th>
          <th className="px-3 py-2 text-left">Implied Speed</th>
          <th className="px-3 py-2 text-left">Distance</th>
          <th className="px-3 py-2 text-left">Time Delta</th>
          <th className="px-3 py-2 text-left">Timestamp</th>
        </tr>
      </thead>
      <tbody>
        {loading && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
        )}
        {!loading && data.length === 0 && (
          <tr><td colSpan={5} className="px-4 py-6 text-center text-slate-500">No GPS spoofing signals found.</td></tr>
        )}
        {data.map((row, i) => (
          <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-3 py-2 font-mono text-xs text-slate-600">
              {row.driver_run_id.slice(0, 8)}
            </td>
            <td className="px-3 py-2">
              <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${speedSeverity(row.implied_kmh)}`}>
                {row.implied_kmh.toFixed(1)} km/h
              </span>
            </td>
            <td className="px-3 py-2 text-slate-700">{row.distance_m.toFixed(0)} m</td>
            <td className="px-3 py-2 text-slate-700">{row.dt_seconds}s</td>
            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
              {new Date(row.recorded_at).toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function DuplicateRidesTable({ data, loading }: { data: DuplicateRide[]; loading: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
        <tr>
          <th className="px-3 py-2 text-left">Ride A</th>
          <th className="px-3 py-2 text-left">Ride B</th>
          <th className="px-3 py-2 text-left">Rider ID</th>
          <th className="px-3 py-2 text-left">Status A</th>
          <th className="px-3 py-2 text-left">Status B</th>
          <th className="px-3 py-2 text-left">Pickup A</th>
          <th className="px-3 py-2 text-left">Pickup B</th>
          <th className="px-3 py-2 text-left">Created A</th>
          <th className="px-3 py-2 text-left">Created B</th>
        </tr>
      </thead>
      <tbody>
        {loading && (
          <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
        )}
        {!loading && data.length === 0 && (
          <tr><td colSpan={9} className="px-4 py-6 text-center text-slate-500">No duplicate rides found.</td></tr>
        )}
        {data.map((row, i) => (
          <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.ride_a.slice(0, 8)}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.ride_b.slice(0, 8)}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.rider_id.slice(0, 8)}</td>
            <td className="px-3 py-2 text-slate-700">{row.status_a}</td>
            <td className="px-3 py-2 text-slate-700">{row.status_b}</td>
            <td className="px-3 py-2 text-slate-700 max-w-[150px] truncate">{row.pickup_a}</td>
            <td className="px-3 py-2 text-slate-700 max-w-[150px] truncate">{row.pickup_b}</td>
            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
              {new Date(row.created_a).toLocaleString()}
            </td>
            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
              {new Date(row.created_b).toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function GhostTripsTable({ data, loading }: { data: GhostTrip[]; loading: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
        <tr>
          <th className="px-3 py-2 text-left">Ride ID</th>
          <th className="px-3 py-2 text-left">Rider ID</th>
          <th className="px-3 py-2 text-left">Driver ID</th>
          <th className="px-3 py-2 text-left">Pickup</th>
          <th className="px-3 py-2 text-left">Drop</th>
          <th className="px-3 py-2 text-left">Completed At</th>
        </tr>
      </thead>
      <tbody>
        {loading && (
          <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
        )}
        {!loading && data.length === 0 && (
          <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No ghost trips found.</td></tr>
        )}
        {data.map((row, i) => (
          <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.ride_id.slice(0, 8)}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.rider_id.slice(0, 8)}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.driver_id.slice(0, 8)}</td>
            <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate">{row.pickup_address}</td>
            <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate">{row.drop_address}</td>
            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
              {new Date(row.completed_at).toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ShortTripsTable({ data, loading }: { data: ShortTrip[]; loading: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs uppercase text-slate-500">
        <tr>
          <th className="px-3 py-2 text-left">Ride ID</th>
          <th className="px-3 py-2 text-left">Rider ID</th>
          <th className="px-3 py-2 text-left">Pickup</th>
          <th className="px-3 py-2 text-left">Drop</th>
          <th className="px-3 py-2 text-left">Duration</th>
          <th className="px-3 py-2 text-left">Started</th>
          <th className="px-3 py-2 text-left">Completed</th>
        </tr>
      </thead>
      <tbody>
        {loading && (
          <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
        )}
        {!loading && data.length === 0 && (
          <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">No suspicious short trips found.</td></tr>
        )}
        {data.map((row, i) => (
          <tr key={i} className="border-t border-slate-100 hover:bg-slate-50">
            <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.ride_id.slice(0, 8)}</td>
            <td className="px-3 py-2 font-mono text-xs text-slate-600">{row.rider_id.slice(0, 8)}</td>
            <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate">{row.pickup_address}</td>
            <td className="px-3 py-2 text-slate-700 max-w-[180px] truncate">{row.drop_address}</td>
            <td className="px-3 py-2 text-slate-700 font-medium">{row.duration_seconds}s</td>
            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
              {new Date(row.started_at).toLocaleString()}
            </td>
            <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
              {new Date(row.completed_at).toLocaleString()}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SignalCard({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "red" | "amber" | "slate";
}) {
  const styles: Record<string, { border: string; text: string; value: string; bg: string }> = {
    red: { border: "border-red-200", text: "text-red-700", value: "text-red-900", bg: "bg-red-50" },
    amber: { border: "border-amber-200", text: "text-amber-700", value: "text-amber-900", bg: "bg-amber-50" },
    slate: { border: "border-slate-200", text: "text-slate-600", value: "text-slate-900", bg: "bg-slate-50" },
  };
  const s = styles[tone];
  return (
    <div className={`bg-white rounded-xl border ${s.border} shadow-sm p-4`}>
      <div className={`text-xs font-semibold uppercase tracking-wide ${s.text}`}>
        {label}
      </div>
      <div className={`text-3xl font-bold mt-1 ${s.value}`}>{count}</div>
      <div className={`mt-2 inline-block px-2 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
        {count} signals
      </div>
    </div>
  );
}

function speedSeverity(kmh: number): string {
  if (kmh > 300) return "bg-red-100 text-red-800";
  if (kmh > 200) return "bg-amber-100 text-amber-800";
  return "bg-slate-100 text-slate-700";
}

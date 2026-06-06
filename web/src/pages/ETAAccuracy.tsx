import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { api } from "../api/client";

type ETASummary = {
  total_trips: number;
  avg_actual_s: number;
  avg_estimated_s: number;
  avg_drift_s: number;
  avg_abs_drift_s: number;
  avg_drift_pct: number;
  severely_late: number;
  severely_early: number;
};

type TripAccuracy = {
  ride_id: string;
  started_at: string;
  completed_at: string;
  actual_seconds: number;
  estimated_seconds: number;
  drift_seconds: number;
  drift_pct: number;
};

type DriftBucket = {
  drift_minutes: number;
  count: number;
};

const RANGES = [
  { label: "1d", days: 1 },
  { label: "3d", days: 3 },
  { label: "7d", days: 7 },
  { label: "14d", days: 14 },
  { label: "30d", days: 30 },
] as const;

function fmtDuration(seconds: number | null): string {
  if (seconds == null || !isFinite(seconds)) return "—";
  const abs = Math.abs(Number(seconds));
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  return `${m}m ${s}s`;
}

function fmtSignedDuration(seconds: number | null): string {
  if (seconds == null || !isFinite(seconds)) return "—";
  const n = Number(seconds);
  const prefix = n >= 0 ? "+" : "-";
  const abs = Math.abs(n);
  const m = Math.floor(abs / 60);
  const s = Math.round(abs % 60);
  return `${prefix}${m}m ${s}s`;
}

function driftColor(drift: number): string {
  if (drift > 0) return "text-rose-600";
  if (drift < 0) return "text-blue-600";
  return "text-kamuit-600";
}

export default function ETAAccuracy() {
  const [days, setDays] = useState(7);

  const summaryQ = useQuery<ETASummary>({
    queryKey: ["eta-summary", days],
    queryFn: async () => (await api.get("/api/eta/summary", { params: { days } })).data,
  });

  const accuracyQ = useQuery<TripAccuracy[]>({
    queryKey: ["eta-accuracy", days],
    queryFn: async () =>
      (await api.get("/api/eta/accuracy", { params: { days, limit: 100 } })).data,
  });

  const distributionQ = useQuery<DriftBucket[]>({
    queryKey: ["eta-distribution", days],
    queryFn: async () => (await api.get("/api/eta/distribution", { params: { days } })).data,
  });

  const sortedTrips = useMemo(
    () =>
      [...(accuracyQ.data ?? [])].sort(
        (a, b) => Math.abs(b.drift_seconds) - Math.abs(a.drift_seconds),
      ),
    [accuracyQ.data],
  );

  const summary = summaryQ.data;

  const kpis = summary
    ? [
        { label: "Total Trips Analyzed", value: summary.total_trips.toLocaleString(), color: "text-slate-900" },
        { label: "Avg Actual Time", value: fmtDuration(summary.avg_actual_s), color: "text-slate-900" },
        { label: "Avg Estimated Time", value: fmtDuration(summary.avg_estimated_s), color: "text-slate-900" },
        { label: "Avg Drift", value: fmtSignedDuration(summary.avg_drift_s), color: driftColor(summary.avg_drift_s) },
        { label: "Avg Absolute Drift", value: fmtDuration(summary.avg_abs_drift_s), color: "text-amber-600" },
        { label: "Severely Late (>50%)", value: summary.severely_late.toLocaleString(), color: "text-rose-600" },
        { label: "Severely Early (<50%)", value: summary.severely_early.toLocaleString(), color: "text-blue-600" },
      ]
    : [];

  if (summaryQ.isLoading && accuracyQ.isLoading) {
    return <div className="text-slate-500 py-12 text-center">Loading ETA data…</div>;
  }

  if (summaryQ.isError && accuracyQ.isError) {
    return <div className="text-rose-600 py-12 text-center">Failed to load ETA accuracy data.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
            ETA INTELLIGENCE
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">ETA Accuracy</h1>
          <p className="text-sm text-slate-500">
            How closely estimated arrival times match actual trip durations
          </p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setDays(r.days)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                days === r.days
                  ? "bg-kamuit-500 text-white shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-4"
            >
              <div className="text-xs font-medium text-slate-500 mb-1">{k.label}</div>
              <div className={`text-xl font-bold tabular-nums ${k.color}`}>{k.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* ETA Drift Distribution */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="text-xs font-medium text-slate-500 mb-3">
          ETA Drift Distribution
        </div>
        {distributionQ.isLoading ? (
          <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={distributionQ.data ?? []}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis
                dataKey="drift_minutes"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "#64748b" }}
                label={{ value: "Drift (minutes)", position: "insideBottom", offset: -5, fontSize: 11, fill: "#94a3b8" }}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "#64748b" }}
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: 8,
                  border: "1px solid #e2e8f0",
                  fontSize: 12,
                }}
                formatter={(value: number) => [value.toLocaleString(), "Trips"]}
                labelFormatter={(label) => `${label} min drift`}
              />
              <Bar
                dataKey="count"
                radius={[4, 4, 0, 0]}
                shape={(props: any) => {
                  const mins = props.payload?.drift_minutes ?? 0;
                  let color: string;
                  if (mins < -1) color = "#3b82f6";
                  else if (mins > 1) color = "#f43f5e";
                  else color = "#0BA26D";
                  return (
                    <rect
                      x={props.x}
                      y={props.y}
                      width={props.width}
                      height={props.height}
                      rx={4}
                      ry={4}
                      fill={color}
                    />
                  );
                }}
              />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Individual Trip Accuracy Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <div className="text-xs font-medium text-slate-500 mb-1">
            Individual Trip Accuracy
          </div>
          <p className="text-xs text-slate-400">
            Sorted by largest absolute drift first
          </p>
        </div>
        {accuracyQ.isLoading ? (
          <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
        ) : sortedTrips.length === 0 ? (
          <div className="text-slate-400 text-sm py-8 text-center">
            No trip accuracy data available.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2 text-left">Ride ID</th>
                  <th className="px-3 py-2 text-right">Estimated</th>
                  <th className="px-3 py-2 text-right">Actual</th>
                  <th className="px-3 py-2 text-right">Drift</th>
                  <th className="px-3 py-2 text-right">Drift %</th>
                  <th className="px-5 py-2 text-left">Started At</th>
                </tr>
              </thead>
              <tbody>
                {sortedTrips.map((t) => (
                  <tr
                    key={t.ride_id}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-5 py-2 font-mono text-xs text-slate-600">
                      {t.ride_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtDuration(t.estimated_seconds)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtDuration(t.actual_seconds)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${driftColor(t.drift_seconds)}`}>
                      {fmtSignedDuration(t.drift_seconds)}
                    </td>
                    <td className={`px-3 py-2 text-right tabular-nums font-medium ${driftColor(t.drift_seconds)}`}>
                      {t.drift_pct >= 0 ? "+" : ""}
                      {Number(t.drift_pct).toFixed(1)}%
                    </td>
                    <td className="px-5 py-2 text-xs text-slate-500">
                      {new Date(t.started_at).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

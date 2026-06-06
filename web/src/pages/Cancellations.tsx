import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import { api } from "../api/client";
import { datetime, shortId } from "../lib/format";

const COLORS = {
  green: "#0BA26D",
  rose: "#e11d48",
  amber: "#f59e0b",
  slate: "#64748b",
  sky: "#0284c7",
};

const STAGE_PALETTE = [
  COLORS.green,
  COLORS.sky,
  COLORS.amber,
  COLORS.rose,
  COLORS.slate,
  "#7c3aed",
  "#ec4899",
  "#14b8a6",
];

export default function Cancellations() {
  const [recentLimit, setRecentLimit] = useState(50);

  const summaryQ = useQuery({
    queryKey: ["cancellations-summary"],
    queryFn: async () =>
      (await api.get("/api/cancellations/summary")).data,
  });

  const dailyQ = useQuery({
    queryKey: ["cancellations-rate-daily"],
    queryFn: async () =>
      (await api.get("/api/cancellations/rate-daily", { params: { days: 30 } })).data,
  });

  const stageQ = useQuery({
    queryKey: ["cancellations-by-stage"],
    queryFn: async () =>
      (await api.get("/api/cancellations/by-stage")).data,
  });

  const repeatQ = useQuery({
    queryKey: ["cancellations-repeat"],
    queryFn: async () =>
      (await api.get("/api/cancellations/repeat-cancellers", { params: { min_count: 3 } })).data,
  });

  const recentQ = useQuery({
    queryKey: ["cancellations-recent", recentLimit],
    queryFn: async () =>
      (await api.get("/api/cancellations/recent", { params: { limit: recentLimit } })).data,
  });

  const summary = summaryQ.data ?? {};

  const dailyRows = useMemo(
    () =>
      (dailyQ.data ?? []).map((row: any) => ({
        day: shortDate(row.day),
        total_created: Number(row.total_created ?? 0),
        total_cancelled: Number(row.total_cancelled ?? 0),
        cancel_pct: round(Number(row.cancel_pct ?? 0), 1),
      })),
    [dailyQ.data],
  );

  const stageRows = useMemo(
    () =>
      (stageQ.data ?? []).map((row: any) => ({
        stage: row.stage ?? "unknown",
        cnt: Number(row.cnt ?? 0),
        avg_seconds_to_cancel: Number(row.avg_seconds_to_cancel ?? 0),
      })),
    [stageQ.data],
  );

  const repeatRows = repeatQ.data ?? [];
  const recentRows = recentQ.data ?? [];

  const isLoading = summaryQ.isLoading || dailyQ.isLoading;
  const isError = summaryQ.isError || dailyQ.isError;

  if (isLoading) return <div className="operations-empty">Loading cancellation analytics…</div>;
  if (isError) return <div className="operations-error">Failed to load cancellation data.</div>;

  return (
    <div className="space-y-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wider text-kamuit-500">
          Cancellation Analytics
        </p>
        <h1 className="text-2xl font-semibold text-slate-900">Cancellations</h1>
        <p className="text-sm text-slate-500">
          Cancellation rates, timing, repeat offenders, and recent events across the platform.
        </p>
      </header>

      {/* KPI cards */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Total Cancellations (30d)"
          value={Number(summary.total_cancellations_30d ?? 0).toLocaleString()}
        />
        <KpiCard
          label="Late Cancellations"
          value={Number(summary.late_cancellations_30d ?? 0).toLocaleString()}
          danger={Number(summary.late_cancellations_30d ?? 0) > 0}
        />
        <KpiCard
          label="Avg Time to Cancel"
          value={formatSeconds(summary.avg_seconds_to_cancel)}
        />
        <KpiCard
          label="Unique Cancellers"
          value={Number(summary.unique_cancellers ?? 0).toLocaleString()}
        />
      </section>

      {/* Daily cancellation rate chart */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="mb-3">
          <span className="text-xs uppercase text-slate-500">Trend</span>
          <h2 className="text-base font-semibold text-slate-800">Daily Cancellation Rate (30 days)</h2>
        </div>
        <div className="h-72">
          <ResponsiveContainer>
            <AreaChart data={dailyRows}>
              <CartesianGrid stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
              <YAxis
                yAxisId="left"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                allowDecimals={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tickFormatter={(v) => `${v}%`}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
              />
              <Tooltip
                formatter={(value: any, name: string) => {
                  if (name === "cancel_pct") return [`${Number(value).toFixed(1)}%`, "Cancel rate"];
                  return [Number(value).toLocaleString(), name === "total_cancelled" ? "Cancelled" : "Created"];
                }}
              />
              <Area
                yAxisId="right"
                type="monotone"
                dataKey="cancel_pct"
                fill="#ffe4e6"
                stroke={COLORS.rose}
                strokeWidth={2}
              />
              <Bar
                yAxisId="left"
                dataKey="total_cancelled"
                fill={COLORS.amber}
                radius={[4, 4, 0, 0]}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Cancellation by stage */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="mb-3">
          <span className="text-xs uppercase text-slate-500">Breakdown</span>
          <h2 className="text-base font-semibold text-slate-800">Cancellation by Stage</h2>
        </div>
        <div className="h-64">
          <ResponsiveContainer>
            <BarChart data={stageRows} layout="vertical">
              <CartesianGrid stroke="#e2e8f0" horizontal={false} />
              <XAxis type="number" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} allowDecimals={false} />
              <YAxis
                type="category"
                dataKey="stage"
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11 }}
                width={120}
              />
              <Tooltip
                formatter={(value: any, name: string) => {
                  if (name === "cnt") return [Number(value).toLocaleString(), "Count"];
                  return [value, name];
                }}
              />
              <Bar dataKey="cnt" radius={[0, 4, 4, 0]}>
                {stageRows.map((_: any, i: number) => (
                  <Cell key={i} fill={STAGE_PALETTE[i % STAGE_PALETTE.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Repeat cancellers table */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="mb-3">
          <span className="text-xs uppercase text-slate-500">Repeat offenders</span>
          <h2 className="text-base font-semibold text-slate-800">Repeat Cancellers (3+)</h2>
        </div>
        {repeatRows.length === 0 ? (
          <p className="text-sm text-slate-400">No repeat cancellers found.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left py-2 px-3">Rider ID</th>
                  <th className="text-right py-2 px-3">Cancel Count</th>
                  <th className="text-right py-2 px-3">Late Cancels</th>
                  <th className="text-left py-2 px-3">First Cancel</th>
                  <th className="text-left py-2 px-3">Last Cancel</th>
                </tr>
              </thead>
              <tbody>
                {repeatRows.map((row: any) => (
                  <tr key={row.rider_id} className="border-t border-slate-100">
                    <td className="py-2 px-3 font-mono text-xs text-slate-600">
                      {shortId(row.rider_id)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {Number(row.cancel_count ?? 0)}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-rose-600 font-medium">
                      {Number(row.late_cancel_count ?? 0)}
                    </td>
                    <td className="py-2 px-3 text-slate-600">{datetime(row.first_cancel)}</td>
                    <td className="py-2 px-3 text-slate-600">{datetime(row.last_cancel)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Recent cancellations table */}
      <section className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <span className="text-xs uppercase text-slate-500">Activity log</span>
            <h2 className="text-base font-semibold text-slate-800">Recent Cancellations</h2>
          </div>
          <select
            className="text-xs border border-slate-200 rounded px-2 py-1"
            value={recentLimit}
            onChange={(e) => setRecentLimit(Number(e.target.value))}
          >
            <option value={25}>25 rows</option>
            <option value={50}>50 rows</option>
            <option value={100}>100 rows</option>
          </select>
        </div>
        {recentRows.length === 0 ? (
          <p className="text-sm text-slate-400">No recent cancellations.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-xs uppercase text-slate-500">
                  <th className="text-left py-2 px-3">Ride ID</th>
                  <th className="text-left py-2 px-3">Cancelled From</th>
                  <th className="text-left py-2 px-3">Pickup</th>
                  <th className="text-left py-2 px-3">Drop</th>
                  <th className="text-right py-2 px-3">Time to Cancel</th>
                  <th className="text-left py-2 px-3">Cancelled At</th>
                </tr>
              </thead>
              <tbody>
                {recentRows.map((row: any) => (
                  <tr key={row.ride_id} className="border-t border-slate-100">
                    <td className="py-2 px-3 font-mono text-xs text-slate-600">
                      {shortId(row.ride_id)}
                    </td>
                    <td className="py-2 px-3">{row.cancelled_from ?? "—"}</td>
                    <td className="py-2 px-3 max-w-[180px] truncate" title={row.pickup_address}>
                      {row.pickup_address ?? "—"}
                    </td>
                    <td className="py-2 px-3 max-w-[180px] truncate" title={row.drop_address}>
                      {row.drop_address ?? "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {formatSeconds(row.seconds_to_cancel)}
                    </td>
                    <td className="py-2 px-3 text-slate-600">{datetime(row.cancelled_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function KpiCard({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: string | number;
  danger?: boolean;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-xs text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-semibold tabular-nums ${danger ? "text-rose-600" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

function formatSeconds(value: unknown): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "—";
  const minutes = Math.floor(n / 60);
  const seconds = Math.round(n % 60);
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${seconds}s`;
}

function shortDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

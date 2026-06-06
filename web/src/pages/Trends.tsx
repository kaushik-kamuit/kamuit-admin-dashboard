import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  BarChart,
  Bar,
  LineChart,
  Line,
} from "recharts";
import { api } from "../api/client";

type Snapshot = {
  ts: string;
  active_drivers: number;
  active_trips: number;
  open_runs: number;
  pending_verifications: number;
  failed_payments: number;
  held_capture_amount: number;
  online_drivers: number;
  completed_rides_24h: number;
  cancelled_rides_24h: number;
  total_revenue_24h: number;
};

type WaterfallRow = {
  status: string;
  cnt: number;
  total_amount: number;
  avg_amount: number;
};

type DailyPayment = {
  day: string;
  succeeded: number;
  failed: number;
  requires_capture: number;
  total: number;
  succeeded_amount: number;
  failed_amount: number;
  total_amount: number;
};

type UtilizationRow = {
  driver_id: string;
  session_count: number;
  online_hours: number;
  active_hours: number;
  utilization_pct: number;
};

const RANGES = [
  { label: "6h", hours: 6 },
  { label: "12h", hours: 12 },
  { label: "24h", hours: 24 },
  { label: "48h", hours: 48 },
  { label: "7d", hours: 168 },
] as const;

const WATERFALL_COLORS: Record<string, string> = {
  succeeded: "#0BA26D",
  failed: "#e11d48",
  requires_capture: "#d97706",
  canceled: "#64748b",
  processing: "#6366f1",
};

function fmtDollar(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!isFinite(n)) return "—";
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtNum(v: number | string | null | undefined): string {
  if (v == null) return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

function fmtTime(iso: string, hoursRange: number): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (hoursRange <= 48) {
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtDay(day: string): string {
  if (!day) return "";
  const d = new Date(day + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export default function Trends() {
  const [hours, setHours] = useState(24);

  const snapshotsQ = useQuery<Snapshot[]>({
    queryKey: ["metrics-snapshots", hours],
    queryFn: async () => (await api.get("/api/metrics/snapshots", { params: { hours } })).data,
  });

  const latestQ = useQuery<Snapshot>({
    queryKey: ["metrics-latest"],
    queryFn: async () => (await api.get("/api/metrics/latest")).data,
  });

  const waterfallQ = useQuery<WaterfallRow[]>({
    queryKey: ["metrics-waterfall"],
    queryFn: async () => (await api.get("/api/metrics/payment-waterfall")).data,
  });

  const dailyPayQ = useQuery<DailyPayment[]>({
    queryKey: ["metrics-payment-daily"],
    queryFn: async () => (await api.get("/api/metrics/payment-daily", { params: { days: 30 } })).data,
  });

  const utilQ = useQuery<UtilizationRow[]>({
    queryKey: ["metrics-utilization"],
    queryFn: async () => (await api.get("/api/metrics/utilization")).data,
  });

  const chartData = useMemo(
    () =>
      (snapshotsQ.data ?? []).map((s) => ({
        ...s,
        label: fmtTime(s.ts, hours),
      })),
    [snapshotsQ.data, hours],
  );

  const dailyChartData = useMemo(
    () =>
      (dailyPayQ.data ?? []).map((d) => ({
        ...d,
        label: fmtDay(d.day),
      })),
    [dailyPayQ.data],
  );

  const topDrivers = useMemo(
    () =>
      [...(utilQ.data ?? [])]
        .sort((a, b) => Number(b.online_hours) - Number(a.online_hours))
        .slice(0, 20),
    [utilQ.data],
  );

  const latest = latestQ.data;

  const kpis = latest
    ? [
        { label: "Active Trips", value: fmtNum(latest.active_trips), color: "text-blue-600" },
        { label: "Online Drivers", value: fmtNum(latest.online_drivers), color: "text-kamuit-500" },
        { label: "Pending Verifications", value: fmtNum(latest.pending_verifications), color: "text-amber-600" },
        { label: "Failed Payments", value: fmtNum(latest.failed_payments), color: "text-rose-600" },
        { label: "Held Captures", value: fmtDollar(latest.held_capture_amount), color: "text-slate-700" },
        { label: "Revenue 24h", value: fmtDollar(latest.total_revenue_24h), color: "text-kamuit-500" },
      ]
    : [];

  if (latestQ.isLoading && snapshotsQ.isLoading) {
    return <div className="text-slate-500 py-12 text-center">Loading metrics…</div>;
  }

  if (latestQ.isError && snapshotsQ.isError) {
    return <div className="text-rose-600 py-12 text-center">Failed to load metrics data.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
            OPERATIONAL ANALYTICS
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Trends &amp; Metrics</h1>
          <p className="text-sm text-slate-500">Operational metrics over time</p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button
              key={r.label}
              onClick={() => setHours(r.hours)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                hours === r.hours
                  ? "bg-teal-600 text-white shadow-sm"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI cards */}
      {latest && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          {kpis.map((k) => (
            <div
              key={k.label}
              className="bg-white rounded-xl border border-slate-200 shadow-sm p-4"
            >
              <div className="text-xs font-medium text-slate-500 mb-1">{k.label}</div>
              <div className={`text-xl font-bold tabular-nums ${k.color}`}>
                {k.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Area chart — Active Trips + Online Drivers */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
        <div className="text-xs font-medium text-slate-500 mb-3">
          Active Trips &amp; Online Drivers
        </div>
        <ResponsiveContainer width="100%" height={280}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="gradTrips" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#3b82f6" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gradDrivers" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#0BA26D" stopOpacity={0.2} />
                <stop offset="100%" stopColor="#0BA26D" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#e2e8f0" vertical={false} />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#64748b" }}
            />
            <YAxis
              yAxisId="left"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#64748b" }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "#64748b" }}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 8,
                border: "1px solid #e2e8f0",
                fontSize: 12,
              }}
            />
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="active_trips"
              name="Active Trips"
              stroke="#3b82f6"
              strokeWidth={2}
              fill="url(#gradTrips)"
            />
            <Area
              yAxisId="right"
              type="monotone"
              dataKey="online_drivers"
              name="Online Drivers"
              stroke="#0BA26D"
              strokeWidth={2}
              fill="url(#gradDrivers)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* Row 3: Waterfall + Daily Payment Trend */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Payment waterfall */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-medium text-slate-500 mb-3">
            Payment Waterfall
          </div>
          {waterfallQ.isLoading ? (
            <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={waterfallQ.data ?? []}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="status"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#64748b" }}
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
                  formatter={(value: number, name: string) => {
                    if (name === "cnt") return [fmtNum(value), "Count"];
                    return [value, name];
                  }}
                />
                <Bar
                  dataKey="cnt"
                  name="cnt"
                  radius={[4, 4, 0, 0]}
                  fill="#6366f1"
                  shape={(props: any) => {
                    const color =
                      WATERFALL_COLORS[props.payload?.status] ?? "#6366f1";
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

        {/* Daily payment trend */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-medium text-slate-500 mb-3">
            Daily Payment Trend (30d)
          </div>
          {dailyPayQ.isLoading ? (
            <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
          ) : (
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={dailyChartData}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#64748b" }}
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
                />
                <Line
                  type="monotone"
                  dataKey="succeeded"
                  name="Succeeded"
                  stroke="#0BA26D"
                  strokeWidth={2}
                  dot={false}
                />
                <Line
                  type="monotone"
                  dataKey="failed"
                  name="Failed"
                  stroke="#e11d48"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Row 4: Driver Utilization Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-3">
          <div className="text-xs font-medium text-slate-500 mb-1">
            Driver Utilization
          </div>
          <p className="text-xs text-slate-400">Top 20 drivers by online hours</p>
        </div>
        {utilQ.isLoading ? (
          <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
        ) : topDrivers.length === 0 ? (
          <div className="text-slate-400 text-sm py-8 text-center">
            No utilization data available.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-5 py-2 text-left">Driver ID</th>
                <th className="px-3 py-2 text-right">Sessions</th>
                <th className="px-3 py-2 text-right">Online Hours</th>
                <th className="px-3 py-2 text-right">Active Hours</th>
                <th className="px-5 py-2 text-left" style={{ minWidth: 180 }}>
                  Utilization
                </th>
              </tr>
            </thead>
            <tbody>
              {topDrivers.map((d) => {
                const pct = Math.max(
                  0,
                  Math.min(100, Number(d.utilization_pct ?? 0)),
                );
                const barColor =
                  pct >= 70 ? "bg-kamuit-500" : pct >= 40 ? "bg-amber-400" : "bg-rose-400";
                return (
                  <tr
                    key={d.driver_id}
                    className="border-t border-slate-100 hover:bg-slate-50"
                  >
                    <td className="px-5 py-2 font-mono text-xs text-slate-600">
                      {d.driver_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {fmtNum(d.session_count)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(d.online_hours).toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {Number(d.active_hours).toFixed(1)}
                    </td>
                    <td className="px-5 py-2">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${barColor}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs tabular-nums text-slate-600 w-10 text-right">
                          {pct.toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ResponsiveContainer,
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

type ChurnSummary = {
  total_active_drivers: number;
  critical_risk: number;
  high_risk: number;
  medium_risk: number;
  low_risk: number;
  avg_risk_score: number;
};

type ChurnDriver = {
  driver_id: string;
  recent_runs: number;
  prior_runs: number;
  recent_sessions: number;
  prior_sessions: number;
  cancels_30d: number;
  total_30d: number;
  days_since_last_run: number;
  last_run_at: string | null;
  activity_decline_score: number;
  session_decline_score: number;
  inactivity_score: number;
  cancel_rate_score: number;
  churn_risk_score: number;
};

type ActivityTrend = {
  driver_id: string;
  runs_recent_7d: number;
  runs_prior_7d: number;
  completed_recent: number;
  cancelled_recent: number;
  last_run_at: string | null;
};

const RISK_COLORS = {
  critical: "#f43f5e",
  high: "#f59e0b",
  medium: "#3b82f6",
  low: "#0BA26D",
} as const;

const PIE_DATA_KEYS: { key: keyof ChurnSummary; label: string; color: string }[] = [
  { key: "critical_risk", label: "Critical", color: RISK_COLORS.critical },
  { key: "high_risk", label: "High", color: RISK_COLORS.high },
  { key: "medium_risk", label: "Medium", color: RISK_COLORS.medium },
  { key: "low_risk", label: "Low", color: RISK_COLORS.low },
];

const SCORE_FILTERS = [0, 25, 50, 75] as const;

function riskColor(score: number): string {
  if (score >= 75) return "text-rose-600";
  if (score >= 50) return "text-amber-600";
  if (score >= 25) return "text-blue-600";
  return "text-kamuit-600";
}

function riskBarColor(score: number): string {
  if (score >= 75) return "bg-rose-500";
  if (score >= 50) return "bg-amber-500";
  if (score >= 25) return "bg-blue-500";
  return "bg-kamuit-500";
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

export default function ChurnRisk() {
  const [minScore, setMinScore] = useState(0);

  const summaryQ = useQuery<ChurnSummary>({
    queryKey: ["churn-summary"],
    queryFn: async () => (await api.get("/api/churn/summary")).data,
  });

  const driversQ = useQuery<ChurnDriver[]>({
    queryKey: ["churn-risk", minScore],
    queryFn: async () =>
      (await api.get("/api/churn/risk", { params: { min_score: minScore, limit: 50 } })).data,
  });

  const trendQ = useQuery<ActivityTrend[]>({
    queryKey: ["churn-activity-trend"],
    queryFn: async () => (await api.get("/api/churn/activity-trend")).data,
  });

  const summary = summaryQ.data;
  const drivers = driversQ.data ?? [];
  const trend = trendQ.data ?? [];

  const pieData = summary
    ? PIE_DATA_KEYS.map((d) => ({
        name: d.label,
        value: Number(summary[d.key] ?? 0),
        color: d.color,
      }))
    : [];

  const trendChartData = trend.slice(0, 20).map((t) => ({
    driver: t.driver_id.slice(0, 6),
    recent: Number(t.runs_recent_7d ?? 0),
    prior: Number(t.runs_prior_7d ?? 0),
  }));

  if (summaryQ.isLoading) {
    return <div className="text-slate-500 py-12 text-center">Loading churn analysis…</div>;
  }

  if (summaryQ.isError) {
    return <div className="text-rose-600 py-12 text-center">Failed to load churn data.</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
          DRIVER INTELLIGENCE
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Churn Risk Analysis</h1>
        <p className="text-sm text-slate-500">
          Driver retention signals, risk scoring, and activity decline tracking.
        </p>
      </div>

      {/* Summary KPI cards */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard label="Total Active" value={summary.total_active_drivers} color="text-slate-900" />
          <KpiCard label="Critical Risk" value={summary.critical_risk} color="text-rose-600" />
          <KpiCard label="High Risk" value={summary.high_risk} color="text-amber-600" />
          <KpiCard label="Medium Risk" value={summary.medium_risk} color="text-blue-600" />
          <KpiCard label="Low Risk" value={summary.low_risk} color="text-kamuit-600" />
          <KpiCard
            label="Avg Score"
            value={Number(summary.avg_risk_score ?? 0).toFixed(1)}
            color={riskColor(Number(summary.avg_risk_score ?? 0))}
          />
        </div>
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Risk Distribution Pie */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-medium text-slate-500 mb-3">Risk Distribution</div>
          <div className="flex items-center gap-6">
            <div className="w-48 h-48">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    dataKey="value"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {pieData.map((entry) => (
                      <Cell key={entry.name} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                    formatter={(value: number) => [value, "Drivers"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-col gap-2">
              {pieData.map((entry) => (
                <div key={entry.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="inline-block w-3 h-3 rounded-full"
                    style={{ backgroundColor: entry.color }}
                  />
                  <span className="text-slate-600">{entry.name}</span>
                  <span className="font-semibold tabular-nums text-slate-900">{entry.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Activity Trend Bar Chart */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
          <div className="text-xs font-medium text-slate-500 mb-3">
            Activity Trend — Recent vs Prior 7d
          </div>
          {trendQ.isLoading ? (
            <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
          ) : trendChartData.length === 0 ? (
            <div className="text-slate-400 text-sm py-8 text-center">No trend data.</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={trendChartData}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis
                  dataKey="driver"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 10, fill: "#64748b" }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  allowDecimals={false}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, border: "1px solid #e2e8f0", fontSize: 12 }}
                />
                <Bar dataKey="prior" name="Prior 7d" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                <Bar dataKey="recent" name="Recent 7d" fill="#0BA26D" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* At-Risk Drivers Table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 pt-5 pb-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="text-xs font-medium text-slate-500 mb-1">Top At-Risk Drivers</div>
            <p className="text-xs text-slate-400">
              Showing up to 50 drivers with risk score ≥ {minScore}
            </p>
          </div>
          <div className="flex gap-1">
            {SCORE_FILTERS.map((threshold) => (
              <button
                key={threshold}
                onClick={() => setMinScore(threshold)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  minScore === threshold
                    ? "bg-teal-600 text-white shadow-sm"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
                }`}
              >
                {threshold === 0 ? "All" : `≥ ${threshold}`}
              </button>
            ))}
          </div>
        </div>

        {driversQ.isLoading ? (
          <div className="text-slate-400 text-sm py-8 text-center">Loading…</div>
        ) : drivers.length === 0 ? (
          <div className="text-slate-400 text-sm py-8 text-center">
            No drivers match this filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-5 py-2 text-left">Driver ID</th>
                  <th className="px-3 py-2 text-left" style={{ minWidth: 160 }}>Risk Score</th>
                  <th className="px-3 py-2 text-left" style={{ minWidth: 200 }}>Score Breakdown</th>
                  <th className="px-3 py-2 text-right">Recent / Prior Runs</th>
                  <th className="px-3 py-2 text-right">Sessions R / P</th>
                  <th className="px-3 py-2 text-right">Days Inactive</th>
                  <th className="px-5 py-2 text-left">Last Active</th>
                </tr>
              </thead>
              <tbody>
                {drivers.map((d) => {
                  const score = Number(d.churn_risk_score ?? 0);
                  return (
                    <tr
                      key={d.driver_id}
                      className="border-t border-slate-100 hover:bg-slate-50"
                    >
                      <td className="px-5 py-2 font-mono text-xs text-slate-600">
                        {d.driver_id.slice(0, 8)}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${riskBarColor(score)}`}
                              style={{ width: `${Math.min(100, score)}%` }}
                            />
                          </div>
                          <span className={`text-xs font-semibold tabular-nums w-8 text-right ${riskColor(score)}`}>
                            {score}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <ScoreBreakdown
                          activity={Number(d.activity_decline_score ?? 0)}
                          session={Number(d.session_decline_score ?? 0)}
                          inactivity={Number(d.inactivity_score ?? 0)}
                          cancel={Number(d.cancel_rate_score ?? 0)}
                        />
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="font-medium">{d.recent_runs}</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span className="text-slate-500">{d.prior_runs}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        <span className="font-medium">{d.recent_sessions}</span>
                        <span className="text-slate-400 mx-1">/</span>
                        <span className="text-slate-500">{d.prior_sessions}</span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {d.days_since_last_run}
                      </td>
                      <td className="px-5 py-2 text-xs text-slate-500">
                        {fmtDate(d.last_run_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function KpiCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="text-xs font-medium text-slate-500 mb-1">{label}</div>
      <div className={`text-xl font-bold tabular-nums ${color}`}>{value}</div>
    </div>
  );
}

function ScoreBreakdown({
  activity,
  session,
  inactivity,
  cancel,
}: {
  activity: number;
  session: number;
  inactivity: number;
  cancel: number;
}) {
  const bars = [
    { label: "Act", value: activity, color: "bg-rose-400" },
    { label: "Ses", value: session, color: "bg-amber-400" },
    { label: "Ina", value: inactivity, color: "bg-blue-400" },
    { label: "Can", value: cancel, color: "bg-slate-400" },
  ];

  return (
    <div className="flex items-center gap-1.5">
      {bars.map((b) => (
        <div key={b.label} className="flex flex-col items-center gap-0.5" title={`${b.label}: ${b.value}/25`}>
          <div className="w-8 h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full ${b.color}`}
              style={{ width: `${Math.min(100, (b.value / 25) * 100)}%` }}
            />
          </div>
          <span className="text-[10px] text-slate-400 leading-none">{b.label}</span>
        </div>
      ))}
    </div>
  );
}

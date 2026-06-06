import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { datetime, shortId } from "../lib/format";

type Alert = {
  id: string;
  ts: string;
  severity: "critical" | "warning" | "info";
  category: string;
  title: string;
  detail: string;
  entity_type: string | null;
  entity_id: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  meta: Record<string, unknown> | null;
};

type AlertsResponse = {
  items: Alert[];
  total: number;
  summary: { critical: number; warning: number; info: number };
};

const SEVERITY_OPTIONS = ["", "critical", "warning", "info"] as const;
const CATEGORY_OPTIONS = ["", "gps", "speed", "payment", "matching", "onboarding", "system"] as const;

const SEVERITY_STYLES: Record<string, string> = {
  critical: "bg-red-100 text-red-800",
  warning: "bg-amber-100 text-amber-800",
  info: "bg-blue-100 text-blue-800",
};

export default function Alerts() {
  const queryClient = useQueryClient();
  const [severity, setSeverity] = useState("");
  const [category, setCategory] = useState("");
  const [openOnly, setOpenOnly] = useState(true);
  const [page, setPage] = useState(0);
  const limit = 50;

  const alertsQuery = useQuery<AlertsResponse>({
    queryKey: ["alerts", severity, category, openOnly, page],
    queryFn: async () => {
      const params: Record<string, any> = {
        limit,
        offset: page * limit,
        open_only: openOnly,
        severity,
        category,
      };
      return (await api.get("/api/alerts", { params })).data;
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async (alertId: string) => {
      return (await api.post(`/api/alerts/${alertId}/resolve`)).data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
    },
  });

  const summary = alertsQuery.data?.summary;
  const items = alertsQuery.data?.items ?? [];
  const total = alertsQuery.data?.total ?? 0;
  const maxPage = Math.max(0, Math.ceil(total / limit) - 1);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
          SYSTEM MONITORING
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Alerts</h1>
        <p className="text-sm text-slate-500">
          Operational alerts and anomaly detection
        </p>
      </div>

      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryCard label="Critical" count={summary.critical} tone="red" />
          <SummaryCard label="Warning" count={summary.warning} tone="amber" />
          <SummaryCard label="Info" count={summary.info} tone="blue" />
        </div>
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-wrap items-center gap-3">
        <select
          value={severity}
          onChange={(e) => { setSeverity(e.target.value); setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
        >
          {SEVERITY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt ? opt.charAt(0).toUpperCase() + opt.slice(1) : "All severities"}
            </option>
          ))}
        </select>

        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1.5 text-sm"
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt} value={opt}>
              {opt ? opt.charAt(0).toUpperCase() + opt.slice(1) : "All categories"}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input
            type="checkbox"
            checked={openOnly}
            onChange={(e) => { setOpenOnly(e.target.checked); setPage(0); }}
            className="rounded border-slate-300"
          />
          Open only
        </label>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Time</th>
              <th className="px-3 py-2 text-left">Severity</th>
              <th className="px-3 py-2 text-left">Category</th>
              <th className="px-3 py-2 text-left">Title</th>
              <th className="px-3 py-2 text-left">Detail</th>
              <th className="px-3 py-2 text-left">Entity</th>
              <th className="px-3 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {alertsQuery.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {!alertsQuery.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  No alerts found.
                </td>
              </tr>
            )}
            {items.map((alert) => (
              <tr
                key={alert.id}
                className="border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-3 py-2 text-xs text-slate-500 whitespace-nowrap">
                  {datetime(alert.ts)}
                </td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${SEVERITY_STYLES[alert.severity] ?? "bg-slate-100 text-slate-700"}`}
                  >
                    {alert.severity}
                  </span>
                </td>
                <td className="px-3 py-2 text-slate-700">{alert.category}</td>
                <td className="px-3 py-2 font-medium text-slate-900">
                  {alert.title}
                </td>
                <td className="px-3 py-2 text-slate-600 max-w-xs truncate">
                  {alert.detail}
                </td>
                <td className="px-3 py-2 font-mono text-xs text-slate-500">
                  {alert.entity_type && alert.entity_id
                    ? `${alert.entity_type}:${shortId(alert.entity_id)}`
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  {alert.resolved_at ? (
                    <span className="text-xs text-slate-400">Resolved</span>
                  ) : (
                    <button
                      onClick={() => resolveMutation.mutate(alert.id)}
                      disabled={resolveMutation.isPending}
                      className="px-2.5 py-1 text-xs font-medium rounded bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-50 transition-colors"
                    >
                      Resolve
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center text-sm">
        <div className="text-slate-500">
          Page {page + 1} of {maxPage + 1} ({total} total)
        </div>
        <div className="space-x-2">
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Prev
          </button>
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page >= maxPage}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function SummaryCard({
  label,
  count,
  tone,
}: {
  label: string;
  count: number;
  tone: "red" | "amber" | "blue";
}) {
  const styles: Record<string, { border: string; text: string; value: string }> = {
    red: { border: "border-red-200", text: "text-red-700", value: "text-red-900" },
    amber: { border: "border-amber-200", text: "text-amber-700", value: "text-amber-900" },
    blue: { border: "border-blue-200", text: "text-blue-700", value: "text-blue-900" },
  };
  const s = styles[tone];
  return (
    <div className={`bg-white rounded-xl border ${s.border} shadow-sm p-4`}>
      <div className={`text-xs font-semibold uppercase tracking-wide ${s.text}`}>
        {label}
      </div>
      <div className={`text-3xl font-bold mt-1 ${s.value}`}>{count}</div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from "recharts";

export default function Matching() {
  const q = useQuery({
    queryKey: ["preferences-funnel"],
    queryFn: async () => (await api.get("/api/preferences/funnel")).data,
  });

  if (q.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (q.isError) return <div className="text-rose-600">Failed to load.</div>;

  const d = q.data;
  const s = d.sessions;
  const acceptanceByOrder = d.per_order.map((r: any) => ({
    order: `#${r.preference_order}`,
    accepted: Number(r.accepted),
    declined: Number(r.declined),
    expired: Number(r.expired),
    cancelled: Number(r.cancelled),
    pending: Number(r.pending),
    offered: Number(r.offered),
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Matching health</h1>
        <p className="text-sm text-slate-500">How often the primary preference succeeds, how much the backup chain kicks in.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi label="Total sessions"           value={s.total_sessions} />
        <Kpi label="Any accepted"             value={s.sessions_accepted_any} />
        <Kpi label="Primary accepted"         value={s.sessions_primary_accepted} />
        <Kpi label="Backup rescued"           value={s.sessions_backup_accepted} />
        <Kpi label="Avg prefs/session"        value={Number(s.avg_prefs_per_session ?? 0).toFixed(2)} />
      </div>

      <div className="kpi-card">
        <div className="kpi-label mb-2">Outcomes by preference order</div>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={acceptanceByOrder}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
            <XAxis dataKey="order" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Legend />
            <Bar dataKey="accepted"  stackId="s" fill="#059669" />
            <Bar dataKey="offered"   stackId="s" fill="#0284c7" />
            <Bar dataKey="pending"   stackId="s" fill="#64748b" />
            <Bar dataKey="declined"  stackId="s" fill="#e11d48" />
            <Bar dataKey="expired"   stackId="s" fill="#a1a1aa" />
            <Bar dataKey="cancelled" stackId="s" fill="#f59e0b" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="kpi-card">
        <div className="kpi-label mb-2">Response latency by preference order (seconds, avg)</div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="text-left py-1">Order</th>
              <th className="text-right py-1">Avg selected → offered</th>
              <th className="text-right py-1">Avg offered → responded</th>
            </tr>
          </thead>
          <tbody>
            {d.response_latencies.map((r: any) => (
              <tr key={r.preference_order} className="border-t border-slate-100">
                <td className="py-1">#{r.preference_order}</td>
                <td className="py-1 text-right tabular-nums">{r.avg_seconds_to_offer ?? "—"}</td>
                <td className="py-1 text-right tabular-nums">{r.avg_seconds_to_respond ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: any }) {
  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value ?? "—"}</div>
    </div>
  );
}

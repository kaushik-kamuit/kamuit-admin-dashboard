import { useQuery } from "@tanstack/react-query";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../api/client";

export default function Funnel() {
  const { data } = useQuery({
    queryKey: ["funnel"],
    queryFn: async () => (await api.get("/api/analytics/funnel/preferences?since_days=30")).data,
  });

  const rows = (data?.status_breakdown ?? []).map((r: any) => ({
    status: r.status,
    transitions: Number(r.transitions),
    distinct_prefs: Number(r.distinct_prefs),
  }));
  const s = data?.session_summary ?? {};

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Preference funnel (last 30 days)</h1>

      <div className="text-sm bg-amber-50 border border-amber-200 rounded p-3">
        <b>Proxy warning:</b> {data?.note}
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Sessions" value={s.sessions ?? 0} />
        <Stat label="Converted" value={s.converted ?? 0} />
        <Stat label="Avg candidates / session"
              value={s.avg_candidates ? Number(s.avg_candidates).toFixed(2) : "—"} />
        <Stat label="Conversion rate"
              value={s.conversion_rate != null ? `${(Number(s.conversion_rate) * 100).toFixed(1)}%` : "—"} />
      </div>

      <div className="bg-white rounded shadow-sm p-4">
        <div className="font-medium mb-2">Transitions by destination status</div>
        <div style={{ width: "100%", height: 320 }}>
          <ResponsiveContainer>
            <BarChart data={rows}>
              <XAxis dataKey="status" />
              <YAxis />
              <Tooltip />
              <Bar dataKey="transitions" fill="#2563eb" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return (
    <div className="bg-white rounded shadow-sm p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-lg font-medium">{value}</div>
    </div>
  );
}

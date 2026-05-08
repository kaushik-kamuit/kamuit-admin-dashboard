import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export default function Sessions() {
  const { data, isLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: async () => (await api.get("/api/analytics/sessions/drivers")).data,
  });

  const s = data?.summary ?? {};

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Driver online sessions</h1>
      <div className="text-sm text-slate-600">
        Derived by gap-analysis on <code>driver_location_pings</code>. A session
        closes after {">"} 3 min with no ping.
      </div>

      <div className="grid grid-cols-4 gap-3">
        <Stat label="Sessions" value={s.sessions ?? 0} />
        <Stat label="Distinct drivers" value={s.drivers ?? 0} />
        <Stat label="Total time online" value={fmtSec(s.total_seconds ?? 0)} />
        <Stat label="Avg session" value={fmtSec(s.avg_seconds ?? 0)} />
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-slate-600">
            <tr>
              <th className="px-3 py-2">Driver</th>
              <th className="px-3 py-2">Started</th>
              <th className="px-3 py-2">Ended</th>
              <th className="px-3 py-2">Duration</th>
              <th className="px-3 py-2">Pings</th>
              <th className="px-3 py-2">Start → End</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={6} className="p-6 text-center text-slate-500">Loading...</td></tr>}
            {(data?.sessions ?? []).map((row: any) => (
              <tr key={row.id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{row.driver_id?.slice(0, 8)}…</td>
                <td className="px-3 py-2 text-xs">{new Date(row.started_at).toLocaleString()}</td>
                <td className="px-3 py-2 text-xs">{new Date(row.ended_at).toLocaleString()}</td>
                <td className="px-3 py-2">{fmtSec(row.total_seconds)}</td>
                <td className="px-3 py-2">{row.pings_count}</td>
                <td className="px-3 py-2 text-xs text-slate-500">
                  {row.start_lat?.toFixed(3)}, {row.start_lng?.toFixed(3)} → {row.end_lat?.toFixed(3)}, {row.end_lng?.toFixed(3)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
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

function fmtSec(s: number) {
  const n = Number(s || 0);
  if (n < 60) return `${n}s`;
  if (n < 3600) return `${Math.round(n / 60)} min`;
  return `${Math.floor(n / 3600)}h ${Math.round((n % 3600) / 60)}m`;
}

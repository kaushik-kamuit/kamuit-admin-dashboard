import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { useState } from "react";
import { api } from "../api/client";

const STATUSES = ["OPEN", "IN_PROGRESS", "PARTIALLY_FILLED", "COMPLETED", "CANCELLED"];

export default function DriverRuns() {
  const [status, setStatus] = useState<string>("");
  const { data, isLoading } = useQuery({
    queryKey: ["driver-runs", status],
    queryFn: async () =>
      (await api.get("/api/driver-runs/", { params: status ? { status } : {} })).data,
  });

  return (
    <div>
      <h1 className="text-2xl font-semibold mb-4">Driver Runs</h1>
      <div className="mb-4 flex items-center gap-2">
        <label className="text-sm text-slate-600">Status:</label>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="border rounded px-2 py-1 text-sm"
        >
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 text-left">
            <tr>
              <th className="px-3 py-2">Driver</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Origin → Destination</th>
              <th className="px-3 py-2">Seats</th>
              <th className="px-3 py-2">Assignments</th>
              <th className="px-3 py-2">Pings</th>
              <th className="px-3 py-2">Created</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={8} className="p-6 text-center text-slate-500">Loading...</td></tr>
            )}
            {data?.items?.map((r: any) => (
              <tr key={r.id} className="border-t hover:bg-slate-50">
                <td className="px-3 py-2">
                  <div className="font-medium">{r.driver?.full_name ?? "—"}</div>
                  <div className="text-xs text-slate-500 font-mono">{r.driver_id?.slice(0, 8)}…</div>
                </td>
                <td className="px-3 py-2">
                  <span className="inline-block px-2 py-0.5 rounded bg-slate-100 text-xs">{r.status}</span>
                </td>
                <td className="px-3 py-2 max-w-md">
                  <div className="text-xs">{r.origin_address}</div>
                  <div className="text-xs text-slate-500">→ {r.dest_address}</div>
                </td>
                <td className="px-3 py-2">{r.seats_left}/{r.seats_total}</td>
                <td className="px-3 py-2">{r.assignments_count}</td>
                <td className="px-3 py-2">{r.pings_count}</td>
                <td className="px-3 py-2 text-xs">{new Date(r.created_at).toLocaleString()}</td>
                <td className="px-3 py-2">
                  <Link to={`/driver-runs/${r.id}`} className="text-blue-600 hover:underline text-sm">
                    Open
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

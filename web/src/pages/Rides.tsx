import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { datetime, shortId } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

const STATUSES = [
  "REQUESTED", "OFFER_SENT", "ACCEPTED", "PICKUP_ARRIVING",
  "IN_PROGRESS", "COMPLETED", "CANCELLED",
];

export default function Rides() {
  const [status, setStatus] = useState("");
  const [riderId, setRiderId] = useState("");
  const [driverId, setDriverId] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const q = useQuery({
    queryKey: ["rides", status, riderId, driverId, page],
    queryFn: async () => {
      const params: Record<string, any> = { limit, offset: page * limit };
      if (status) params.status = status;
      if (riderId) params.rider_id = riderId;
      if (driverId) params.driver_id = driverId;
      return (await api.get("/api/rides/", { params })).data;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Rides</h1>
          <p className="text-sm text-slate-500">All rides, filterable. Click a row to drill down.</p>
        </div>
        <div className="text-sm text-slate-500">{q.data ? `${q.data.total} matching` : "…"}</div>
      </div>

      <div className="kpi-card flex flex-wrap gap-3">
        <select
          value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <input
          placeholder="Rider UUID (exact)" value={riderId}
          onChange={(e) => setRiderId(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1 text-sm font-mono text-xs min-w-[260px]"
        />
        <input
          placeholder="Driver UUID (exact)" value={driverId}
          onChange={(e) => setDriverId(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1 text-sm font-mono text-xs min-w-[260px]"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Ride</th>
              <th className="px-3 py-2 text-left">Rider</th>
              <th className="px-3 py-2 text-left">Driver</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Pickup → Drop</th>
              <th className="px-3 py-2 text-right">Seats</th>
              <th className="px-3 py-2 text-left">OTP</th>
              <th className="px-3 py-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
            {q.data?.items.map((r: any) => (
              <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link to={`/rides/${r.id}`} className="text-blue-600 hover:underline">{shortId(r.id)}</Link>
                </td>
                <td className="px-3 py-2">
                  {r.rider ? (
                    <Link to={`/users/${r.rider_id}`} className="hover:underline">
                      {r.rider.full_name}
                    </Link>
                  ) : <span className="font-mono text-xs">{shortId(r.rider_id)}</span>}
                </td>
                <td className="px-3 py-2">
                  {r.driver ? (
                    <Link to={`/drivers/${r.driver_id}`} className="hover:underline">
                      {r.driver.full_name}
                    </Link>
                  ) : <span className="text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2"><StatusBadge value={r.status} /></td>
                <td className="px-3 py-2 text-slate-600 text-xs">{r.pickup_address} → {r.drop_address}</td>
                <td className="px-3 py-2 text-right">{r.seats_requested}</td>
                <td className="px-3 py-2 font-mono text-xs">{r.pickup_otp ?? "—"}</td>
                <td className="px-3 py-2 text-slate-500 text-xs">{datetime(r.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager page={page} setPage={setPage} total={q.data?.total ?? 0} limit={limit} />
    </div>
  );
}

function Pager({ page, setPage, total, limit }: { page: number; setPage: (n: number) => void; total: number; limit: number }) {
  const max = Math.max(0, Math.ceil(total / limit) - 1);
  return (
    <div className="flex justify-between items-center text-sm">
      <div className="text-slate-500">Page {page + 1} of {max + 1}</div>
      <div className="space-x-2">
        <button className="px-3 py-1 border rounded disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
        <button className="px-3 py-1 border rounded disabled:opacity-40" disabled={page >= max} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { money, shortId } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

export default function Drivers() {
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const q = useQuery({
    queryKey: ["drivers", status, search, page],
    queryFn: async () => {
      const params: Record<string, any> = { limit, offset: page * limit };
      if (status) params.verification_status = status;
      if (search) params.search = search;
      return (await api.get("/api/drivers/", { params })).data;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Drivers</h1>
          <p className="text-sm text-slate-500">Driver profiles with verification, vehicle, wallet & Stripe Connect.</p>
        </div>
        <div className="text-sm text-slate-500">{q.data ? `${q.data.total} total` : "…"}</div>
      </div>

      <div className="kpi-card flex flex-wrap gap-3">
        <select
          value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          <option value="">All statuses</option>
          <option value="approved">Approved</option>
          <option value="pending">Pending</option>
          <option value="rejected">Rejected</option>
        </select>
        <input
          placeholder="Search name / email / phone…"
          value={search} onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1 text-sm flex-1 min-w-[200px]"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">ID</th>
              <th className="px-3 py-2 text-left">Name</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Vehicle</th>
              <th className="px-3 py-2 text-right">Rides (actual)</th>
              <th className="px-3 py-2 text-right">Earnings</th>
              <th className="px-3 py-2 text-left">Payouts</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
            {q.data?.items.map((d: any) => (
              <tr key={d.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">
                  <Link to={`/drivers/${d.id}`} className="text-blue-600 hover:underline">{shortId(d.id)}</Link>
                </td>
                <td className="px-3 py-2">
                  <div>{d.full_name}</div>
                  <div className="text-xs text-slate-500">{d.email}</div>
                </td>
                <td className="px-3 py-2"><StatusBadge value={d.verification_status} /></td>
                <td className="px-3 py-2 text-slate-700">
                  {d.make ? `${d.year} ${d.make} ${d.model}` : "—"}
                  <div className="text-xs text-slate-500">{d.plate_number ?? ""}</div>
                </td>
                <td className="px-3 py-2 text-right tabular-nums">{d.rides_completed_actual}</td>
                <td className="px-3 py-2 text-right tabular-nums">{d.wallet ? money(d.wallet.earnings_cents) : "—"}</td>
                <td className="px-3 py-2">
                  {d.stripe_connect?.payouts_enabled ? (
                    <span className="badge badge-green">enabled</span>
                  ) : (
                    <span className="badge badge-slate">off</span>
                  )}
                </td>
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

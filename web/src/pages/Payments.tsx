import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { datetime, money, shortId } from "../lib/format";
import StatusBadge from "../components/StatusBadge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

export default function Payments() {
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const summary = useQuery({
    queryKey: ["payment-summary"],
    queryFn: async () => (await api.get("/api/payments/summary")).data,
  });

  const intents = useQuery({
    queryKey: ["payment-intents", status, page],
    queryFn: async () => {
      const params: Record<string, any> = { limit, offset: page * limit };
      if (status) params.status = status;
      return (await api.get("/api/payments/intents", { params })).data;
    },
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Payments</h1>
        <p className="text-sm text-slate-500">Stripe payment intents, driver wallets, Connect onboarding.</p>
      </div>

      {summary.data && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {summary.data.by_status.map((s: any) => (
              <div key={s.status} className="kpi-card">
                <div className="kpi-label">{s.status}</div>
                <div className="kpi-value">{s.count}</div>
                <div className="text-xs text-slate-500 mt-1">{money(s.amount_cents)}</div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="kpi-card">
              <div className="kpi-label mb-2">GMV daily (last 30d)</div>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={summary.data.daily}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v: any, name: string) =>
                      name === "gmv_cents" ? money(Number(v)) : v
                    }
                  />
                  <Bar dataKey="gmv_cents" fill="#0f172a" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="kpi-card">
              <div className="kpi-label mb-2">Stripe Connect onboarding</div>
              <KV k="Total drivers"     v={summary.data.stripe_connect.total} />
              <KV k="Details submitted" v={summary.data.stripe_connect.details_submitted} />
              <KV k="Payouts enabled"   v={summary.data.stripe_connect.payouts_enabled} />
            </div>
          </div>

          <div className="kpi-card">
            <div className="kpi-label mb-3">Top drivers by earnings</div>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="text-left py-1">Driver</th>
                  <th className="text-right py-1">Earnings</th>
                  <th className="text-right py-1">Credits</th>
                  <th className="text-left py-1">Updated</th>
                </tr>
              </thead>
              <tbody>
                {summary.data.top_wallets.map((w: any) => (
                  <tr key={w.driver_id} className="border-t border-slate-100">
                    <td className="py-1">
                      {w.driver ? (
                        <Link to={`/drivers/${w.driver_id}`} className="text-blue-600 hover:underline">
                          {w.driver.full_name}
                        </Link>
                      ) : <span className="font-mono text-xs">{shortId(w.driver_id)}</span>}
                    </td>
                    <td className="py-1 text-right tabular-nums">{money(w.earnings_cents)}</td>
                    <td className="py-1 text-right tabular-nums">{money(w.credits_cents)}</td>
                    <td className="py-1 text-slate-500">{datetime(w.updated_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="kpi-card flex flex-wrap gap-3">
        <select
          value={status} onChange={(e) => { setStatus(e.target.value); setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          <option value="">All intent statuses</option>
          <option value="succeeded">Succeeded</option>
          <option value="requires_capture">Requires capture</option>
          <option value="canceled">Canceled</option>
          <option value="failed">Failed</option>
        </select>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">Stripe PI</th>
              <th className="px-3 py-2 text-left">Passenger</th>
              <th className="px-3 py-2 text-left">Preference</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-left">Created</th>
            </tr>
          </thead>
          <tbody>
            {intents.isLoading && <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>}
            {intents.data?.items.map((p: any) => (
              <tr key={p.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{p.stripe_pi_id}</td>
                <td className="px-3 py-2">
                  {p.passenger ? (
                    <Link to={`/users/${p.passenger_id}`} className="hover:underline">
                      {p.passenger.full_name}
                    </Link>
                  ) : <span className="font-mono text-xs">{shortId(p.passenger_id)}</span>}
                </td>
                <td className="px-3 py-2 font-mono text-xs">{shortId(p.preference_id)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{money(p.amount_cents, p.currency)}</td>
                <td className="px-3 py-2"><StatusBadge value={p.status} /></td>
                <td className="px-3 py-2 text-slate-500 text-xs">{datetime(p.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pager page={page} setPage={setPage} total={intents.data?.total ?? 0} limit={limit} />
    </div>
  );
}

function KV({ k, v }: { k: string; v: any }) {
  return (
    <div className="flex justify-between py-1 text-sm">
      <span className="text-slate-500">{k}</span>
      <span className="text-slate-900 text-right">{v ?? "—"}</span>
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

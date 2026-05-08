import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { datetime, money, shortId } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

export default function DriverDetail() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["driver", id],
    queryFn: async () => (await api.get(`/api/drivers/${id}`)).data,
  });

  if (q.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (q.isError) return <div className="text-rose-600">Failed to load.</div>;

  const d = q.data;
  const drv = d.driver;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/drivers" className="text-sm text-slate-500 hover:text-slate-700">← Drivers</Link>
        <h1 className="text-2xl font-semibold mt-1">{drv.full_name}</h1>
        <div className="text-sm text-slate-500 font-mono">{drv.id}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="kpi-card">
          <div className="kpi-label mb-3">Profile</div>
          <KV k="Email" v={drv.email} />
          <KV k="Phone" v={drv.phone_number} />
          <KV k="License #" v={drv.license_number} />
          <KV k="Status" v={<StatusBadge value={drv.verification_status} />} />
          <KV k="Is verified" v={drv.is_verified ? "yes" : "no"} />
          <KV k="Experience (yrs)" v={drv.experience_years} />
        </div>
        <div className="kpi-card">
          <div className="kpi-label mb-3">Rides (computed from truth)</div>
          <KV k="Completed" v={d.computed_stats?.completed ?? 0} />
          <KV k="Cancelled" v={d.computed_stats?.cancelled ?? 0} />
          <KV k="Total assigned" v={d.computed_stats?.assigned_total ?? 0} />
          <div className="text-xs text-slate-400 mt-3">
            Counters on profile (may drift): {drv.counter_completed} completed / {drv.counter_accepted} accepted / {drv.counter_denied} denied
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mb-3">Wallet & payouts</div>
          <KV k="Earnings" v={d.wallet_balance ? money(d.wallet_balance.earnings_cents) : "—"} />
          <KV k="Credits" v={d.wallet_balance ? money(d.wallet_balance.credits_cents) : "—"} />
          <KV k="Stripe account" v={d.stripe_connect?.stripe_account_id ?? "—"} />
          <KV k="Payouts enabled" v={d.stripe_connect?.payouts_enabled ? "yes" : "no"} />
          <KV k="Account status" v={d.stripe_connect?.account_status} />
        </div>
      </div>

      {d.vehicles.length > 0 && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Vehicles</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="text-left py-1">Year/Make/Model</th><th className="text-left py-1">Plate</th><th className="text-left py-1">VIN</th><th className="text-left py-1">Status</th></tr>
            </thead>
            <tbody>
              {d.vehicles.map((v: any) => (
                <tr key={v.id} className="border-t border-slate-100">
                  <td className="py-1">{v.year} {v.make} {v.model} <span className="text-slate-400 text-xs">({v.color})</span></td>
                  <td className="py-1">{v.plate_number} {v.plate_state && `(${v.plate_state})`}</td>
                  <td className="py-1 font-mono text-xs">{v.vin}</td>
                  <td className="py-1"><StatusBadge value={v.verification_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.driver_runs.length > 0 && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Recent driver runs ({d.driver_runs.length})</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="text-left py-1">Run ID</th><th className="text-left py-1">Origin → Destination</th><th className="text-left py-1">Seats</th><th className="text-left py-1">Status</th><th className="text-left py-1">Created</th></tr>
            </thead>
            <tbody>
              {d.driver_runs.map((r: any) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1 font-mono text-xs">{shortId(r.id)}</td>
                  <td className="py-1 text-slate-600">{r.origin_address} → {r.dest_address}</td>
                  <td className="py-1 text-slate-600">{r.seats_left}/{r.seats_total}</td>
                  <td className="py-1"><StatusBadge value={r.status} /></td>
                  <td className="py-1 text-slate-500">{datetime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.recent_rides.length > 0 && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Recent rides carried ({d.recent_rides.length})</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="text-left py-1">Ride</th><th className="text-left py-1">Pickup → Drop</th><th className="text-left py-1">Status</th><th className="text-left py-1">Created</th></tr>
            </thead>
            <tbody>
              {d.recent_rides.map((r: any) => (
                <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="py-1 font-mono text-xs">
                    <Link to={`/rides/${r.id}`} className="text-blue-600 hover:underline">{shortId(r.id)}</Link>
                  </td>
                  <td className="py-1 text-slate-600">{r.pickup_address} → {r.drop_address}</td>
                  <td className="py-1"><StatusBadge value={r.status} /></td>
                  <td className="py-1 text-slate-500">{datetime(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.wallet_transactions.length > 0 && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Recent wallet transactions</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr><th className="text-left py-1">When</th><th className="text-left py-1">Ledger</th><th className="text-left py-1">Type</th><th className="text-right py-1">Amount</th><th className="text-left py-1">Source</th></tr>
            </thead>
            <tbody>
              {d.wallet_transactions.map((t: any) => (
                <tr key={t.id} className="border-t border-slate-100">
                  <td className="py-1 text-slate-500">{datetime(t.created_at)}</td>
                  <td className="py-1">{t.ledger}</td>
                  <td className="py-1">{t.tx_type}</td>
                  <td className="py-1 text-right tabular-nums">{money(t.amount_cents)}</td>
                  <td className="py-1 text-slate-600">{t.source_type} {t.source_id && <span className="text-xs font-mono">{shortId(t.source_id)}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
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

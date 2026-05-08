import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

export default function Reconciliation() {
  const { data, isLoading } = useQuery({
    queryKey: ["recon"],
    queryFn: async () => (await api.get("/api/analytics/recon/drivers")).data,
  });

  const rows = (data?.settlement ?? []) as any[];

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Driver settlement reconciliation</h1>

      <div className="bg-white rounded shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-slate-600 text-left">
            <tr>
              <th className="px-3 py-2">Driver</th>
              <th className="px-3 py-2">Rides paid</th>
              <th className="px-3 py-2">Riders served</th>
              <th className="px-3 py-2">Earnings in</th>
              <th className="px-3 py-2">Earnings out</th>
              <th className="px-3 py-2">Wallet earnings</th>
              <th className="px-3 py-2">Wallet credits</th>
              <th className="px-3 py-2">Last tx</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={8} className="p-6 text-center text-slate-500">Loading...</td></tr>}
            {rows.map((r) => {
              const delta = Number(r.earnings_in_cents || 0) - Number(r.earnings_out_cents || 0);
              const walletMatches = delta === Number(r.current_earnings_cents || 0);
              return (
                <tr key={r.driver_id} className="border-t hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <div className="font-medium">{r.user?.full_name ?? "—"}</div>
                    <div className="text-xs text-slate-500 font-mono">{r.driver_id?.slice(0, 8)}…</div>
                  </td>
                  <td className="px-3 py-2">{r.rides_paid}</td>
                  <td className="px-3 py-2">{r.riders_served}</td>
                  <td className="px-3 py-2">{fmtUsd(r.earnings_in_cents)}</td>
                  <td className="px-3 py-2">{fmtUsd(r.earnings_out_cents)}</td>
                  <td className={`px-3 py-2 ${walletMatches ? "" : "text-amber-600"}`}>
                    {fmtUsd(r.current_earnings_cents)}
                    {!walletMatches && <span className="text-xs ml-2">⚠ ledger Δ {fmtUsd(delta)}</span>}
                  </td>
                  <td className="px-3 py-2">{fmtUsd(r.current_credits_cents)}</td>
                  <td className="px-3 py-2 text-xs">{r.last_tx_at ? new Date(r.last_tx_at).toLocaleString() : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-slate-500 bg-amber-50 border border-amber-200 rounded p-3">
        <b>Warning:</b> ledger Δ highlights rows where the sum of
        <code>wallet_transactions</code> doesn't equal
        <code>wallet_balances.earnings_cents</code>. In this seed that's
        expected (not every driver got transactions), but in prod it's the
        signal you want to alert on.
      </div>
    </div>
  );
}

function fmtUsd(cents?: number | string) {
  if (cents == null) return "—";
  return `$${(Number(cents) / 100).toFixed(2)}`;
}

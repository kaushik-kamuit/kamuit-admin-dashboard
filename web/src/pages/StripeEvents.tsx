import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";

type StripeEvent = {
  id: number;
  received_at: string;
  stripe_event_id: string;
  event_type: string;
  api_version: string | null;
  livemode: boolean;
  processed: boolean;
};

export default function StripeEvents() {
  const [offset, setOffset] = useState(0);
  const [typeFilter, setTypeFilter] = useState("");
  const limit = 50;

  const q = useQuery({
    queryKey: ["stripe-events", offset, typeFilter],
    queryFn: async () => {
      const params: Record<string, string | number> = { limit, offset };
      if (typeFilter) params.event_type = typeFilter;
      return (await api.get("/api/stripe-events", { params })).data as { items: StripeEvent[]; total: number };
    },
  });

  const items = q.data?.items ?? [];
  const total = q.data?.total ?? 0;

  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">Admin</div>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Stripe Events</h1>
      <p className="text-sm text-slate-500 mb-6">Webhook event log for payment and Connect events</p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="p-4 border-b border-slate-100 flex items-center gap-3">
          <input
            className="border border-slate-300 rounded-lg px-3 py-1.5 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-slate-900"
            placeholder="Filter by event type..."
            value={typeFilter}
            onChange={(e) => { setTypeFilter(e.target.value); setOffset(0); }}
          />
          <span className="text-xs text-slate-400">{total} events</span>
        </div>

        {items.length === 0 ? (
          <div className="p-8 text-center text-slate-400 text-sm">
            {q.isLoading ? "Loading..." : "No Stripe events recorded yet. Configure a webhook endpoint to /api/stripe-events/webhook."}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-medium">Received</th>
                <th className="px-4 py-3 font-medium">Event ID</th>
                <th className="px-4 py-3 font-medium">Type</th>
                <th className="px-4 py-3 font-medium">API Version</th>
                <th className="px-4 py-3 font-medium">Live</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {items.map((ev) => (
                <tr key={ev.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 text-slate-600 whitespace-nowrap">
                    {new Date(ev.received_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5 font-mono text-xs text-slate-700">{ev.stripe_event_id}</td>
                  <td className="px-4 py-2.5">
                    <span className="px-2 py-0.5 rounded bg-slate-100 text-slate-700 text-xs font-medium">
                      {ev.event_type}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{ev.api_version ?? "-"}</td>
                  <td className="px-4 py-2.5">
                    <span className={ev.livemode ? "text-rose-600 font-semibold" : "text-slate-400"}>
                      {ev.livemode ? "LIVE" : "test"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {total > limit && (
          <div className="p-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
            <button
              onClick={() => setOffset(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="px-3 py-1 rounded border border-slate-300 disabled:opacity-40"
            >
              Previous
            </button>
            <span>Showing {offset + 1}–{Math.min(offset + limit, total)} of {total}</span>
            <button
              onClick={() => setOffset(offset + limit)}
              disabled={offset + limit >= total}
              className="px-3 py-1 rounded border border-slate-300 disabled:opacity-40"
            >
              Next
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

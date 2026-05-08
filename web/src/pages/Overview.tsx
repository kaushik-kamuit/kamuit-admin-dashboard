import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { money } from "../lib/format";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
  BarChart, Bar, Legend,
} from "recharts";

export default function Overview() {
  const q = useQuery({
    queryKey: ["overview"],
    queryFn: async () => (await api.get("/api/overview/")).data,
  });

  if (q.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (q.isError) return <div className="text-rose-600">Failed to load overview.</div>;

  const d = q.data;

  const kpis = [
    { label: "Total users",        value: d.users.total_users },
    { label: "Drivers",            value: d.users.drivers },
    { label: "Passengers",         value: d.users.passengers },
    { label: "New (7d)",           value: d.users.new_users_7d },
    { label: "Total rides",        value: d.rides.total_rides },
    { label: "Active rides",       value: d.rides.active },
    { label: "Completed rides",    value: d.rides.completed },
    { label: "Cancelled rides",    value: d.rides.cancelled },
    { label: "GMV (all-time)",     value: money(d.payments.gmv_cents) },
    { label: "GMV (7d)",           value: money(d.payments.gmv_7d_cents) },
    { label: "Intents succeeded",  value: d.payments.succeeded },
    { label: "Drivers payouts on", value: d.stripe_connect.payouts_enabled },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Overview</h1>
        <p className="text-sm text-slate-500">Cross-service KPIs from all 3 databases.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {kpis.map((k) => (
          <div key={k.label} className="kpi-card">
            <div className="kpi-label">{k.label}</div>
            <div className="kpi-value">{k.value ?? "—"}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="kpi-card">
          <div className="kpi-label mb-2">Signups (last 30 days)</div>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={d.signups_daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Line type="monotone" dataKey="signups" stroke="#0f172a" strokeWidth={2} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="kpi-card">
          <div className="kpi-label mb-2">Rides (last 30 days)</div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={d.rides_daily}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
              <XAxis dataKey="day" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="completed" stackId="a" fill="#059669" />
              <Bar dataKey="cancelled" stackId="a" fill="#e11d48" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="kpi-card">
          <div className="kpi-label mb-2">Driver verification</div>
          <Row label="Approved" val={d.driver_verification.approved} />
          <Row label="Pending"  val={d.driver_verification.pending} />
          <Row label="Rejected" val={d.driver_verification.rejected} />
          <Row label="Total"    val={d.driver_verification.total} bold />
        </div>
        <div className="kpi-card">
          <div className="kpi-label mb-2">Ride status breakdown</div>
          <Row label="Requested"   val={d.rides.requested} />
          <Row label="Offer sent"  val={d.rides.offer_sent} />
          <Row label="Accepted"    val={d.rides.accepted} />
          <Row label="Active"      val={d.rides.active} />
          <Row label="Completed"   val={d.rides.completed} />
          <Row label="Cancelled"   val={d.rides.cancelled} />
        </div>
        <div className="kpi-card">
          <div className="kpi-label mb-2">Matching funnel</div>
          <Row label="Primary accepted"  val={d.preferences_funnel.primary_accepted} />
          <Row label="Primary total"     val={d.preferences_funnel.primary_total} />
          <Row label="Offered"           val={d.preferences_funnel.offered} />
          <Row label="Declined"          val={d.preferences_funnel.declined} />
          <Row label="Expired"           val={d.preferences_funnel.expired} />
        </div>
      </div>
    </div>
  );
}

function Row({ label, val, bold }: { label: string; val: number | string; bold?: boolean }) {
  return (
    <div className={`flex justify-between py-1 text-sm ${bold ? "font-semibold text-slate-900" : "text-slate-700"}`}>
      <span>{label}</span>
      <span className="tabular-nums">{val ?? "—"}</span>
    </div>
  );
}

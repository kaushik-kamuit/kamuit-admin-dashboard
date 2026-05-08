import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { datetime, money, shortId } from "../lib/format";
import StatusBadge from "../components/StatusBadge";
import { Map, Marker, Polyline, Popup } from "../components/MapView";
import L from "leaflet";

const pickupIcon = L.divIcon({
  className: "",
  html: '<div style="background:#f59e0b;border:2px solid #fff;border-radius:2px;width:14px;height:14px;"></div>',
  iconSize: [14, 14],
});
const dropIcon = L.divIcon({
  className: "",
  html: '<div style="background:#8b5cf6;border:2px solid #fff;border-radius:2px;width:14px;height:14px;"></div>',
  iconSize: [14, 14],
});

export default function RideDetail() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["ride", id],
    queryFn: async () => (await api.get(`/api/rides/${id}`)).data,
  });
  const timelineQ = useQuery({
    queryKey: ["ride-timeline", id],
    queryFn: async () => (await api.get(`/api/analytics/timeline/ride/${id}`)).data,
    enabled: !!id,
  });

  if (q.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (q.isError) return <div className="text-rose-600">Failed to load.</div>;

  const { ride, preferences, assignment, payment_intents } = q.data;
  const tl = timelineQ.data;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/rides" className="text-sm text-slate-500 hover:text-slate-700">← Rides</Link>
        <div className="flex items-center gap-3 mt-1">
          <h1 className="text-2xl font-semibold">Ride {shortId(ride.id)}</h1>
          <StatusBadge value={ride.status} />
        </div>
        <div className="text-sm text-slate-500 font-mono mt-1">{ride.id}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="kpi-card">
          <div className="kpi-label mb-3">Ride</div>
          <KV k="Status" v={<StatusBadge value={ride.status} />} />
          <KV k="Pickup" v={ride.pickup_address} />
          <KV k="Drop"   v={ride.drop_address} />
          <KV k="Pickup geo" v={ride.pickup_lat && `${ride.pickup_lat.toFixed(5)}, ${ride.pickup_lng.toFixed(5)}`} />
          <KV k="Drop geo"   v={ride.drop_lat && `${ride.drop_lat.toFixed(5)}, ${ride.drop_lng.toFixed(5)}`} />
          <KV k="Seats requested" v={ride.seats_requested} />
          <KV k="Notes" v={ride.notes} />
          <KV k="Created" v={datetime(ride.created_at)} />
          <KV k="Updated" v={datetime(ride.updated_at)} />
        </div>
        <div className="kpi-card">
          <div className="kpi-label mb-3">Rider</div>
          {ride.rider ? (
            <>
              <KV k="Name" v={<Link className="text-blue-600 hover:underline" to={`/users/${ride.rider_id}`}>{ride.rider.full_name}</Link>} />
              <KV k="Email" v={ride.rider.email} />
              <KV k="Phone" v={ride.rider.phone_number} />
            </>
          ) : (
            <div className="text-sm text-slate-500 font-mono">{ride.rider_id}</div>
          )}
          <div className="mt-3">
            <div className="kpi-label">Pickup OTP</div>
            <div className="font-mono text-2xl">{ride.pickup_otp ?? "—"}</div>
            <div className="text-xs text-slate-500">generated {datetime(ride.otp_generated_at)}, {ride.otp_attempts ?? 0} attempts</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-label mb-3">Assignment</div>
          {assignment ? (
            <>
              <KV k="Driver" v={assignment.driver ? (
                <Link to={`/drivers/${assignment.driver_id}`} className="text-blue-600 hover:underline">
                  {assignment.driver.full_name}
                </Link>
              ) : shortId(assignment.driver_id)} />
              <KV k="Driver run" v={<span className="font-mono text-xs">{shortId(assignment.driver_run_id)}</span>} />
              <KV k="Assigned at" v={datetime(assignment.assigned_at)} />
              <KV k="Run origin" v={assignment.origin_address} />
              <KV k="Run dest"   v={assignment.dest_address} />
              <KV k="Pickup fraction" v={assignment.pickup_fraction?.toFixed(3)} />
              <KV k="Drop fraction"   v={assignment.drop_fraction?.toFixed(3)} />
            </>
          ) : <div className="text-sm text-slate-500">No driver assigned yet.</div>}
        </div>
      </div>

      <div className="kpi-card">
        <div className="kpi-label mb-3">Preference chain ({preferences.length})</div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="text-left py-1">#</th>
              <th className="text-left py-1">Primary?</th>
              <th className="text-left py-1">Status</th>
              <th className="text-left py-1">Driver / Run</th>
              <th className="text-left py-1">Pickup time</th>
              <th className="text-right py-1">Est. price</th>
              <th className="text-left py-1">Offered → responded</th>
              <th className="text-left py-1">PI</th>
            </tr>
          </thead>
          <tbody>
            {preferences.map((p: any) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="py-1">{p.preference_order}</td>
                <td className="py-1">{p.is_primary ? <span className="badge badge-purple">primary</span> : <span className="badge badge-slate">backup</span>}</td>
                <td className="py-1"><StatusBadge value={p.status} /></td>
                <td className="py-1">
                  <div>
                    {p.driver ? (
                      <Link to={`/drivers/${p.driver_id}`} className="text-blue-600 hover:underline">
                        {p.driver.full_name}
                      </Link>
                    ) : <span className="text-slate-400">—</span>}
                  </div>
                  <div className="text-xs text-slate-500">run {shortId(p.driver_run_id)}</div>
                </td>
                <td className="py-1 text-slate-600">{datetime(p.pickup_time)}</td>
                <td className="py-1 text-right tabular-nums">${p.estimated_price?.toFixed(2) ?? "—"}</td>
                <td className="py-1 text-xs text-slate-500">
                  {datetime(p.offered_at)} → {datetime(p.responded_at)}
                </td>
                <td className="py-1 font-mono text-xs">{p.payment_intent_id ? shortId(p.payment_intent_id) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {ride.pickup_lat && ride.drop_lat && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Geography</div>
          <Map
            center={[ride.pickup_lat, ride.pickup_lng]}
            zoom={12}
            height={320}
            bounds={[[ride.pickup_lat, ride.pickup_lng], [ride.drop_lat, ride.drop_lng]] as any}
          >
            <Marker position={[ride.pickup_lat, ride.pickup_lng]} icon={pickupIcon}>
              <Popup><b>Pickup</b><br />{ride.pickup_address}</Popup>
            </Marker>
            <Marker position={[ride.drop_lat, ride.drop_lng]} icon={dropIcon}>
              <Popup><b>Dropoff</b><br />{ride.drop_address}</Popup>
            </Marker>
            <Polyline
              positions={[[ride.pickup_lat, ride.pickup_lng], [ride.drop_lat, ride.drop_lng]]}
              pathOptions={{ color: "#64748b", weight: 2, dashArray: "4 6" }}
            />
          </Map>
        </div>
      )}

      {tl && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Event timeline</div>
          <ol className="relative border-l border-slate-200 ml-2 space-y-3 text-sm">
            {[
              ...(tl.status_events ?? []).map((e: any) => ({
                at: e.occurred_at,
                kind: "status",
                label: `ride status: ${e.from_status ?? "∅"} → ${e.to_status}`,
                sub: `reason: ${e.reason_code}`,
              })),
              ...(tl.preference_events ?? []).map((e: any) => ({
                at: e.occurred_at,
                kind: "pref",
                label: `preference ${shortId(e.preference_id)}: ${e.from_status ?? "∅"} → ${e.to_status}`,
                sub: `reason: ${e.reason_code}`,
              })),
              ...(tl.assignment_events ?? []).map((e: any) => ({
                at: e.occurred_at,
                kind: "assign",
                label: `assignment ${e.event_type} (run ${shortId(e.driver_run_id)})`,
                sub: `pickup@${e.pickup_fraction?.toFixed(2)} · drop@${e.drop_fraction?.toFixed(2)}`,
              })),
              ...(tl.otp_events ?? []).map((e: any) => ({
                at: e.occurred_at,
                kind: "otp",
                label: e.attempt_number === 0 ? "OTP issued" : `OTP attempt #${e.attempt_number}`,
                sub: `ride status at time: ${e.ride_status_at}`,
              })),
            ]
              .sort((a, b) => +new Date(a.at) - +new Date(b.at))
              .map((e, i) => (
                <li key={i} className="ml-4">
                  <div className="absolute w-2 h-2 bg-slate-400 rounded-full -left-[5px] mt-2" />
                  <div className="font-medium">{e.label}</div>
                  <div className="text-xs text-slate-500">{e.sub}</div>
                  <div className="text-xs text-slate-400">{datetime(e.at)}</div>
                </li>
              ))}
          </ol>
        </div>
      )}

      {payment_intents.length > 0 && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Payment intents</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left py-1">Stripe PI</th>
                <th className="text-left py-1">Preference</th>
                <th className="text-right py-1">Amount</th>
                <th className="text-left py-1">Status</th>
                <th className="text-left py-1">Created</th>
              </tr>
            </thead>
            <tbody>
              {payment_intents.map((pi: any) => (
                <tr key={pi.stripe_pi_id} className="border-t border-slate-100">
                  <td className="py-1 font-mono text-xs">{pi.stripe_pi_id}</td>
                  <td className="py-1 font-mono text-xs">{shortId(pi.preference_id)}</td>
                  <td className="py-1 text-right tabular-nums">{money(pi.amount_cents, pi.currency)}</td>
                  <td className="py-1"><StatusBadge value={pi.status} /></td>
                  <td className="py-1 text-slate-500">{datetime(pi.created_at)}</td>
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
    <div className="flex justify-between py-1 text-sm gap-4">
      <span className="text-slate-500 whitespace-nowrap">{k}</span>
      <span className="text-slate-900 text-right">{v ?? "—"}</span>
    </div>
  );
}

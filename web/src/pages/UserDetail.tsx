import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { datetime } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

export default function UserDetail() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ["user", id],
    queryFn: async () => (await api.get(`/api/users/${id}`)).data,
  });

  if (q.isLoading) return <div className="text-slate-500">Loading…</div>;
  if (q.isError) return <div className="text-rose-600">Failed to load.</div>;

  const d = q.data;
  const u = d.user;

  return (
    <div className="space-y-6">
      <div>
        <Link to="/users" className="text-sm text-slate-500 hover:text-slate-700">← Users</Link>
        <h1 className="text-2xl font-semibold mt-1">{u.full_name}</h1>
        <div className="text-sm text-slate-500 font-mono">{u.id}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="kpi-card">
          <div className="kpi-label mb-3">Profile</div>
          <KV k="Role" v={<StatusBadge value={u.role} />} />
          <KV k="Email" v={u.email} />
          <KV k="Phone" v={u.phone_number} />
          <KV k="Auth provider" v={u.auth_provider} />
          <KV k="Email verified" v={u.is_email_verified ? "yes" : "no"} />
          <KV k="Phone verified" v={u.is_phone_verified ? "yes" : "no"} />
          <KV k="Gender" v={u.gender} />
          <KV k="DOB" v={u.date_of_birth} />
          <KV k="Active" v={u.is_active ? "yes" : "no"} />
          <KV k="Joined" v={datetime(u.created_at)} />
        </div>

        {d.driver_profile && (
          <div className="kpi-card">
            <div className="kpi-label mb-3">
              Driver profile
              {u.role === "driver" && (
                <Link to={`/drivers/${u.id}`} className="ml-2 text-xs text-blue-600 hover:underline">
                  → full driver view
                </Link>
              )}
            </div>
            <KV k="License #" v={d.driver_profile.license_number} />
            <KV k="Status" v={<StatusBadge value={d.driver_profile.verification_status} />} />
            <KV k="Is verified" v={d.driver_profile.is_verified ? "yes" : "no"} />
            <KV k="Experience (yrs)" v={d.driver_profile.experience_years} />
            <KV k="Counters (may drift)" v={`${d.driver_profile.completed_rides} completed / ${d.driver_profile.accepted_rides} accepted / ${d.driver_profile.denied_rides} denied`} />
          </div>
        )}

        {d.passenger_profile && (
          <div className="kpi-card">
            <div className="kpi-label mb-3">Passenger profile</div>
            <KV k="Profile created" v={datetime(d.passenger_profile.created_at)} />
          </div>
        )}

        {d.driver_verification && (
          <div className="kpi-card">
            <div className="kpi-label mb-3">Stripe verification</div>
            <KV k="Verified" v={d.driver_verification.is_verified ? "yes" : "no"} />
            <KV k="Verified at" v={datetime(d.driver_verification.verified_at)} />
            <KV k="Session" v={d.driver_verification.stripe_session_id} />
            <KV k="Last error" v={d.driver_verification.last_error ?? "—"} />
          </div>
        )}
      </div>

      {d.vehicles.length > 0 && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Vehicles</div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="text-left py-1">Year</th>
                <th className="text-left py-1">Make</th>
                <th className="text-left py-1">Model</th>
                <th className="text-left py-1">Color</th>
                <th className="text-left py-1">Plate</th>
                <th className="text-left py-1">VIN</th>
                <th className="text-left py-1">Status</th>
              </tr>
            </thead>
            <tbody>
              {d.vehicles.map((v: any) => (
                <tr key={v.id} className="border-t border-slate-100">
                  <td className="py-1">{v.year}</td>
                  <td className="py-1">{v.make}</td>
                  <td className="py-1">{v.model}</td>
                  <td className="py-1">{v.color}</td>
                  <td className="py-1">{v.plate_number} {v.plate_state && `(${v.plate_state})`}</td>
                  <td className="py-1 font-mono text-xs">{v.vin}</td>
                  <td className="py-1"><StatusBadge value={v.verification_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {d.social_accounts.length > 0 && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Social accounts</div>
          {d.social_accounts.map((s: any) => (
            <div key={s.provider_user_id} className="text-sm py-1">
              <span className="font-medium">{s.provider}</span> · {s.email ?? s.provider_user_id}
            </div>
          ))}
        </div>
      )}

      {d.preferred_locations.length > 0 && (
        <div className="kpi-card">
          <div className="kpi-label mb-3">Preferred locations</div>
          {d.preferred_locations.map((p: any, i: number) => (
            <div key={i} className="text-sm py-1">
              <span className="font-medium">{p.label}</span> · {p.address}
            </div>
          ))}
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

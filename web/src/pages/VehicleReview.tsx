import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";

type VehicleItem = {
  vehicle_id: string;
  driver_id: string;
  user_id: string;
  full_name: string;
  email: string;
  phone_number: string;
  license_url: string | null;
  license_number: string | null;
  license_state: string | null;
  license_expiry_date: string | null;
  driver_status: string;
  provisional_granted: boolean;
  provisional_status: string | null;
  provisional_expires_at: string | null;
  vin: string;
  plate_number: string | null;
  plate_state: string | null;
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  color: string | null;
  body_style: string | null;
  engine: string | null;
  transmission: string | null;
  drive_type: string | null;
  vehicle_status: string;
  vin_verified: boolean | null;
  doc_verified: boolean | null;
  insurance_verified: boolean | null;
  history_verified: boolean | null;
  vin_valid: boolean | null;
  checksum_ok: boolean | null;
  registration_expiry_date: string | null;
  registered_owner_name: string | null;
  owner_permission_granted: boolean;
  registration_doc_url: string | null;
  registration_doc_json: any;
  plate_lookup_json: any;
  vin_lookup_json: any;
  insurance_summary: any;
  ocr_raw_json: string | null;
  specs_json: any;
  vehicle_created_at: string;
  vehicle_updated_at: string;
};

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    pending: "bg-amber-100 text-amber-800",
    approved: "bg-kamuit-100 text-kamuit-800",
    rejected: "bg-rose-100 text-rose-800",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${colors[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status}
    </span>
  );
}

function CheckMark({ ok }: { ok: boolean | null | undefined }) {
  if (ok === true) return <span className="text-kamuit-500 font-bold">&#10003;</span>;
  if (ok === false) return <span className="text-rose-500 font-bold">&#10007;</span>;
  return <span className="text-slate-400">—</span>;
}

function JsonPanel({ title, data }: { title: string; data: any }) {
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const str = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  const lines = str.split("\n").length;

  return (
    <div className="border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-4 py-2.5 bg-slate-50 text-left text-sm font-medium text-slate-700 flex items-center justify-between hover:bg-slate-100"
      >
        <span>{title}</span>
        <span className="text-xs text-slate-400">{lines} lines {open ? "▲" : "▼"}</span>
      </button>
      {open && (
        <pre className="px-4 py-3 text-xs text-slate-600 bg-white overflow-x-auto max-h-96 overflow-y-auto whitespace-pre-wrap">
          {str}
        </pre>
      )}
    </div>
  );
}

function VehicleCard({ v, onSelect }: { v: VehicleItem; onSelect: () => void }) {
  return (
    <div
      onClick={onSelect}
      className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 cursor-pointer hover:border-slate-400 transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="font-semibold text-slate-900">
            {v.year} {v.make} {v.model} {v.trim && <span className="text-slate-500 font-normal">{v.trim}</span>}
          </div>
          <div className="text-sm text-slate-500 mt-0.5">{v.full_name} &middot; {v.email}</div>
        </div>
        <StatusBadge status={v.vehicle_status} />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div>
          <div className="text-slate-400 uppercase tracking-wider">VIN</div>
          <div className="font-mono text-slate-700 mt-0.5">{v.vin?.slice(0, 11)}...</div>
        </div>
        <div>
          <div className="text-slate-400 uppercase tracking-wider">Plate</div>
          <div className="text-slate-700 mt-0.5">{v.plate_number ?? "—"} {v.plate_state ?? ""}</div>
        </div>
        <div>
          <div className="text-slate-400 uppercase tracking-wider">Color</div>
          <div className="text-slate-700 mt-0.5">{v.color ?? "—"}</div>
        </div>
        <div>
          <div className="text-slate-400 uppercase tracking-wider">Driver Status</div>
          <div className="mt-0.5"><StatusBadge status={v.driver_status} /></div>
        </div>
      </div>

      <div className="flex gap-3 mt-3 text-xs">
        <span className="flex items-center gap-1">VIN <CheckMark ok={v.vin_verified} /></span>
        <span className="flex items-center gap-1">Doc <CheckMark ok={v.doc_verified} /></span>
        <span className="flex items-center gap-1">Insurance <CheckMark ok={v.insurance_verified} /></span>
        <span className="flex items-center gap-1">Checksum <CheckMark ok={v.checksum_ok} /></span>
      </div>

      {v.provisional_granted && (
        <div className="mt-2 px-2 py-1 bg-blue-50 rounded text-xs text-blue-700">
          Provisional granted
          {v.provisional_expires_at && <> &middot; expires {new Date(v.provisional_expires_at).toLocaleDateString()}</>}
        </div>
      )}
    </div>
  );
}

function ReviewDetail({ vehicleId, onBack }: { vehicleId: string; onBack: () => void }) {
  const qc = useQueryClient();
  const [action, setAction] = useState<string | null>(null);
  const [reason, setReason] = useState("");

  const q = useQuery({
    queryKey: ["vehicle-detail", vehicleId],
    queryFn: () => api.get(`/api/vehicle-review/${vehicleId}`).then((r) => r.data as VehicleItem),
  });

  const mutation = useMutation({
    mutationFn: (payload: { action: string; reason?: string }) =>
      api.post(`/api/vehicle-review/${vehicleId}/review`, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-review"] });
      qc.invalidateQueries({ queryKey: ["vehicle-detail", vehicleId] });
      setAction(null);
      setReason("");
    },
  });

  if (q.isLoading) return <div className="p-8 text-slate-400">Loading...</div>;
  if (!q.data) return <div className="p-8 text-slate-400">Vehicle not found</div>;

  const v = q.data;
  const insuranceDocUrl = v.insurance_summary?.insurance_doc_url;

  return (
    <div>
      <button onClick={onBack} className="text-sm text-slate-500 hover:text-slate-900 mb-4 flex items-center gap-1">
        ← Back to queue
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-slate-900">
            {v.year} {v.make} {v.model} {v.trim}
          </h2>
          <div className="text-sm text-slate-500 mt-1">
            {v.full_name} &middot; {v.email} &middot; {v.phone_number}
          </div>
        </div>
        <StatusBadge status={v.vehicle_status} />
      </div>

      {/* Action buttons */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 mb-6">
        <div className="text-sm font-semibold text-slate-700 mb-3">Review Decision</div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => mutation.mutate({ action: "approve" })}
            disabled={mutation.isPending}
            className="px-4 py-2 bg-kamuit-500 text-white rounded-lg text-sm font-medium hover:bg-kamuit-600 disabled:opacity-50"
          >
            Accept &amp; Approve
          </button>
          <button
            onClick={() => setAction(action === "resubmit" ? null : "resubmit")}
            className="px-4 py-2 bg-amber-500 text-white rounded-lg text-sm font-medium hover:bg-amber-600"
          >
            Request Resubmission
          </button>
          <button
            onClick={() => setAction(action === "reject" ? null : "reject")}
            className="px-4 py-2 bg-rose-600 text-white rounded-lg text-sm font-medium hover:bg-rose-700"
          >
            Reject
          </button>
          <button
            onClick={() => setAction(action === "more_info" ? null : "more_info")}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700"
          >
            Request More Info
          </button>
        </div>
        {action && (
          <div className="mt-3">
            <textarea
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-slate-900"
              rows={3}
              placeholder={`Reason for ${action}...`}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <button
              onClick={() => mutation.mutate({ action, reason: reason || undefined })}
              disabled={mutation.isPending}
              className="mt-2 px-4 py-2 bg-slate-900 text-white rounded-lg text-sm font-medium hover:bg-slate-800 disabled:opacity-50"
            >
              {mutation.isPending ? "Submitting..." : `Confirm ${action}`}
            </button>
            {mutation.isError && (
              <div className="mt-2 text-sm text-rose-600">
                {(mutation.error as any)?.response?.data?.detail ?? "Action failed"}
              </div>
            )}
            {mutation.isSuccess && (
              <div className="mt-2 text-sm text-kamuit-500">Decision submitted.</div>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left column: Documents */}
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-kamuit-500 mb-2">Documents</div>

          {/* Registration Document */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-medium text-sm text-slate-700">
              Registration Document
            </div>
            {v.registration_doc_url ? (
              <div className="p-4">
                <img
                  src={v.registration_doc_url}
                  alt="Registration document"
                  className="w-full rounded-lg border border-slate-200 max-h-[500px] object-contain bg-slate-50"
                />
                <a
                  href={v.registration_doc_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline mt-2 block"
                >
                  Open full size ↗
                </a>
              </div>
            ) : (
              <div className="p-4 text-sm text-slate-400">No registration document uploaded</div>
            )}
          </div>

          {/* Insurance Document */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-100 font-medium text-sm text-slate-700">
              Insurance Document
            </div>
            {insuranceDocUrl ? (
              <div className="p-4">
                <img
                  src={insuranceDocUrl}
                  alt="Insurance document"
                  className="w-full rounded-lg border border-slate-200 max-h-[500px] object-contain bg-slate-50"
                />
                <a
                  href={insuranceDocUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-blue-600 hover:underline mt-2 block"
                >
                  Open full size ↗
                </a>
              </div>
            ) : (
              <div className="p-4 text-sm text-slate-400">No insurance document uploaded</div>
            )}
          </div>

          {/* Driver License */}
          {v.license_url && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-100 font-medium text-sm text-slate-700">
                Driver License
              </div>
              <div className="p-4">
                <img
                  src={v.license_url}
                  alt="Driver license"
                  className="w-full rounded-lg border border-slate-200 max-h-[400px] object-contain bg-slate-50"
                />
                <div className="mt-2 text-xs text-slate-500">
                  {v.license_number && <span>License: {v.license_number} </span>}
                  {v.license_state && <span>({v.license_state}) </span>}
                  {v.license_expiry_date && <span>&middot; Expires: {v.license_expiry_date}</span>}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right column: Data panels */}
        <div className="space-y-4">
          <div className="text-xs font-semibold uppercase tracking-widest text-kamuit-500 mb-2">Verification Data</div>

          {/* User-entered vehicle info */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="font-medium text-sm text-slate-700 mb-3">User-Entered Vehicle Info</div>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
              {[
                ["VIN", v.vin],
                ["Plate", `${v.plate_number ?? "—"} ${v.plate_state ?? ""}`],
                ["Year", v.year],
                ["Make", v.make],
                ["Model", v.model],
                ["Trim", v.trim],
                ["Color", v.color],
                ["Body Style", v.body_style],
                ["Engine", v.engine],
                ["Transmission", v.transmission],
                ["Drive Type", v.drive_type],
                ["Reg. Owner", v.registered_owner_name],
                ["Reg. Expiry", v.registration_expiry_date],
                ["Owner Permission", v.owner_permission_granted ? "Yes" : "No"],
              ].map(([label, val]) => (
                <div key={label as string}>
                  <span className="text-slate-400 text-xs">{label}</span>
                  <div className="text-slate-800 font-mono text-xs">{val ?? "—"}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Verification Flags */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
            <div className="font-medium text-sm text-slate-700 mb-3">Verification Checks</div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["VIN Valid", v.vin_valid],
                ["Checksum OK", v.checksum_ok],
                ["VIN Verified", v.vin_verified],
                ["Doc Verified", v.doc_verified],
                ["Insurance Verified", v.insurance_verified],
                ["History Verified", v.history_verified],
              ].map(([label, val]) => (
                <div key={label as string} className="flex items-center gap-2">
                  <CheckMark ok={val as boolean | null} />
                  <span className="text-slate-700">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Insurance Summary */}
          {v.insurance_summary && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="font-medium text-sm text-slate-700 mb-3">Insurance Summary</div>
              <div className="grid grid-cols-2 gap-y-2 gap-x-4 text-sm">
                {[
                  ["Provider", v.insurance_summary?.insurance_provider],
                  ["Policy #", v.insurance_summary?.policy_number],
                  ["Expiry", v.insurance_summary?.expiry_date],
                  ["Verified", v.insurance_summary?.verified ? "Yes" : "No"],
                  ["Manual Review", v.insurance_summary?.manual_review_requested ? "Requested" : "No"],
                ].map(([label, val]) => (
                  <div key={label as string}>
                    <span className="text-slate-400 text-xs">{label}</span>
                    <div className="text-slate-800 text-xs">{(val as string) ?? "—"}</div>
                  </div>
                ))}
              </div>
              {v.insurance_summary?.rejection_reason && (
                <div className="mt-2 px-3 py-2 bg-rose-50 rounded text-xs text-rose-700">
                  Rejection: {v.insurance_summary.rejection_reason}
                </div>
              )}
              {v.insurance_summary?.pending_reason && (
                <div className="mt-2 px-3 py-2 bg-amber-50 rounded text-xs text-amber-700">
                  Pending: {v.insurance_summary.pending_reason}
                </div>
              )}
            </div>
          )}

          {/* OCR / Registration Comparison */}
          {v.registration_doc_json && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
              <div className="font-medium text-sm text-slate-700 mb-3">Registration OCR Analysis</div>
              {v.registration_doc_json?.comparisons && (
                <div className="space-y-1 text-xs">
                  {Object.entries(v.registration_doc_json.comparisons).map(([field, val]: [string, any]) => (
                    <div key={field} className="flex items-center gap-2 py-1 border-b border-slate-50 last:border-0">
                      <CheckMark ok={val?.match ?? val?.matched} />
                      <span className="text-slate-500 w-24">{field}</span>
                      <span className="text-slate-700 font-mono">{val?.ocr ?? val?.extracted ?? "—"}</span>
                      <span className="text-slate-400 mx-1">vs</span>
                      <span className="text-slate-700 font-mono">{val?.entered ?? val?.expected ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
              {v.registration_doc_json?.manual_review_requested && (
                <div className="mt-2 px-3 py-2 bg-amber-50 rounded text-xs text-amber-700">
                  Manual review was requested
                  {v.registration_doc_json?.internal_review_reason && (
                    <span>: {v.registration_doc_json.internal_review_reason}</span>
                  )}
                </div>
              )}
              {v.registration_doc_json?.internal_forgery_flags && (
                <div className="mt-2 px-3 py-2 bg-rose-50 rounded text-xs text-rose-700">
                  Forgery flags: {JSON.stringify(v.registration_doc_json.internal_forgery_flags)}
                </div>
              )}
              {v.registration_doc_json?.resubmit_reason && (
                <div className="mt-2 px-3 py-2 bg-amber-50 rounded text-xs text-amber-700">
                  Resubmission requested: {typeof v.registration_doc_json.resubmit_reason === "string" ? v.registration_doc_json.resubmit_reason : JSON.stringify(v.registration_doc_json.resubmit_reason)}
                </div>
              )}
            </div>
          )}

          {/* Raw data panels (collapsible) */}
          <JsonPanel title="Plate Lookup Data" data={v.plate_lookup_json} />
          <JsonPanel title="VIN Lookup Data" data={v.vin_lookup_json} />
          <JsonPanel title="OCR Raw Data" data={v.ocr_raw_json} />
          <JsonPanel title="Vehicle Specs" data={v.specs_json} />
        </div>
      </div>
    </div>
  );
}

export default function VehicleReview() {
  const [statusFilter, setStatusFilter] = useState("pending");
  const [selected, setSelected] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["vehicle-review", statusFilter],
    queryFn: () => api.get("/api/vehicle-review/queue", { params: { status_filter: statusFilter } }).then((r) => r.data as { items: VehicleItem[]; count: number }),
  });

  if (selected) {
    return (
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">Vehicle Onboarding</div>
        <h1 className="text-2xl font-bold text-slate-900 mb-6">Manual Review</h1>
        <ReviewDetail vehicleId={selected} onBack={() => setSelected(null)} />
      </div>
    );
  }

  const items = q.data?.items ?? [];

  return (
    <div>
      <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">Vehicle Onboarding</div>
      <h1 className="text-2xl font-bold text-slate-900 mb-1">Manual Review Queue</h1>
      <p className="text-sm text-slate-500 mb-6">
        Vehicles that need manual document review after provisional certification
      </p>

      <div className="flex items-center gap-2 mb-6">
        {["pending", "rejected", "all"].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              statusFilter === s
                ? "bg-slate-900 text-white"
                : "bg-white border border-slate-300 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <span className="ml-auto text-xs text-slate-400">{items.length} vehicles</span>
      </div>

      {q.isLoading ? (
        <div className="p-8 text-center text-slate-400 text-sm">Loading review queue...</div>
      ) : items.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-12 text-center">
          <div className="text-slate-400 text-sm">No vehicles awaiting review in the "{statusFilter}" category</div>
        </div>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {items.map((v) => (
            <VehicleCard key={v.vehicle_id} v={v} onSelect={() => setSelected(v.vehicle_id)} />
          ))}
        </div>
      )}
    </div>
  );
}

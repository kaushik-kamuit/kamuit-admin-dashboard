import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import { datetime, money, shortId } from "../lib/format";

type EntityKey = "drivers" | "vehicles" | "rides" | "driver_runs" | "payments" | "wallets";

type EntityConfig = {
  label: string;
  statuses?: string[];
  columns: { key: string; label: string; kind?: "money" | "date" | "status" | "bool" }[];
  editable: boolean;
};

const ENTITIES: Record<EntityKey, EntityConfig> = {
  drivers: {
    label: "Drivers",
    statuses: ["pending", "approved", "rejected"],
    editable: true,
    columns: [
      { key: "full_name", label: "Driver" },
      { key: "verification_status", label: "Status", kind: "status" },
      { key: "vehicle_count", label: "Vehicles" },
      { key: "pending_vehicles", label: "Pending vehicles" },
      { key: "insurance_gaps", label: "Insurance gaps" },
      { key: "created_at", label: "Joined", kind: "date" },
    ],
  },
  vehicles: {
    label: "Vehicles",
    statuses: ["pending", "approved", "rejected"],
    editable: true,
    columns: [
      { key: "driver_name", label: "Driver" },
      { key: "verification_status", label: "Status", kind: "status" },
      { key: "plate_number", label: "Plate" },
      { key: "vin", label: "VIN" },
      { key: "make", label: "Make" },
      { key: "model", label: "Model" },
      { key: "insurance_verified", label: "Insurance", kind: "bool" },
    ],
  },
  rides: {
    label: "Rides",
    statuses: ["REQUESTED", "OFFER_SENT", "ACCEPTED", "PICKUP_ARRIVING", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    editable: true,
    columns: [
      { key: "id", label: "Ride" },
      { key: "status", label: "Status", kind: "status" },
      { key: "rider_id", label: "Rider" },
      { key: "pickup_address", label: "Pickup" },
      { key: "drop_address", label: "Drop" },
      { key: "created_at", label: "Created", kind: "date" },
    ],
  },
  driver_runs: {
    label: "Driver Runs",
    statuses: ["OPEN", "PARTIALLY_FILLED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
    editable: true,
    columns: [
      { key: "id", label: "Run" },
      { key: "status", label: "Status", kind: "status" },
      { key: "driver_id", label: "Driver" },
      { key: "seats_left", label: "Seats left" },
      { key: "assignments", label: "Assignments" },
      { key: "last_ping_at", label: "Last GPS", kind: "date" },
    ],
  },
  payments: {
    label: "Payments",
    statuses: ["requires_capture", "succeeded", "canceled", "failed"],
    editable: false,
    columns: [
      { key: "stripe_pi_id", label: "Stripe PI" },
      { key: "status", label: "Status", kind: "status" },
      { key: "passenger_id", label: "Passenger" },
      { key: "amount_cents", label: "Amount", kind: "money" },
      { key: "created_at", label: "Created", kind: "date" },
    ],
  },
  wallets: {
    label: "Wallets",
    editable: false,
    columns: [
      { key: "driver_id", label: "Driver" },
      { key: "earnings_cents", label: "Earnings", kind: "money" },
      { key: "credits_cents", label: "Credits", kind: "money" },
      { key: "currency", label: "Currency" },
      { key: "updated_at", label: "Updated", kind: "date" },
    ],
  },
};

export default function Explorer() {
  const [entity, setEntity] = useState<EntityKey>("drivers");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<any | null>(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const limit = 40;

  const cfg = ENTITIES[entity];

  const q = useQuery({
    queryKey: ["ops-explorer", entity, search, status, page],
    queryFn: async () => {
      const params: Record<string, any> = { limit, offset: page * limit };
      if (search.trim()) params.search = search.trim();
      if (status) params.status = status;
      return (await api.get(`/api/operations/explorer/${entity}`, { params })).data;
    },
  });

  useEffect(() => {
    setSelected(null);
    setStatus("");
    setPage(0);
  }, [entity]);

  const rows = q.data?.items ?? [];
  const maxPage = Math.max(0, Math.ceil((q.data?.total ?? 0) / limit) - 1);

  async function saveEdit(patch: Record<string, unknown>) {
    if (!selected) return;
    setSaving(true);
    setMessage("");
    try {
      if (entity === "drivers") {
        await api.patch(`/api/operations/drivers/${selected.id}/status`, patch);
      } else if (entity === "vehicles") {
        await api.patch(`/api/operations/vehicles/${selected.id}/status`, patch);
      } else if (entity === "rides") {
        await api.patch(`/api/operations/rides/${selected.id}/status`, patch);
      } else if (entity === "driver_runs") {
        await api.patch(`/api/operations/driver-runs/${selected.id}/status`, patch);
      }
      setMessage("Saved.");
      await q.refetch();
    } catch (err: any) {
      setMessage(err?.response?.data?.detail ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="explorer-page">
      <header className="operations-header">
        <div>
          <p className="operations-kicker">Connected Data</p>
          <h1>Explorer</h1>
          <p className="operations-subtitle">
            Search, filter, inspect, and perform targeted operational edits across the current Kamuit services.
          </p>
        </div>
        <div className="explorer-tabs">
          {(Object.keys(ENTITIES) as EntityKey[]).map((key) => (
            <button
              key={key}
              className={entity === key ? "active" : ""}
              onClick={() => setEntity(key)}
            >
              {ENTITIES[key].label}
            </button>
          ))}
        </div>
      </header>

      <section className="explorer-toolbar">
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          placeholder={`Search ${cfg.label.toLowerCase()}...`}
        />
        {cfg.statuses && (
          <select
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
          >
            <option value="">All statuses</option>
            {cfg.statuses.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <div className="toolbar-count">{q.data ? `${q.data.total} rows` : "Loading..."}</div>
      </section>

      <section className="explorer-layout">
        <div className="explorer-table-wrap">
          <div className="explorer-table">
            <div className="explorer-table-head" style={{ gridTemplateColumns: gridTemplate(cfg.columns.length) }}>
              {cfg.columns.map((col) => <span key={col.key}>{col.label}</span>)}
            </div>
            {q.isLoading && <div className="ops-empty-row">Loading rows...</div>}
            {!q.isLoading && rows.length === 0 && <div className="ops-empty-row">No matching rows.</div>}
            {rows.map((row: any) => (
              <button
                key={row.id}
                className={`explorer-table-row ${selected?.id === row.id ? "selected" : ""}`}
                style={{ gridTemplateColumns: gridTemplate(cfg.columns.length) }}
                onClick={() => {
                  setSelected(row);
                  setMessage("");
                }}
              >
                {cfg.columns.map((col) => (
                  <span key={col.key}>{formatCell(row[col.key], col.kind)}</span>
                ))}
              </button>
            ))}
          </div>
          <div className="explorer-pager">
            <span>Page {page + 1} of {maxPage + 1}</span>
            <div>
              <button disabled={page === 0} onClick={() => setPage(page - 1)}>Previous</button>
              <button disabled={page >= maxPage} onClick={() => setPage(page + 1)}>Next</button>
            </div>
          </div>
        </div>

        <aside className="inspector">
          <div className="ops-panel-head">
            <span>Inspector</span>
            <h2>{selected ? titleFor(entity, selected) : "Select a row"}</h2>
          </div>
          {!selected && <p className="inspector-empty">Choose any row to inspect fields and available edits.</p>}
          {selected && (
            <>
              <dl className="inspector-fields">
                {Object.entries(selected).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(formatRaw(value))}</dd>
                  </div>
                ))}
              </dl>
              {cfg.editable && (
                <EditForm
                  entity={entity}
                  selected={selected}
                  statuses={cfg.statuses ?? []}
                  saving={saving}
                  message={message}
                  onSave={saveEdit}
                />
              )}
            </>
          )}
        </aside>
      </section>
    </div>
  );
}

function EditForm({
  entity,
  selected,
  statuses,
  saving,
  message,
  onSave,
}: {
  entity: EntityKey;
  selected: any;
  statuses: string[];
  saving: boolean;
  message: string;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [status, setStatus] = useState(
    selected.verification_status ?? selected.status ?? "",
  );
  const [doc, setDoc] = useState(Boolean(selected.doc_verified));
  const [insurance, setInsurance] = useState(Boolean(selected.insurance_verified));
  const [history, setHistory] = useState(Boolean(selected.history_verified));
  const [vin, setVin] = useState(Boolean(selected.vin_verified));

  useEffect(() => {
    setStatus(selected.verification_status ?? selected.status ?? "");
    setDoc(Boolean(selected.doc_verified));
    setInsurance(Boolean(selected.insurance_verified));
    setHistory(Boolean(selected.history_verified));
    setVin(Boolean(selected.vin_verified));
  }, [selected]);

  const patch = useMemo(() => {
    if (entity === "drivers") {
      return { verification_status: status };
    }
    if (entity === "vehicles") {
      return {
        verification_status: status,
        doc_verified: doc,
        insurance_verified: insurance,
        history_verified: history,
        vin_verified: vin,
      };
    }
    return { status };
  }, [doc, entity, history, insurance, status, vin]);

  return (
    <div className="edit-panel">
      <div className="ops-panel-head">
        <span>Targeted edit</span>
        <h2>Status controls</h2>
      </div>
      <label>
        Status
        <select value={status} onChange={(e) => setStatus(e.target.value)}>
          {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </label>
      {entity === "vehicles" && (
        <div className="check-grid">
          <label><input type="checkbox" checked={doc} onChange={(e) => setDoc(e.target.checked)} /> Registration doc</label>
          <label><input type="checkbox" checked={insurance} onChange={(e) => setInsurance(e.target.checked)} /> Insurance</label>
          <label><input type="checkbox" checked={history} onChange={(e) => setHistory(e.target.checked)} /> History</label>
          <label><input type="checkbox" checked={vin} onChange={(e) => setVin(e.target.checked)} /> VIN</label>
        </div>
      )}
      <button className="save-button" disabled={saving} onClick={() => onSave(patch)}>
        {saving ? "Saving..." : "Save changes"}
      </button>
      {message && <div className="edit-message">{message}</div>}
    </div>
  );
}

function gridTemplate(count: number) {
  return `repeat(${count}, minmax(120px, 1fr))`;
}

function formatCell(value: unknown, kind?: string) {
  if (kind === "money") return money(value as any);
  if (kind === "date") return datetime(value as any);
  if (kind === "status") return <StatusBadge value={value as string} />;
  if (kind === "bool") return value ? "yes" : "no";
  if (typeof value === "string" && value.length > 42) return value.slice(0, 42) + "...";
  return value == null || value === "" ? "-" : String(value);
}

function formatRaw(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "boolean") return value ? "yes" : "no";
  return value;
}

function titleFor(entity: EntityKey, row: any) {
  if (entity === "drivers") return row.full_name ?? shortId(row.id);
  if (entity === "vehicles") return `${row.year ?? ""} ${row.make ?? ""} ${row.model ?? ""}`.trim() || shortId(row.id);
  if (entity === "payments") return row.stripe_pi_id ?? shortId(row.id);
  if (entity === "wallets") return shortId(row.driver_id);
  return shortId(row.id);
}

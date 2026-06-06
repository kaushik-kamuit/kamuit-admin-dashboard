import { useState } from "react";
import { api } from "../api/client";

type DbKey = "user_mgmt" | "kamuit" | "payment";

const PRESETS: Record<DbKey, { label: string; sql: string }[]> = {
  user_mgmt: [
    {
      label: "Driver review queue",
      sql: `select
  u.full_name,
  u.email,
  lower(dp.verification_status::text) as status,
  dp.is_verified,
  dp.experience_years,
  dp.created_at
from driver_profiles dp
join users u on u.id = dp.user_id
order by dp.created_at desc`,
    },
    {
      label: "Vehicle verification gaps",
      sql: `select
  v.id,
  u.full_name as driver,
  v.plate_number,
  v.vin,
  lower(v.verification_status::text) as status,
  v.doc_verified,
  v.insurance_verified
from vehicles v
join driver_profiles dp on dp.id = v.driver_id
join users u on u.id = dp.user_id
where coalesce(v.doc_verified, false) = false
   or coalesce(v.insurance_verified, false) = false`,
    },
  ],
  kamuit: [
    {
      label: "Active ride state",
      sql: `select
  r.id,
  r.status::text as status,
  r.rider_id,
  r.pickup_address,
  r.drop_address,
  r.created_at
from rides r
where r.status::text in ('ACCEPTED', 'PICKUP_ARRIVING', 'IN_PROGRESS')
order by r.created_at desc`,
    },
    {
      label: "Runs without recent GPS",
      sql: `select
  dr.id,
  dr.driver_id,
  dr.status::text as status,
  dr.origin_address,
  dr.dest_address,
  max(p.recorded_at) as last_ping_at
from driver_runs dr
left join driver_location_pings p on p.driver_run_id = dr.id
where dr.status::text = 'IN_PROGRESS'
group by dr.id
order by last_ping_at nulls first`,
    },
  ],
  payment: [
    {
      label: "Held and failed intents",
      sql: `select
  stripe_pi_id,
  passenger_id,
  preference_id,
  amount_cents,
  currency,
  status,
  created_at
from payment_intents
where status in ('requires_capture', 'failed')
order by created_at desc`,
    },
    {
      label: "Driver wallet balances",
      sql: `select
  driver_id,
  earnings_cents,
  credits_cents,
  updated_at
from wallet_balances
order by earnings_cents desc`,
    },
  ],
};

const DEFAULT_SQL = PRESETS.kamuit[0].sql;

export default function QueryStudio() {
  const [database, setDatabase] = useState<DbKey>("kamuit");
  const [sql, setSql] = useState(DEFAULT_SQL);
  const [limit, setLimit] = useState(100);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any | null>(null);
  const [error, setError] = useState("");

  async function runQuery() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const response = await api.post("/api/operations/query", { database, sql, limit });
      setResult(response.data);
    } catch (err: any) {
      setError(err?.response?.data?.detail ?? "Query failed.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="query-page">
      <header className="operations-header">
        <div>
          <p className="operations-kicker">Ad Hoc Analysis</p>
          <h1>Query Studio</h1>
          <p className="operations-subtitle">
            Run read-only SQL against any local service database. Mutating statements are rejected by the API.
          </p>
        </div>
        <div className="query-controls">
          <select
            value={database}
            onChange={(e) => {
              const db = e.target.value as DbKey;
              setDatabase(db);
              setSql(PRESETS[db][0].sql);
              setResult(null);
            }}
          >
            <option value="user_mgmt">User management</option>
            <option value="kamuit">Ride service</option>
            <option value="payment">Payment</option>
          </select>
          <input
            type="number"
            min={1}
            max={500}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value))}
          />
        </div>
      </header>

      <section className="query-layout">
        <aside className="query-presets">
          <div className="ops-panel-head">
            <span>Presets</span>
            <h2>{databaseLabel(database)}</h2>
          </div>
          {PRESETS[database].map((preset) => (
            <button
              key={preset.label}
              onClick={() => {
                setSql(preset.sql);
                setResult(null);
              }}
            >
              {preset.label}
            </button>
          ))}
        </aside>

        <main className="query-workbench">
          <textarea value={sql} onChange={(e) => setSql(e.target.value)} spellCheck={false} />
          <div className="query-actions">
            <span>SELECT and CTE queries only</span>
            <button onClick={runQuery} disabled={running}>{running ? "Running..." : "Run query"}</button>
          </div>
          {error && <div className="query-error">{error}</div>}
          {result && (
            <div className="query-result">
              <div className="query-result-head">
                <strong>{result.row_count} rows</strong>
                <span>{result.database} · limit {result.limit}</span>
              </div>
              <div className="query-grid">
                <table>
                  <thead>
                    <tr>{result.columns.map((col: string) => <th key={col}>{col}</th>)}</tr>
                  </thead>
                  <tbody>
                    {result.rows.map((row: any, index: number) => (
                      <tr key={index}>
                        {result.columns.map((col: string) => (
                          <td key={col}>{formatValue(row[col])}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </main>
      </section>
    </div>
  );
}

function databaseLabel(database: DbKey) {
  if (database === "user_mgmt") return "User management";
  if (database === "payment") return "Payment";
  return "Ride service";
}

function formatValue(value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

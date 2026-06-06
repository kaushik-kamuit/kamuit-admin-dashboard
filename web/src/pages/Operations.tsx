import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Area,
  Bar as ReBar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import { datetime, money, shortId } from "../lib/format";

type CommandCenter = {
  generated_at: string;
  onboarding: Record<string, number>;
  identity: Record<string, number>;
  vehicles: Record<string, number>;
  review_queue: any[];
  trips: Record<string, number>;
  rides: Record<string, number>;
  matching: Record<string, number>;
  stale_active_runs: number;
  live_runs: any[];
  payment: Record<string, number>;
  wallet: Record<string, number>;
  connect: Record<string, number>;
  webhooks: Record<string, number>;
  payment_risks: any[];
};

type OpsInsights = {
  generated_at: string;
  health_scores: { label: string; score: number; detail: string }[];
  risk_register: { label: string; value: number; severity: string; href: string; detail: string; format?: string }[];
  marketplace: Record<string, number>;
  payment: Record<string, number>;
  connect: Record<string, number>;
  search: Record<string, number>;
  support: Record<string, number | string>;
  timeline: any[];
};

export default function Operations() {
  const [globalSearch, setGlobalSearch] = useState("");
  const q = useQuery<CommandCenter>({
    queryKey: ["operations-command-center"],
    queryFn: async () => (await api.get("/api/operations/command-center")).data,
  });
  const insightQ = useQuery<OpsInsights>({
    queryKey: ["operations-insights"],
    queryFn: async () => (await api.get("/api/operations/insights")).data,
  });
  const searchQ = useQuery({
    queryKey: ["operations-global-search", globalSearch],
    queryFn: async () => (await api.get("/api/operations/search", { params: { q: globalSearch } })).data,
    enabled: globalSearch.trim().length >= 2,
  });

  const d = q.data;
  const insights = insightQ.data;
  const trendRows = useMemo(
    () =>
      (insights?.timeline ?? []).map((row) => ({
        day: shortDate(row.day),
        rides: Number(row.rides ?? 0),
        driver_runs: Number(row.driver_runs ?? 0),
        searches: Number(row.searches ?? 0),
        converted_searches: Number(row.converted_searches ?? 0),
        captured_cents: Number(row.captured_cents ?? 0),
      })),
    [insights],
  );
  const criticalRisks = useMemo(
    () => (insights?.risk_register ?? []).filter((risk) => Number(risk.value ?? 0) > 0).slice(0, 6),
    [insights],
  );

  const priority = useMemo(() => {
    if (!d) return [];
    return [
      {
        label: "Driver review",
        value: Number(d.onboarding.pending ?? 0) + Number(d.vehicles.pending ?? 0),
        tone: "amber",
        href: "/drivers",
      },
      {
        label: "Rejected drivers",
        value: Number(d.onboarding.rejected ?? 0),
        tone: "rose",
        href: "/drivers",
      },
      {
        label: "Active trips",
        value: Number(d.rides.active ?? 0) + Number(d.trips.in_progress ?? 0),
        tone: "blue",
        href: "/driver-runs",
      },
      {
        label: "Stale GPS",
        value: Number(d.stale_active_runs ?? 0),
        tone: "rose",
        href: "/sessions",
      },
      {
        label: "Held payments",
        value: money(d.payment.held_cents ?? 0),
        tone: "slate",
        href: "/payments",
      },
      {
        label: "Payouts enabled",
        value: `${d.connect.payouts_enabled ?? 0}/${d.connect.total ?? 0}`,
        tone: "green",
        href: "/payments",
      },
    ];
  }, [d]);

  if (q.isLoading) {
    return <div className="operations-empty">Loading operations surface...</div>;
  }

  if (q.isError || !d) {
    return <div className="operations-error">Failed to load operations data.</div>;
  }

  return (
    <div className="operations-page">
      <header className="operations-header">
        <div>
          <p className="operations-kicker">Kamuit Operations Console</p>
          <h1>Command Center</h1>
          <p className="operations-subtitle">
            Current driver onboarding, ride flow, payment, wallet, and Connect signals from all services.
          </p>
        </div>
        <div className="operations-freshness">
          <span>Last refresh</span>
          <strong>{datetime(d.generated_at)}</strong>
        </div>
      </header>

      <section className="priority-strip">
        {priority.map((item) => (
          <Link key={item.label} to={item.href} className={`priority-item tone-${item.tone}`}>
            <span>{item.label}</span>
            <strong>{item.value}</strong>
          </Link>
        ))}
      </section>

      <section className="ops-search">
        <div>
          <span>Global search</span>
          <input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Find users, rides, driver runs, or payment intents..."
          />
        </div>
        {globalSearch.trim().length >= 2 && (
          <div className="ops-search-results">
            {(searchQ.data?.results ?? []).length === 0 && (
              <span className="search-empty">No matches.</span>
            )}
            {(searchQ.data?.results ?? []).slice(0, 8).map((result: any) => (
              <Link key={`${result.type}-${result.id}`} to={hrefForSearchResult(result)}>
                <strong>{result.type}</strong>
                <span>{result.title}</span>
                <small>{result.subtitle}</small>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="viz-grid">
        <VizPanel title="Driver readiness">
          <Bar label="Approved" value={d.onboarding.approved} total={d.onboarding.total_drivers} color="emerald" />
          <Bar label="Pending" value={d.onboarding.pending} total={d.onboarding.total_drivers} color="amber" />
          <Bar label="Rejected" value={d.onboarding.rejected} total={d.onboarding.total_drivers} color="rose" />
          <Bar label="Unverified" value={d.onboarding.verification_pending} total={d.onboarding.total_drivers} color="slate" />
        </VizPanel>
        <VizPanel title="Ride states">
          <Bar label="Requested" value={d.rides.requested} total={d.rides.total_rides} color="slate" />
          <Bar label="Accepted" value={d.rides.accepted} total={d.rides.total_rides} color="violet" />
          <Bar label="Active" value={d.rides.active} total={d.rides.total_rides} color="sky" />
          <Bar label="Completed" value={d.rides.completed} total={d.rides.total_rides} color="emerald" />
        </VizPanel>
        <VizPanel title="Matching funnel">
          <Bar label="Pending" value={d.matching.pending} total={d.matching.total_preferences} color="slate" />
          <Bar label="Offered" value={d.matching.offered} total={d.matching.total_preferences} color="sky" />
          <Bar label="Accepted" value={d.matching.accepted} total={d.matching.total_preferences} color="emerald" />
          <Bar label="Closed failed" value={d.matching.failed_or_closed} total={d.matching.total_preferences} color="rose" />
        </VizPanel>
        <VizPanel title="Payment state">
          <Bar label="Captured" value={d.payment.succeeded} total={d.payment.total_intents} color="emerald" />
          <Bar label="Held" value={d.payment.requires_capture} total={d.payment.total_intents} color="amber" />
          <Bar label="Canceled" value={d.payment.canceled} total={d.payment.total_intents} color="slate" />
          <Bar label="Failed" value={d.payment.failed} total={d.payment.total_intents} color="rose" />
        </VizPanel>
      </section>

      {insights && (
        <section className="admin-intel">
          <div className="intel-main">
            <Panel title="Operational Health" eyebrow="Current clearance, conversion, and trust signals">
              <div className="health-grid">
                {insights.health_scores.map((score) => (
                  <HealthDial key={score.label} score={score.score} label={score.label} detail={score.detail} />
                ))}
              </div>
            </Panel>

            <Panel title="Activity Pulse" eyebrow="Latest data window">
              <div className="ops-chart-shell">
                <ResponsiveContainer>
                  <ComposedChart data={trendRows}>
                    <CartesianGrid stroke="#e2e8f0" vertical={false} />
                    <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                    <Tooltip formatter={(value: any, name: string) => [formatTrendValue(value, name), name.replaceAll("_", " ")]} />
                    <Area type="monotone" dataKey="searches" fill="#d1fae5" stroke="#0BA26D" strokeWidth={2} />
                    <ReBar dataKey="rides" fill="#0284c7" radius={[4, 4, 0, 0]} />
                    <Line type="monotone" dataKey="driver_runs" stroke="#7c3aed" strokeWidth={2.5} dot={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel title="Marketplace Balance" eyebrow="Demand, supply, assignment">
              <div className="balance-grid">
                <BalanceMetric label="Demand seats" value={insights.marketplace.demand_seats} />
                <BalanceMetric label="Open seats" value={insights.marketplace.run_open_seats} />
                <BalanceMetric label="Demand / seat" value={insights.marketplace.demand_to_open_seat_ratio} />
                <BalanceMetric label="Assigned rides" value={insights.marketplace.assignment_assigned_rides} />
              </div>
              <div className="capacity-bar">
                <span style={{ width: `${capacityPct(insights.marketplace.run_occupied_seats, insights.marketplace.run_offered_seats)}%` }} />
              </div>
              <div className="capacity-copy">
                <strong>{capacityPct(insights.marketplace.run_occupied_seats, insights.marketplace.run_offered_seats).toFixed(1)}%</strong>
                <span>seat utilization on available or active driver runs</span>
              </div>
            </Panel>
          </div>

          <aside className="intel-side">
            <Panel title="Risk Register" eyebrow="Prioritized admin attention">
              <div className="risk-register">
                {criticalRisks.length === 0 && <div className="ops-empty-row">No active risk signals.</div>}
                {criticalRisks.map((risk) => (
                  <Link key={risk.label} to={risk.href} className={`risk-register-item severity-${risk.severity}`}>
                    <div>
                      <span>{risk.label}</span>
                      <p>{risk.detail}</p>
                    </div>
                    <strong>{risk.format === "money" ? money(risk.value) : risk.value}</strong>
                  </Link>
                ))}
              </div>
            </Panel>

            <Panel title="Support Signals" eyebrow="Nuanced trip support">
              <MetricRow label="OTP attempts" value={insights.support.attempts as any} danger={Number(insights.support.attempts ?? 0) > 20} />
              <MetricRow label="Rides with OTP events" value={insights.support.rides_with_attempts as any} />
              <MetricRow label="Last OTP event" value={datetime(insights.support.last_attempt_at as any)} />
              <MetricRow label="Search conversion" value={`${(Number(insights.search.conversion_rate ?? 0) * 100).toFixed(1)}%`} />
            </Panel>
          </aside>
        </section>
      )}

      <section className="ops-grid">
        <Panel title="Onboarding Pipeline" eyebrow="Driver readiness">
          <MetricRow label="Approved drivers" value={d.onboarding.approved} />
          <MetricRow label="Pending review" value={d.onboarding.pending} />
          <MetricRow label="Rejected" value={d.onboarding.rejected} />
          <MetricRow label="License not verified" value={d.onboarding.verification_pending} danger />
          <MetricRow label="Total drivers" value={d.onboarding.total_drivers} />
        </Panel>

        <Panel title="Verification And Vehicles" eyebrow="KYC, KYV, KYI">
          <MetricRow label="Identity verified" value={d.identity.verified} />
          <MetricRow label="Identity not verified" value={d.identity.not_verified} />
          <MetricRow label="Identity errors" value={d.identity.errored} danger />
          <MetricRow label="Vehicles approved" value={d.vehicles.approved} />
          <MetricRow label="Vehicles pending" value={d.vehicles.pending} />
          <MetricRow label="Registration gaps" value={d.vehicles.registration_not_verified} danger />
          <MetricRow label="Insurance gaps" value={d.vehicles.insurance_not_verified} danger />
        </Panel>

        <Panel title="Ride And Matching Health" eyebrow="Marketplace state">
          <MetricRow label="Open driver runs" value={d.trips.open} />
          <MetricRow label="Partially filled" value={d.trips.partially_filled} />
          <MetricRow label="In progress" value={d.trips.in_progress} />
          <MetricRow label="Total driver runs" value={d.trips.total_runs} />
          <MetricRow label="Requested rides" value={d.rides.requested} />
          <MetricRow label="Offered rides" value={d.rides.offer_sent} />
          <MetricRow label="Active rides" value={d.rides.active} />
          <MetricRow label="Preference sessions" value={d.matching.sessions} />
        </Panel>

        <Panel title="Revenue And Payouts" eyebrow="Stripe, wallet, Connect">
          <MetricRow label="Captured" value={money(d.payment.captured_cents)} />
          <MetricRow label="Auth holds" value={money(d.payment.held_cents)} />
          <MetricRow label="Requires capture" value={d.payment.requires_capture} />
          <MetricRow label="Failed intents" value={d.payment.failed} danger />
          <MetricRow label="Wallet earnings" value={money(d.wallet.earnings_cents)} />
          <MetricRow label="Wallet credits" value={money(d.wallet.credits_cents)} />
          <MetricRow label="Connect missing accounts" value={d.connect.missing_account} danger />
          <MetricRow label="Webhook errors" value={d.webhooks.errored} danger />
        </Panel>
      </section>

      <section className="ops-workspace">
        <div className="workspace-main">
          <Panel title="Review Queue" eyebrow="Drivers needing operator attention" flush>
            <div className="ops-table">
              <div className="ops-table-head review-grid">
                <span>Driver</span>
                <span>Status</span>
                <span>Vehicles</span>
                <span>Vehicle gaps</span>
              </div>
              {d.review_queue.length === 0 && <div className="ops-empty-row">No review items.</div>}
              {d.review_queue.map((row) => (
                <Link key={row.user_id} to={`/drivers/${row.user_id}`} className="ops-table-row review-grid">
                  <span>
                    <strong>{row.full_name}</strong>
                    <small>{row.email}</small>
                  </span>
                  <span>
                    <StatusBadge value={row.driver_status} />
                    {row.suspended_reason && <small>{row.suspended_reason}</small>}
                  </span>
                  <span>
                    {Number(row.vehicle_count || 0)} total
                    <small>{Number(row.pending_vehicles || 0)} pending review</small>
                  </span>
                  <span>
                    {Number(row.pending_vehicles || 0)} pending, {Number(row.rejected_vehicles || 0)} rejected
                    <small>{Number(row.insurance_gaps || 0)} insurance gaps</small>
                  </span>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title="Live Trip Watch" eyebrow="Open, partially-filled, and active runs" flush>
            <div className="ops-table">
              <div className="ops-table-head live-grid">
                <span>Run</span>
                <span>Driver</span>
                <span>Status</span>
                <span>Seats</span>
                <span>Last GPS</span>
              </div>
              {d.live_runs.length === 0 && <div className="ops-empty-row">No live driver runs.</div>}
              {d.live_runs.map((run) => (
                <Link key={run.id} to={`/driver-runs/${run.id}`} className="ops-table-row live-grid">
                  <span>
                    <strong>{shortId(run.id)}</strong>
                    <small>{run.origin_address} to {run.dest_address}</small>
                  </span>
                  <span>{run.driver?.full_name ?? shortId(run.driver_id)}</span>
                  <span>
                    <StatusBadge value={run.status} />
                  </span>
                  <span>{run.seats_left}/{run.seats_total}</span>
                  <span>
                    {datetime(run.last_ping_at)}
                    <small>{run.ping_count ?? 0} pings</small>
                  </span>
                </Link>
              ))}
            </div>
          </Panel>
        </div>

        <aside className="workspace-side">
          <Panel title="Payment Risk" eyebrow="Auth holds and failures" flush>
            <div className="risk-list">
              {d.payment_risks.length === 0 && <div className="ops-empty-row">No payment risks.</div>}
              {d.payment_risks.map((intent) => (
                <Link key={intent.id} to="/payments" className="risk-item">
                  <div>
                    <strong>{intent.passenger?.full_name ?? shortId(intent.passenger_id)}</strong>
                    <span>{intent.stripe_pi_id}</span>
                  </div>
                  <div>
                    <StatusBadge value={intent.status} />
                    <b>{money(intent.amount_cents, intent.currency)}</b>
                  </div>
                </Link>
              ))}
            </div>
          </Panel>

          <Panel title="Legacy Tools" eyebrow="Available during migration">
            <div className="legacy-links">
              <Link to="/legacy-overview">Legacy overview</Link>
              <Link to="/heatmap">Heatmap</Link>
              <Link to="/funnel">Preference funnel</Link>
              <Link to="/recon">Reconciliation</Link>
            </div>
          </Panel>
        </aside>
      </section>
    </div>
  );
}

function HealthDial({ score, label, detail }: { score: number; label: string; detail: string }) {
  const clamped = Math.max(0, Math.min(100, Number(score ?? 0)));
  const tone = clamped >= 75 ? "good" : clamped >= 45 ? "watch" : "risk";
  return (
    <div className={`health-dial tone-${tone}`}>
      <div className="dial-ring" style={{ background: `conic-gradient(var(--dial-color) ${clamped * 3.6}deg, #e2e8f0 0deg)` }}>
        <span>{clamped.toFixed(0)}%</span>
      </div>
      <div>
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function BalanceMetric({ label, value }: { label: string; value: any }) {
  return (
    <div className="balance-metric">
      <span>{label}</span>
      <strong>{value ?? "-"}</strong>
    </div>
  );
}

function Panel({
  title,
  eyebrow,
  children,
  flush = false,
}: {
  title: string;
  eyebrow: string;
  children: React.ReactNode;
  flush?: boolean;
}) {
  return (
    <div className={`ops-panel ${flush ? "ops-panel-flush" : ""}`}>
      <div className="ops-panel-head">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function MetricRow({
  label,
  value,
  danger = false,
}: {
  label: string;
  value: number | string | null | undefined;
  danger?: boolean;
}) {
  return (
    <div className="metric-row">
      <span>{label}</span>
      <strong className={danger && Number(value || 0) > 0 ? "metric-danger" : ""}>
        {value ?? "-"}
      </strong>
    </div>
  );
}

function VizPanel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="viz-panel">
      <h2>{title}</h2>
      <div>{children}</div>
    </div>
  );
}

function Bar({
  label,
  value,
  total,
  color,
}: {
  label: string;
  value?: number | string | null;
  total?: number | string | null;
  color: string;
}) {
  const n = Number(value ?? 0);
  const t = Math.max(1, Number(total ?? 0));
  const pct = Math.max(0, Math.min(100, (n / t) * 100));
  return (
    <div className="viz-row">
      <div>
        <span>{label}</span>
        <strong>{n}</strong>
      </div>
      <div className="viz-track">
        <i className={`bar-${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function hrefForSearchResult(result: any) {
  if (result.type === "user") return `/users/${result.id}`;
  if (result.type === "ride") return `/rides/${result.id}`;
  if (result.type === "driver_run") return `/driver-runs/${result.id}`;
  return "/payments";
}

function capacityPct(occupied: any, total: any) {
  return Math.max(0, Math.min(100, (Number(occupied ?? 0) / Math.max(1, Number(total ?? 0))) * 100));
}

function shortDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatTrendValue(value: any, name: string) {
  if (name.includes("cents")) return money(value);
  return Number(value ?? 0).toLocaleString();
}

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "../api/client";
import StatusBadge from "../components/StatusBadge";
import { datetime, shortId } from "../lib/format";

const COLORS = {
  accepted: "#0BA26D",
  declined: "#e11d48",
  expired: "#f59e0b",
  cancelled: "#64748b",
  sessions: "#0BA26D",
  converted: "#0284c7",
  line: "#7c3aed",
};

export default function Funnel() {
  const [sinceDays, setSinceDays] = useState(30);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["funnel-deep", sinceDays],
    queryFn: async () =>
      (await api.get("/api/analytics/funnel/preferences/deep", { params: { since_days: sinceDays } })).data,
  });

  const s = data?.session_summary ?? {};
  const dailyRows = useMemo(
    () =>
      (data?.daily_sessions ?? []).map((row: any) => ({
        day: shortDate(row.day),
        sessions: Number(row.sessions ?? 0),
        converted: Number(row.converted ?? 0),
        avg_candidates: round(Number(row.avg_candidates ?? 0), 2),
        conversion_rate: pctNumber(row.conversion_rate),
      })),
    [data],
  );
  const candidateRows = useMemo(
    () =>
      (data?.candidate_buckets ?? []).map((row: any) => ({
        bucket: row.bucket,
        sessions: Number(row.sessions ?? 0),
        converted: Number(row.converted ?? 0),
        conversion_rate: pctNumber(row.conversion_rate),
      })),
    [data],
  );
  const responseRows = useMemo(
    () =>
      responseKeys.map((key) => ({
        key,
        label: titleCase(key),
        value: Number(data?.response_mix?.[key] ?? 0),
        color: COLORS[key as keyof typeof COLORS],
      })),
    [data],
  );
  const transitionRows = useMemo(
    () => (data?.transition_matrix ?? []).map((row: any) => ({ ...row, transitions: Number(row.transitions ?? 0) })),
    [data],
  );
  const matrixMax = Math.max(1, ...transitionRows.map((row: any) => row.transitions));
  const attentionRows = data?.attention_sessions ?? [];
  const conversionRate = pctNumber(s.conversion_rate);
  const leakage = Number(data?.response_mix?.declined ?? 0) + Number(data?.response_mix?.expired ?? 0) + Number(data?.response_mix?.cancelled ?? 0);
  const lowCandidateSessions = candidateRows
    .filter((row: any) => row.bucket === "0" || row.bucket === "1")
    .reduce((sum: number, row: any) => sum + row.sessions, 0);
  const avgCandidates = Number(s.avg_candidates ?? 0);
  const pickupWindow = Number(s.avg_pickup_window_minutes ?? 0);

  if (isLoading) return <div className="operations-empty">Loading matching intelligence...</div>;
  if (isError || !data) return <div className="operations-error">Failed to load matching intelligence.</div>;

  return (
    <div className="funnel-page">
      <header className="operations-header">
        <div>
          <p className="operations-kicker">Matching Intelligence</p>
          <h1>Preference Funnel</h1>
          <p className="operations-subtitle">
            Conversion, candidate depth, response leakage, and operator attention signals from inferred search sessions.
          </p>
        </div>
        <div className="funnel-controls">
          <span>Window</span>
          <select value={sinceDays} onChange={(event) => setSinceDays(Number(event.target.value))}>
            <option value={14}>14 data-days</option>
            <option value={30}>30 data-days</option>
            <option value={60}>60 data-days</option>
            <option value={90}>90 data-days</option>
          </select>
        </div>
      </header>

      <section className="funnel-note">
        <strong>Proxy signal</strong>
        <span>{data.note}</span>
      </section>

      <section className="funnel-stat-strip">
        <FunnelStat label="Sessions" value={Number(s.sessions ?? 0)} />
        <FunnelStat label="Converted" value={Number(s.converted ?? 0)} />
        <FunnelStat label="Conversion" value={`${conversionRate.toFixed(1)}%`} tone={conversionRate >= 55 ? "good" : "watch"} />
        <FunnelStat label="Avg candidates" value={avgCandidates ? avgCandidates.toFixed(2) : "-"} />
        <FunnelStat label="Avg pickup spread" value={pickupWindow ? `${pickupWindow.toFixed(0)} min` : "-"} />
        <FunnelStat label="Price range" value={`${formatDollars(s.avg_min_price)} - ${formatDollars(s.avg_max_price)}`} />
      </section>

      <section className="funnel-grid">
        <VizSection title="Session Trend" eyebrow="Demand and conversion">
          <div className="chart-shell tall">
            <ResponsiveContainer>
              <ComposedChart data={dailyRows}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="day" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(value: any, name: string) => formatTooltip(value, name)} />
                <Area yAxisId="left" type="monotone" dataKey="sessions" fill="#ccfbf1" stroke={COLORS.sessions} strokeWidth={2} />
                <Bar yAxisId="left" dataKey="converted" fill={COLORS.converted} radius={[4, 4, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="conversion_rate" stroke={COLORS.line} strokeWidth={2.5} dot={false} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </VizSection>

        <VizSection title="Candidate Depth" eyebrow="Supply shown per session">
          <div className="chart-shell">
            <ResponsiveContainer>
              <ComposedChart data={candidateRows}>
                <CartesianGrid stroke="#e2e8f0" vertical={false} />
                <XAxis dataKey="bucket" tickLine={false} axisLine={false} />
                <YAxis yAxisId="left" tickLine={false} axisLine={false} />
                <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} />
                <Tooltip formatter={(value: any, name: string) => formatTooltip(value, name)} />
                <Bar yAxisId="left" dataKey="sessions" fill="#0BA26D" radius={[5, 5, 0, 0]} />
                <Line yAxisId="right" type="monotone" dataKey="conversion_rate" stroke="#e11d48" strokeWidth={2.5} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </VizSection>

        <VizSection title="Response Mix" eyebrow="Accepted versus leakage">
          <div className="donut-panel">
            <div className="donut-chart">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={responseRows} dataKey="value" innerRadius={58} outerRadius={86} paddingAngle={2}>
                    {responseRows.map((row) => (
                      <Cell key={row.key} fill={row.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(value: any) => Number(value).toLocaleString()} />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div className="donut-legend">
              {responseRows.map((row) => (
                <div key={row.key}>
                  <i style={{ background: row.color }} />
                  <span>{row.label}</span>
                  <strong>{row.value}</strong>
                </div>
              ))}
            </div>
          </div>
        </VizSection>

        <VizSection title="Admin Read" eyebrow="What deserves attention">
          <div className="funnel-read-list">
            <ReadItem label="Low-candidate sessions" value={lowCandidateSessions} detail="Sessions with only zero or one inferred candidate." />
            <ReadItem label="Leakage events" value={leakage} detail="Declined, expired, and cancelled preference outcomes." tone="risk" />
            <ReadItem label="No-primary sessions" value={Number(s.no_primary_sessions ?? 0)} detail="Sessions without a primary preference marker." />
            <ReadItem label="Best next check" value={lowCandidateSessions > 0 ? "Supply" : "Responses"} detail={lowCandidateSessions > 0 ? "Inspect heatmap demand against driver-run origins." : "Inspect decline and expiry timing."} />
          </div>
        </VizSection>
      </section>

      <section className="funnel-wide-grid">
        <VizSection title="Transition Flow" eyebrow="Where preference state moves">
          <div className="transition-list">
            {transitionRows.map((row: any) => (
              <div key={`${row.from_status}-${row.to_status}`} className="transition-row">
                <div>
                  <span>{row.from_status}</span>
                  <strong>{row.to_status}</strong>
                </div>
                <div className="transition-track">
                  <i style={{ width: `${Math.max(5, (row.transitions / matrixMax) * 100)}%` }} />
                </div>
                <b>{row.transitions}</b>
              </div>
            ))}
          </div>
        </VizSection>

        <VizSection title="Attention Sessions" eyebrow="Low depth, no conversion, or leakage">
          <div className="funnel-table">
            <div className="funnel-table-head">
              <span>Session</span>
              <span>Passenger</span>
              <span>Outcome</span>
              <span>Candidates</span>
              <span>Responses</span>
              <span>Price band</span>
              <span>Search time</span>
            </div>
            {attentionRows.map((row: any) => (
              <div key={row.session_id} className="funnel-table-row">
                <span>{shortId(row.session_id)}</span>
                <span>{shortId(row.passenger_id)}</span>
                <span><StatusBadge value={row.converted ? "converted" : "not converted"} /></span>
                <span>{row.candidates_shown}</span>
                <span>{row.accepted_count} A / {row.declined_count} D / {row.expired_count} E / {row.cancelled_count} C</span>
                <span>{formatDollars(row.min_price)} - {formatDollars(row.max_price)}</span>
                <span>{datetime(row.searched_at)}</span>
              </div>
            ))}
          </div>
        </VizSection>
      </section>
    </div>
  );
}

function VizSection({ title, eyebrow, children }: { title: string; eyebrow: string; children: React.ReactNode }) {
  return (
    <div className="funnel-panel">
      <div className="ops-panel-head">
        <span>{eyebrow}</span>
        <h2>{title}</h2>
      </div>
      {children}
    </div>
  );
}

function FunnelStat({ label, value, tone }: { label: string; value: string | number; tone?: "good" | "watch" }) {
  return (
    <div className={`funnel-stat ${tone ? `tone-${tone}` : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ReadItem({ label, value, detail, tone }: { label: string; value: string | number; detail: string; tone?: "risk" }) {
  return (
    <div className={`read-item ${tone ? `tone-${tone}` : ""}`}>
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
      <p>{detail}</p>
    </div>
  );
}

const responseKeys = ["accepted", "declined", "expired", "cancelled"];

function pctNumber(value: unknown) {
  return round(Number(value ?? 0) * 100, 1);
}

function round(value: number, places: number) {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function shortDate(value: string | null | undefined) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function formatDollars(value: unknown) {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n) || n <= 0) return "-";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function titleCase(value: string) {
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}

function formatTooltip(value: any, name: string) {
  if (name.includes("conversion")) return [`${Number(value).toFixed(1)}%`, "conversion"];
  return [Number(value).toLocaleString(), name.replaceAll("_", " ")];
}

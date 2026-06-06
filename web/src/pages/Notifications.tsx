import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from "recharts";
import { api } from "../api/client";

type Summary = {
  total_tokens: number;
  unique_users: number;
  ios_tokens: number;
  android_tokens: number;
  voip_tokens: number;
  stale_tokens_30d: number;
  stale_tokens_90d: number;
};

type Token = {
  id: string;
  user_id: string;
  expo_push_token: string;
  platform: string;
  voip_push_token: string | null;
  created_at: string;
  updated_at: string;
};

type PerUser = {
  user_id: string;
  token_count: number;
  ios: number;
  android: number;
  voip: number;
  latest_update: string;
};

type RideAlert = {
  id: string;
  passenger_id: string;
  origin_lat: number;
  origin_lng: number;
  destination_lat: number;
  destination_lng: number;
  trip_date: string;
  is_notified: boolean;
  created_at: string;
};

type Tab = "tokens" | "per-user" | "ride-alerts";

const PLATFORM_COLORS = { ios: "#3b82f6", android: "#f97316" };

export default function Notifications() {
  const [tab, setTab] = useState<Tab>("tokens");
  const [platform, setPlatform] = useState<"" | "ios" | "android">("");

  const summaryQuery = useQuery<Summary>({
    queryKey: ["notifications", "summary"],
    queryFn: async () => (await api.get("/api/notifications/summary")).data,
  });

  const tokensQuery = useQuery<Token[]>({
    queryKey: ["notifications", "tokens", platform],
    queryFn: async () => {
      const params: Record<string, any> = { limit: 50, offset: 0 };
      if (platform) params.platform = platform;
      return (await api.get("/api/notifications/tokens", { params })).data;
    },
    enabled: tab === "tokens",
  });

  const perUserQuery = useQuery<PerUser[]>({
    queryKey: ["notifications", "per-user"],
    queryFn: async () =>
      (await api.get("/api/notifications/per-user", { params: { limit: 50 } })).data,
    enabled: tab === "per-user",
  });

  const rideAlertsQuery = useQuery<RideAlert[]>({
    queryKey: ["notifications", "ride-alerts"],
    queryFn: async () =>
      (await api.get("/api/notifications/ride-alerts", { params: { limit: 50 } })).data,
    enabled: tab === "ride-alerts",
  });

  const s = summaryQuery.data;

  const pieData = s
    ? [
        { name: "iOS", value: s.ios_tokens },
        { name: "Android", value: s.android_tokens },
      ]
    : [];

  const totalForPie = (s?.ios_tokens ?? 0) + (s?.android_tokens ?? 0);

  return (
    <div className="space-y-6">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
          NOTIFICATION HEALTH
        </div>
        <h1 className="text-2xl font-bold text-slate-900">Push Notifications</h1>
      </div>

      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-4">
          <KpiCard label="Total Tokens" value={s.total_tokens} />
          <KpiCard label="Unique Users" value={s.unique_users} />
          <KpiCard label="iOS Tokens" value={s.ios_tokens} />
          <KpiCard label="Android Tokens" value={s.android_tokens} />
          <KpiCard label="VoIP Tokens" value={s.voip_tokens} />
          <KpiCard label="Stale (30d)" value={s.stale_tokens_30d} tone="amber" />
          <KpiCard label="Stale (90d)" value={s.stale_tokens_90d} tone="red" />
        </div>
      )}

      {s && totalForPie > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
          <h2 className="text-sm font-semibold text-slate-700 mb-2">Platform Distribution</h2>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={70}
                  label={({ name, value }) =>
                    `${name} ${((value / totalForPie) * 100).toFixed(1)}%`
                  }
                >
                  <Cell fill={PLATFORM_COLORS.ios} />
                  <Cell fill={PLATFORM_COLORS.android} />
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <TabBtn active={tab === "tokens"} onClick={() => setTab("tokens")}>
          Tokens
        </TabBtn>
        <TabBtn active={tab === "per-user"} onClick={() => setTab("per-user")}>
          Per-User Analysis
        </TabBtn>
        <TabBtn active={tab === "ride-alerts"} onClick={() => setTab("ride-alerts")}>
          Ride Alerts
        </TabBtn>
      </div>

      {tab === "tokens" && <TokensTab data={tokensQuery.data} isLoading={tokensQuery.isLoading} platform={platform} setPlatform={setPlatform} />}
      {tab === "per-user" && <PerUserTab data={perUserQuery.data} isLoading={perUserQuery.isLoading} />}
      {tab === "ride-alerts" && <RideAlertsTab data={rideAlertsQuery.data} isLoading={rideAlertsQuery.isLoading} />}
    </div>
  );
}

function TokensTab({
  data,
  isLoading,
  platform,
  setPlatform,
}: {
  data: Token[] | undefined;
  isLoading: boolean;
  platform: string;
  setPlatform: (v: "" | "ios" | "android") => void;
}) {
  const items = data ?? [];
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <FilterBtn active={platform === ""} onClick={() => setPlatform("")}>All</FilterBtn>
        <FilterBtn active={platform === "ios"} onClick={() => setPlatform("ios")}>iOS</FilterBtn>
        <FilterBtn active={platform === "android"} onClick={() => setPlatform("android")}>Android</FilterBtn>
      </div>
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left">User ID</th>
              <th className="px-3 py-2 text-left">Token</th>
              <th className="px-3 py-2 text-left">Platform</th>
              <th className="px-3 py-2 text-left">VoIP</th>
              <th className="px-3 py-2 text-left">Created</th>
              <th className="px-3 py-2 text-left">Updated</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
            )}
            {!isLoading && items.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No tokens found.</td></tr>
            )}
            {items.map((t) => (
              <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-3 py-2 font-mono text-xs">{t.user_id.slice(0, 8)}…</td>
                <td className="px-3 py-2 font-mono text-xs text-slate-600">{t.expo_push_token.slice(0, 20)}…</td>
                <td className="px-3 py-2">
                  <PlatformBadge platform={t.platform} />
                </td>
                <td className="px-3 py-2 text-xs">{t.voip_push_token ? "yes" : "no"}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{new Date(t.created_at).toLocaleDateString()}</td>
                <td className="px-3 py-2 text-xs text-slate-500">{new Date(t.updated_at).toLocaleDateString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PerUserTab({ data, isLoading }: { data: PerUser[] | undefined; isLoading: boolean }) {
  const items = data ?? [];
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left">User ID</th>
            <th className="px-3 py-2 text-left">Token Count</th>
            <th className="px-3 py-2 text-left">iOS</th>
            <th className="px-3 py-2 text-left">Android</th>
            <th className="px-3 py-2 text-left">VoIP</th>
            <th className="px-3 py-2 text-left">Latest Update</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
          )}
          {!isLoading && items.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No data found.</td></tr>
          )}
          {items.map((row) => (
            <tr
              key={row.user_id}
              className={`border-t border-slate-100 hover:bg-slate-50 ${row.token_count > 5 ? "bg-amber-50" : ""}`}
            >
              <td className="px-3 py-2 font-mono text-xs">{row.user_id.slice(0, 8)}…</td>
              <td className="px-3 py-2 font-bold">
                {row.token_count}
                {row.token_count > 5 && (
                  <span className="ml-2 text-xs font-medium text-amber-700">⚠ sprawl</span>
                )}
              </td>
              <td className="px-3 py-2">{row.ios}</td>
              <td className="px-3 py-2">{row.android}</td>
              <td className="px-3 py-2">{row.voip}</td>
              <td className="px-3 py-2 text-xs text-slate-500">{new Date(row.latest_update).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RideAlertsTab({ data, isLoading }: { data: RideAlert[] | undefined; isLoading: boolean }) {
  const items = data ?? [];
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-xs uppercase text-slate-600">
          <tr>
            <th className="px-3 py-2 text-left">Passenger ID</th>
            <th className="px-3 py-2 text-left">Origin</th>
            <th className="px-3 py-2 text-left">Destination</th>
            <th className="px-3 py-2 text-left">Trip Date</th>
            <th className="px-3 py-2 text-left">Notified</th>
            <th className="px-3 py-2 text-left">Created</th>
          </tr>
        </thead>
        <tbody>
          {isLoading && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
          )}
          {!isLoading && items.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-6 text-center text-slate-500">No ride alerts found.</td></tr>
          )}
          {items.map((r) => (
            <tr key={r.id} className="border-t border-slate-100 hover:bg-slate-50">
              <td className="px-3 py-2 font-mono text-xs">{r.passenger_id.slice(0, 8)}…</td>
              <td className="px-3 py-2 text-xs text-slate-600">
                {r.origin_lat.toFixed(4)}, {r.origin_lng.toFixed(4)}
              </td>
              <td className="px-3 py-2 text-xs text-slate-600">
                {r.destination_lat.toFixed(4)}, {r.destination_lng.toFixed(4)}
              </td>
              <td className="px-3 py-2 text-xs">{new Date(r.trip_date).toLocaleDateString()}</td>
              <td className="px-3 py-2">
                {r.is_notified ? (
                  <span className="text-green-600 font-medium">✓</span>
                ) : (
                  <span className="text-red-500 font-medium">✗</span>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-slate-500">{new Date(r.created_at).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KpiCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "amber" | "red";
}) {
  const base = "bg-white rounded-xl border shadow-sm p-4";
  const border = tone === "amber" ? "border-amber-200" : tone === "red" ? "border-red-200" : "border-slate-200";
  const labelColor = tone === "amber" ? "text-amber-700" : tone === "red" ? "text-red-700" : "text-slate-600";
  const valueColor = tone === "amber" ? "text-amber-900" : tone === "red" ? "text-red-900" : "text-slate-900";

  return (
    <div className={`${base} ${border}`}>
      <div className={`text-xs font-semibold uppercase tracking-wide ${labelColor}`}>{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueColor}`}>{value.toLocaleString()}</div>
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
        active
          ? "bg-kamuit-500 text-white"
          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function FilterBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
        active
          ? "bg-kamuit-500 text-white"
          : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

function PlatformBadge({ platform }: { platform: string }) {
  const styles =
    platform === "ios"
      ? "bg-blue-100 text-blue-700"
      : platform === "android"
        ? "bg-green-100 text-green-700"
        : "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles}`}>
      {platform}
    </span>
  );
}

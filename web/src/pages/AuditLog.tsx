import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api/client";
import { datetime } from "../lib/format";

type AuditEntry = {
  id: string;
  ts: string;
  username: string;
  role: string;
  action: string;
  resource: string;
  resource_id: string;
  detail: unknown;
  ip_address: string;
};

type AuditResponse = {
  items: AuditEntry[];
  total: number;
};

export default function AuditLog() {
  const [username, setUsername] = useState("");
  const [action, setAction] = useState("");
  const [appliedUsername, setAppliedUsername] = useState("");
  const [appliedAction, setAppliedAction] = useState("");
  const [page, setPage] = useState(0);
  const limit = 100;

  const q = useQuery<AuditResponse>({
    queryKey: ["audit-log", appliedUsername, appliedAction, page],
    queryFn: async () => {
      const params: Record<string, any> = { limit, offset: page * limit };
      if (appliedUsername) params.username = appliedUsername;
      if (appliedAction) params.action = appliedAction;
      return (await api.get("/api/audit-log", { params })).data;
    },
  });

  function handleSearch() {
    setAppliedUsername(username);
    setAppliedAction(action);
    setPage(0);
  }

  const maxPage = Math.max(0, Math.ceil((q.data?.total ?? 0) / limit) - 1);

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
          ADMIN
        </div>
        <h1 className="text-2xl font-semibold text-slate-900">Audit Log</h1>
        <p className="text-sm text-slate-500">
          Complete history of admin actions
        </p>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-4 flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Filter by username…"
            className="border border-slate-300 rounded px-2 py-1 text-sm min-w-[180px]"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">Action</label>
          <input
            value={action}
            onChange={(e) => setAction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSearch()}
            placeholder="Filter by action…"
            className="border border-slate-300 rounded px-2 py-1 text-sm min-w-[180px]"
          />
        </div>
        <button
          onClick={handleSearch}
          className="px-4 py-1.5 bg-teal-600 text-white text-sm font-medium rounded hover:bg-teal-700 transition-colors"
        >
          Search
        </button>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Time</th>
              <th className="px-4 py-2 text-left">User</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">Action</th>
              <th className="px-4 py-2 text-left">Resource</th>
              <th className="px-4 py-2 text-left">Resource ID</th>
              <th className="px-4 py-2 text-left">Detail</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  Loading…
                </td>
              </tr>
            )}
            {q.data?.items.map((entry) => (
              <tr
                key={entry.id}
                className="border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-4 py-2 text-xs text-slate-600 whitespace-nowrap">
                  {datetime(entry.ts)}
                </td>
                <td className="px-4 py-2 font-medium">{entry.username}</td>
                <td className="px-4 py-2">
                  <RoleBadge role={entry.role} />
                </td>
                <td className="px-4 py-2 font-mono text-xs">{entry.action}</td>
                <td className="px-4 py-2">{entry.resource}</td>
                <td className="px-4 py-2 font-mono text-xs text-slate-600">
                  {entry.resource_id}
                </td>
                <td className="px-4 py-2">
                  <DetailCell detail={entry.detail} />
                </td>
              </tr>
            ))}
            {!q.isLoading && q.data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-400">
                  No audit entries found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-between items-center text-sm">
        <div className="text-slate-500">
          Page {page + 1} of {maxPage + 1}
          {q.data && (
            <span className="ml-2 text-slate-400">
              ({q.data.total} total entries)
            </span>
          )}
        </div>
        <div className="space-x-2">
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page === 0}
            onClick={() => setPage(page - 1)}
          >
            Prev
          </button>
          <button
            className="px-3 py-1 border rounded disabled:opacity-40"
            disabled={page >= maxPage}
            onClick={() => setPage(page + 1)}
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}

function RoleBadge({ role }: { role: string }) {
  const styles: Record<string, string> = {
    admin: "bg-purple-100 text-purple-800",
    operator: "bg-blue-100 text-blue-800",
    viewer: "bg-slate-100 text-slate-700",
  };
  return (
    <span
      className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${styles[role] ?? "bg-slate-100 text-slate-700"}`}
    >
      {role}
    </span>
  );
}

function DetailCell({ detail }: { detail: unknown }) {
  const [expanded, setExpanded] = useState(false);

  if (detail == null) return <span className="text-slate-400">—</span>;

  const json =
    typeof detail === "string" ? detail : JSON.stringify(detail, null, 2);

  if (json.length < 40) {
    return <code className="text-xs text-slate-600 break-all">{json}</code>;
  }

  return (
    <div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="text-xs text-kamuit-500 hover:underline"
      >
        {expanded ? "Collapse" : "Expand"}
      </button>
      {expanded && (
        <pre className="mt-1 text-xs text-slate-600 bg-slate-50 rounded p-2 max-h-48 overflow-auto whitespace-pre-wrap">
          {json}
        </pre>
      )}
    </div>
  );
}

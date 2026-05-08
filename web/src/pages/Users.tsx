import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { datetime, shortId } from "../lib/format";
import StatusBadge from "../components/StatusBadge";

export default function Users() {
  const [role, setRole] = useState("");
  const [provider, setProvider] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const limit = 50;

  const q = useQuery({
    queryKey: ["users", role, provider, search, page],
    queryFn: async () => {
      const params: Record<string, any> = { limit, offset: page * limit };
      if (role) params.role = role;
      if (provider) params.auth_provider = provider;
      if (search) params.search = search;
      return (await api.get("/api/users/", { params })).data;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Users</h1>
          <p className="text-sm text-slate-500">All users across roles.</p>
        </div>
        <div className="text-sm text-slate-500">
          {q.data ? `${q.data.total} total` : "…"}
        </div>
      </div>

      <div className="kpi-card flex flex-wrap gap-3">
        <select
          value={role} onChange={(e) => { setRole(e.target.value); setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          <option value="">All roles</option>
          <option value="driver">Driver</option>
          <option value="passenger">Passenger</option>
          <option value="admin">Admin</option>
        </select>
        <select
          value={provider} onChange={(e) => { setProvider(e.target.value); setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1 text-sm"
        >
          <option value="">All providers</option>
          <option value="email">Email</option>
          <option value="google">Google</option>
          <option value="apple">Apple</option>
        </select>
        <input
          placeholder="Search name / email / phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setPage(0); }}
          className="border border-slate-300 rounded px-2 py-1 text-sm flex-1 min-w-[200px]"
        />
      </div>

      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Name</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">Email</th>
              <th className="px-4 py-2 text-left">Phone</th>
              <th className="px-4 py-2 text-left">Provider</th>
              <th className="px-4 py-2 text-left">Verified</th>
              <th className="px-4 py-2 text-left">Joined</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-slate-500">Loading…</td></tr>
            )}
            {q.data?.items.map((u: any) => (
              <tr key={u.id} className="border-t border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-2 font-mono text-xs text-slate-600">
                  <Link to={`/users/${u.id}`} className="text-blue-600 hover:underline">
                    {shortId(u.id)}
                  </Link>
                </td>
                <td className="px-4 py-2">{u.full_name}</td>
                <td className="px-4 py-2"><StatusBadge value={u.role} /></td>
                <td className="px-4 py-2 text-slate-600">{u.email ?? "—"}</td>
                <td className="px-4 py-2 text-slate-600">{u.phone_number ?? "—"}</td>
                <td className="px-4 py-2">{u.auth_provider}</td>
                <td className="px-4 py-2 text-xs">
                  <span className={u.is_email_verified ? "text-emerald-700" : "text-slate-400"}>✉</span>{" "}
                  <span className={u.is_phone_verified ? "text-emerald-700" : "text-slate-400"}>☎</span>
                </td>
                <td className="px-4 py-2 text-slate-600">{datetime(u.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Pagination page={page} setPage={setPage} total={q.data?.total ?? 0} limit={limit} />
    </div>
  );
}

function Pagination({ page, setPage, total, limit }: { page: number; setPage: (n: number) => void; total: number; limit: number }) {
  const max = Math.max(0, Math.ceil(total / limit) - 1);
  return (
    <div className="flex justify-between items-center text-sm">
      <div className="text-slate-500">
        Page {page + 1} of {max + 1}
      </div>
      <div className="space-x-2">
        <button className="px-3 py-1 border rounded disabled:opacity-40" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
        <button className="px-3 py-1 border rounded disabled:opacity-40" disabled={page >= max} onClick={() => setPage(page + 1)}>Next</button>
      </div>
    </div>
  );
}

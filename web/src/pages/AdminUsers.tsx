import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { datetime } from "../lib/format";

type AdminUser = {
  id: string;
  username: string;
  role: string;
  is_active: boolean;
  created_at: string;
  last_login: string | null;
};

const ROLES = ["viewer", "operator", "admin"] as const;
type Role = (typeof ROLES)[number];

const ROLE_BADGE: Record<string, string> = {
  admin: "bg-purple-100 text-purple-800",
  operator: "bg-blue-100 text-blue-800",
  viewer: "bg-slate-100 text-slate-700",
};

export default function AdminUsers() {
  const queryClient = useQueryClient();
  const [showCreateForm, setShowCreateForm] = useState(false);

  const q = useQuery<AdminUser[]>({
    queryKey: ["admin-users"],
    queryFn: async () => (await api.get("/api/admin-users")).data,
  });

  const createMutation = useMutation({
    mutationFn: (body: { username: string; password: string; role: string }) =>
      api.post("/api/admin-users", body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-users"] });
      setShowCreateForm(false);
    },
  });

  const patchMutation = useMutation({
    mutationFn: ({
      id,
      ...body
    }: {
      id: string;
      role?: string;
      password?: string;
      is_active?: boolean;
    }) => api.patch(`/api/admin-users/${id}`, body),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/api/admin-users/${id}`),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ["admin-users"] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase tracking-widest text-kamuit-500">
            ADMIN
          </div>
          <h1 className="text-2xl font-semibold text-slate-900">
            User Management
          </h1>
          <p className="text-sm text-slate-500">
            Manage admin accounts and roles
          </p>
        </div>
        <button
          onClick={() => setShowCreateForm(true)}
          className="px-4 py-1.5 bg-teal-600 text-white text-sm font-medium rounded hover:bg-teal-700 transition-colors"
        >
          Add User
        </button>
      </div>

      {showCreateForm && (
        <CreateUserForm
          isPending={createMutation.isPending}
          error={createMutation.error}
          onSubmit={(data) => createMutation.mutate(data)}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
            <tr>
              <th className="px-4 py-2 text-left">Username</th>
              <th className="px-4 py-2 text-left">Role</th>
              <th className="px-4 py-2 text-left">Active</th>
              <th className="px-4 py-2 text-left">Created</th>
              <th className="px-4 py-2 text-left">Last Login</th>
              <th className="px-4 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {q.isLoading && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-slate-500"
                >
                  Loading…
                </td>
              </tr>
            )}
            {q.data?.map((user) => (
              <tr
                key={user.id}
                className="border-t border-slate-100 hover:bg-slate-50"
              >
                <td className="px-4 py-2 font-medium">{user.username}</td>
                <td className="px-4 py-2">
                  <RoleDropdown
                    current={user.role}
                    disabled={patchMutation.isPending}
                    onChange={(role) =>
                      patchMutation.mutate({ id: user.id, role })
                    }
                  />
                </td>
                <td className="px-4 py-2">
                  <button
                    onClick={() =>
                      patchMutation.mutate({
                        id: user.id,
                        is_active: !user.is_active,
                      })
                    }
                    disabled={patchMutation.isPending}
                    className="flex items-center gap-1.5 text-xs disabled:opacity-50"
                    title={user.is_active ? "Deactivate" : "Activate"}
                  >
                    <span
                      className={`inline-block h-2.5 w-2.5 rounded-full ${user.is_active ? "bg-kamuit-500" : "bg-red-400"}`}
                    />
                    {user.is_active ? "Yes" : "No"}
                  </button>
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {datetime(user.created_at)}
                </td>
                <td className="px-4 py-2 text-slate-600">
                  {datetime(user.last_login)}
                </td>
                <td className="px-4 py-2 text-right">
                  <button
                    onClick={() => {
                      if (
                        window.confirm(
                          `Delete user "${user.username}"? This cannot be undone.`,
                        )
                      )
                        deleteMutation.mutate(user.id);
                    }}
                    disabled={deleteMutation.isPending}
                    className="text-xs text-red-600 hover:text-red-800 disabled:opacity-50"
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {!q.isLoading && q.data?.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-6 text-center text-slate-400"
                >
                  No admin users found.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RoleDropdown({
  current,
  disabled,
  onChange,
}: {
  current: string;
  disabled: boolean;
  onChange: (role: string) => void;
}) {
  return (
    <select
      value={current}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`px-2 py-0.5 rounded-full text-xs font-medium border-0 cursor-pointer ${ROLE_BADGE[current] ?? ROLE_BADGE.viewer}`}
    >
      {ROLES.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}

function CreateUserForm({
  isPending,
  error,
  onSubmit,
  onCancel,
}: {
  isPending: boolean;
  error: unknown;
  onSubmit: (data: { username: string; password: string; role: string }) => void;
  onCancel: () => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("viewer");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password.trim()) return;
    onSubmit({ username: username.trim(), password, role });
  }

  return (
    <div className="bg-white border border-slate-200 rounded-xl shadow-sm p-5">
      <h2 className="text-sm font-semibold text-slate-900 mb-3">
        Create Admin User
      </h2>
      <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">
            Username
          </label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            className="border border-slate-300 rounded px-2 py-1 text-sm min-w-[180px]"
            placeholder="e.g. jane.ops"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">
            Password
          </label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className="border border-slate-300 rounded px-2 py-1 text-sm min-w-[180px]"
            placeholder="Strong password"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-slate-600">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="border border-slate-300 rounded px-2 py-1 text-sm"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            disabled={isPending}
            className="px-4 py-1.5 bg-teal-600 text-white text-sm font-medium rounded hover:bg-teal-700 transition-colors disabled:opacity-50"
          >
            {isPending ? "Creating…" : "Create"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-1.5 border border-slate-300 text-sm rounded hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
        </div>
      </form>
      {error ? (
        <p className="mt-2 text-xs text-red-600">
          {String((error as any)?.response?.data?.detail ??
            (error as any)?.message ??
            "Failed to create user.")}
        </p>
      ) : null}
    </div>
  );
}

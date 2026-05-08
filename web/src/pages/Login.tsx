import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";

export default function Login() {
  const { login, token } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("admin");
  const [password, setPassword] = useState("admin");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (token) {
    navigate("/", { replace: true });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    try {
      await login(username, password);
      navigate("/", { replace: true });
    } catch (ex: any) {
      setErr(ex?.response?.data?.detail ?? "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-100">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-sm bg-white rounded-xl border border-slate-200 p-6 shadow"
      >
        <div className="mb-5">
          <div className="text-xl font-semibold text-slate-900">Kamuit Admin</div>
          <div className="text-sm text-slate-500">Sign in to continue</div>
        </div>
        <label className="block text-sm font-medium text-slate-700 mb-1">Username</label>
        <input
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-3 focus:outline-none focus:ring-2 focus:ring-slate-900"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoFocus
        />
        <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
        <input
          type="password"
          className="w-full border border-slate-300 rounded-lg px-3 py-2 mb-4 focus:outline-none focus:ring-2 focus:ring-slate-900"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        {err && <div className="mb-3 text-sm text-rose-600">{err}</div>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-slate-900 text-white rounded-lg py-2 font-medium hover:bg-slate-800 disabled:opacity-60"
        >
          {loading ? "Signing in…" : "Sign in"}
        </button>
        <div className="mt-4 text-xs text-slate-500">
          Local dev only. Default creds: <code>admin / admin</code> (override in <code>.env</code>).
        </div>
      </form>
    </div>
  );
}

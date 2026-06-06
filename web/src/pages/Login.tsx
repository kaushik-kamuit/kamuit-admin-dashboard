import { FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";
import Lottie from "lottie-react";
import { useAuth } from "../hooks/useAuth";
import { KamuitLogo } from "../components/KamuitLogo";
import welcomeAnimation from "../assets/animations/kamuit-welcome.json";

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
    <div className="min-h-screen flex">
      {/* Left: brand panel */}
      <div className="hidden lg:flex lg:w-[480px] xl:w-[560px] bg-[#0f1117] flex-col items-center justify-center relative overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]" style={{
          backgroundImage: `radial-gradient(circle at 30% 40%, #0BA26D 0%, transparent 50%),
                            radial-gradient(circle at 70% 70%, #059669 0%, transparent 45%)`
        }} />
        <div className="relative z-10 flex flex-col items-center px-12">
          <Lottie animationData={welcomeAnimation} loop className="w-48 h-48 mb-4" />
          <KamuitLogo className="text-white mb-6" size="lg" />
          <p className="text-kamuit-400 text-sm font-medium tracking-wide">
            Getting there, together.
          </p>
          <div className="mt-8 px-6 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <p className="text-slate-500 text-xs leading-5 text-center max-w-64">
              Operations console for driver onboarding, ride flow, payments, and real-time fleet intelligence.
            </p>
          </div>
        </div>
      </div>

      {/* Right: login form */}
      <div className="flex-1 flex items-center justify-center bg-[#f4f6f5] px-6">
        <form onSubmit={onSubmit} className="w-full max-w-sm">
          <div className="lg:hidden flex flex-col items-center mb-8">
            <KamuitLogo className="text-slate-900 mb-2" size="md" />
            <p className="text-kamuit-500 text-xs font-medium tracking-wide">
              Getting there, together.
            </p>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200/80 p-8 shadow-xl shadow-slate-200/50">
            <div className="mb-6">
              <h1 className="text-xl font-bold text-slate-900">Welcome back</h1>
              <p className="text-sm text-slate-500 mt-1">Sign in to the operations console</p>
            </div>

            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
              Username
            </label>
            <input
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-kamuit-500/30 focus:border-kamuit-500 transition-shadow"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
            />

            <label className="block text-xs font-semibold uppercase tracking-wider text-slate-500 mb-1.5 mt-4">
              Password
            </label>
            <input
              type="password"
              className="w-full border border-slate-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-kamuit-500/30 focus:border-kamuit-500 transition-shadow"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />

            {err && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-sm text-rose-600">
                {err}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="mt-6 w-full bg-kamuit-500 text-white rounded-xl py-2.5 font-semibold hover:bg-kamuit-600 disabled:opacity-60 transition-colors shadow-sm shadow-kamuit-500/20"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </div>

          <p className="mt-4 text-center text-[11px] text-slate-400">
            Local dev &middot; default: <code className="bg-slate-200/60 px-1 py-0.5 rounded text-[10px]">admin / admin</code>
          </p>
        </form>
      </div>
    </div>
  );
}

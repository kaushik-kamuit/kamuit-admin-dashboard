import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import clsx from "clsx";

const nav = [
  { to: "/", label: "Overview" },
  { to: "/users", label: "Users" },
  { to: "/drivers", label: "Drivers" },
  { to: "/rides", label: "Rides" },
  { to: "/driver-runs", label: "Driver Runs" },
  { to: "/heatmap", label: "Heatmap" },
  { to: "/sessions", label: "Online Sessions" },
  { to: "/funnel", label: "Pref Funnel" },
  { to: "/matching", label: "Matching" },
  { to: "/payments", label: "Payments" },
  { to: "/recon", label: "Reconciliation" },
];

export default function Layout() {
  const { username, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-full flex">
      <aside className="w-56 bg-slate-900 text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-slate-800">
          <Link to="/" className="block">
            <div className="text-lg font-semibold">Kamuit</div>
            <div className="text-xs text-slate-400">Admin Console</div>
          </Link>
        </div>
        <nav className="flex-1 py-4 px-2 space-y-1">
          {nav.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.to === "/"}
              className={({ isActive }) =>
                clsx(
                  "block px-3 py-2 rounded text-sm font-medium transition-colors",
                  isActive
                    ? "bg-slate-800 text-white"
                    : "text-slate-300 hover:bg-slate-800/60",
                )
              }
            >
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="px-4 py-3 border-t border-slate-800 text-xs text-slate-400">
          <div>Logged in: <span className="text-slate-200">{username ?? "-"}</span></div>
          <button
            className="mt-2 w-full text-left text-slate-300 hover:text-white"
            onClick={() => {
              logout();
              navigate("/login");
            }}
          >
            Log out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 bg-slate-50">
        <div className="p-6 max-w-[1400px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

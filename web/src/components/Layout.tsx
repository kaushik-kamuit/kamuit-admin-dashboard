import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../hooks/useAuth";
import { KamuitMark } from "./KamuitLogo";
import clsx from "clsx";

const navGroups = [
  {
    label: "Operate",
    items: [
      { to: "/", label: "Command Center" },
      { to: "/live-map", label: "Live Map" },
      { to: "/alerts", label: "Alerts" },
      { to: "/explorer", label: "Explorer" },
      { to: "/query", label: "Query Studio" },
      { to: "/vehicle-review", label: "Vehicle Review" },
      { to: "/drivers", label: "Driver Review" },
      { to: "/rides", label: "Rides" },
      { to: "/driver-runs", label: "Trip Watch" },
      { to: "/payments", label: "Payments" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/trends", label: "Trends" },
      { to: "/cancellations", label: "Cancellations" },
      { to: "/eta-accuracy", label: "ETA Accuracy" },
      { to: "/churn", label: "Churn Risk" },
      { to: "/fraud", label: "Fraud Detection" },
      { to: "/heatmap", label: "Heatmap" },
      { to: "/sessions", label: "Online Sessions" },
      { to: "/matching", label: "Matching" },
      { to: "/funnel", label: "Pref Funnel" },
      { to: "/recon", label: "Reconciliation" },
      { to: "/notifications", label: "Notifications" },
    ],
  },
  {
    label: "Directory",
    items: [
      { to: "/users", label: "Users" },
      { to: "/legacy-overview", label: "Legacy Overview" },
    ],
  },
  {
    label: "Admin",
    adminOnly: true,
    items: [
      { to: "/audit-log", label: "Audit Log" },
      { to: "/admin-users", label: "User Management" },
      { to: "/stripe-events", label: "Stripe Events" },
      { to: "/data-export", label: "Data Export" },
    ],
  },
];

export default function Layout() {
  const { username, role, logout, isAdmin } = useAuth();
  const navigate = useNavigate();

  const roleBadgeColor =
    role === "admin" ? "bg-kamuit-500" : role === "operator" ? "bg-blue-500" : "bg-slate-500";

  return (
    <div className="min-h-full flex">
      <aside className="w-64 bg-surface-sidebar text-slate-100 flex flex-col">
        <div className="px-5 py-5 border-b border-white/10">
          <Link to="/" className="flex items-center gap-3">
            <KamuitMark className="text-brand-green" size={28} />
            <div>
              <div className="text-base font-semibold tracking-tight">Kamuit</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.16em] text-kamuit-400">
                Operations Console
              </div>
            </div>
          </Link>
        </div>
        <nav className="flex-1 py-4 px-3 space-y-5 overflow-y-auto">
          {navGroups
            .filter((g) => !g.adminOnly || isAdmin)
            .map((group) => (
              <div key={group.label}>
                <div className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                  {group.label}
                </div>
                <div className="space-y-0.5">
                  {group.items.map((n) => (
                    <NavLink
                      key={n.to}
                      to={n.to}
                      end={n.to === "/"}
                      className={({ isActive }) =>
                        clsx(
                          "block px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150",
                          isActive
                            ? "bg-kamuit-500 text-white shadow-sm shadow-kamuit-500/25"
                            : "text-slate-400 hover:bg-white/[0.06] hover:text-slate-200",
                        )
                      }
                    >
                      {n.label}
                    </NavLink>
                  ))}
                </div>
              </div>
            ))}
        </nav>
        <div className="px-4 py-4 border-t border-white/10">
          <div className="flex items-center gap-2 text-xs text-slate-400">
            <div className="w-7 h-7 rounded-full bg-kamuit-500/20 grid place-items-center text-kamuit-400 text-[11px] font-bold">
              {username?.charAt(0).toUpperCase() ?? "?"}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-slate-200 font-medium truncate">{username ?? "-"}</div>
              {role && (
                <span className={clsx("px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider text-white", roleBadgeColor)}>
                  {role}
                </span>
              )}
            </div>
          </div>
          <button
            className="mt-3 w-full text-left text-xs text-slate-500 hover:text-kamuit-400 transition-colors"
            onClick={() => { logout(); navigate("/login"); }}
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 min-w-0 bg-surface">
        <div className="p-6 max-w-[1500px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

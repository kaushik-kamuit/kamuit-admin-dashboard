import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { api } from "../api/client";

const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
const IDLE_EVENTS = ["mousedown", "keydown", "scroll", "touchstart"] as const;

type AuthCtx = {
  token: string | null;
  username: string | null;
  role: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
  isAdmin: boolean;
  isOperator: boolean;
};

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("kamuit_admin_token"));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem("kamuit_admin_user"));
  const [role, setRole] = useState<string | null>(() => localStorage.getItem("kamuit_admin_role"));
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const doLogout = useCallback(() => {
    localStorage.removeItem("kamuit_admin_token");
    localStorage.removeItem("kamuit_admin_user");
    localStorage.removeItem("kamuit_admin_role");
    setToken(null);
    setUsername(null);
    setRole(null);
  }, []);

  useEffect(() => {
    if (!token) return;

    function resetIdleTimer() {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      idleTimer.current = setTimeout(() => {
        doLogout();
        if (!location.pathname.startsWith("/login")) {
          location.href = "/login?reason=idle";
        }
      }, IDLE_TIMEOUT_MS);
    }

    resetIdleTimer();
    for (const evt of IDLE_EVENTS) {
      window.addEventListener(evt, resetIdleTimer, { passive: true });
    }
    return () => {
      if (idleTimer.current) clearTimeout(idleTimer.current);
      for (const evt of IDLE_EVENTS) {
        window.removeEventListener(evt, resetIdleTimer);
      }
    };
  }, [token, doLogout]);

  useEffect(() => {
    if (!token) return;

    try {
      const payload = JSON.parse(atob(token.split(".")[1]));
      const expMs = payload.exp * 1000;
      const msUntilExpiry = expMs - Date.now();
      if (msUntilExpiry <= 0) {
        doLogout();
        return;
      }
      const t = setTimeout(doLogout, msUntilExpiry);
      return () => clearTimeout(t);
    } catch {
      doLogout();
    }
  }, [token, doLogout]);

  useEffect(() => {
    if (token && !username) {
      api.get("/api/auth/me").then((r) => {
        setUsername(r.data.username);
        setRole(r.data.role ?? "admin");
        localStorage.setItem("kamuit_admin_user", r.data.username);
        localStorage.setItem("kamuit_admin_role", r.data.role ?? "admin");
      }).catch(() => {
        doLogout();
      });
    }
  }, [token, username, doLogout]);

  const value = useMemo<AuthCtx>(() => ({
    token,
    username,
    role,
    isAdmin: role === "admin",
    isOperator: role === "admin" || role === "operator",
    async login(u, p) {
      const res = await api.post("/api/auth/login", { username: u, password: p });
      const tkn = res.data.access_token as string;
      try {
        const payload = JSON.parse(atob(tkn.split(".")[1]));
        const r = payload.role ?? "admin";
        setRole(r);
        localStorage.setItem("kamuit_admin_role", r);
      } catch {
        setRole("admin");
        localStorage.setItem("kamuit_admin_role", "admin");
      }
      localStorage.setItem("kamuit_admin_token", tkn);
      localStorage.setItem("kamuit_admin_user", u);
      setToken(tkn);
      setUsername(u);
    },
    logout: doLogout,
  }), [token, username, role, doLogout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}

import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { api } from "../api/client";

type AuthCtx = {
  token: string | null;
  username: string | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
};

const Ctx = createContext<AuthCtx>(null as unknown as AuthCtx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("kamuit_admin_token"));
  const [username, setUsername] = useState<string | null>(() => localStorage.getItem("kamuit_admin_user"));

  useEffect(() => {
    if (token && !username) {
      api.get("/api/auth/me").then((r) => {
        setUsername(r.data.username);
        localStorage.setItem("kamuit_admin_user", r.data.username);
      }).catch(() => {
        setToken(null);
        localStorage.removeItem("kamuit_admin_token");
      });
    }
  }, [token, username]);

  const value = useMemo<AuthCtx>(() => ({
    token,
    username,
    async login(u, p) {
      const res = await api.post("/api/auth/login", { username: u, password: p });
      const tkn = res.data.access_token as string;
      localStorage.setItem("kamuit_admin_token", tkn);
      localStorage.setItem("kamuit_admin_user", u);
      setToken(tkn);
      setUsername(u);
    },
    logout() {
      localStorage.removeItem("kamuit_admin_token");
      localStorage.removeItem("kamuit_admin_user");
      setToken(null);
      setUsername(null);
    },
  }), [token, username]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  return useContext(Ctx);
}

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { api, auth as tokens } from "./api";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, fullName: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    }
  }, []);

  // A stored refresh token is enough to re-establish a session on reload; the
  // API client exchanges it transparently on the first 401.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tokens.refresh) {
        if (!cancelled) setLoading(false);
        return;
      }
      await refreshUser();
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refreshUser]);

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    setUser,
    refreshUser,
    login: async (email, password) => {
      const pair = await api.login(email, password);
      tokens.set(pair.access_token, pair.refresh_token);
      setUser(await api.me());
    },
    register: async (email, fullName, password) => {
      const pair = await api.register(email, fullName, password);
      tokens.set(pair.access_token, pair.refresh_token);
      setUser(await api.me());
    },
    logout: async () => {
      await api.logout();
      setUser(null);
    },
  }), [user, loading, refreshUser]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

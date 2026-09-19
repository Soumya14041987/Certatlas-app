import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from "react";
import { api } from "./api";
import { supabase } from "./supabaseClient";
import type { User } from "./types";

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, fullName: string, password: string) => Promise<{ needsEmailConfirmation: boolean }>;
  loginWithProvider: (provider: "google" | "github") => Promise<void>;
  logout: () => Promise<void>;
  logoutEverywhere: () => Promise<void>;
  refreshUser: () => Promise<void>;
  setUser: (user: User) => void;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  // role/full_name/target_exam_date live in public.profiles, not on
  // Supabase's own auth user object, so a Supabase session alone isn't
  // enough — this app's own /auth/me is still the source of truth for them.
  const refreshUser = useCallback(async () => {
    try {
      setUser(await api.me());
    } catch {
      setUser(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (cancelled) return;
      if (session) await refreshUser();
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (cancelled) return;
      if (session) await refreshUser();
      else setUser(null);
    });

    return () => {
      cancelled = true;
      subscription.subscription.unsubscribe();
    };
  }, [refreshUser]);

  const value = useMemo<AuthState>(() => ({
    user,
    loading,
    setUser,
    refreshUser,
    login: async (email, password) => {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw new Error(error.message);
      await refreshUser();
    },
    register: async (email, fullName, password) => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) throw new Error(error.message);
      // If the project requires email confirmation, signUp returns no
      // session yet — there's nothing to load /auth/me with until the
      // learner clicks the link Supabase just emailed them.
      if (!data.session) return { needsEmailConfirmation: true };
      await refreshUser();
      return { needsEmailConfirmation: false };
    },
    loginWithProvider: async (provider) => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: window.location.origin },
      });
      if (error) throw new Error(error.message);
    },
    logout: async () => {
      await supabase.auth.signOut();
      setUser(null);
    },
    logoutEverywhere: async () => {
      await supabase.auth.signOut({ scope: "global" });
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

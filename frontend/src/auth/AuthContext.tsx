import { useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { api, setToken } from "../api/client";
import { useMe } from "../api/hooks";
import type { Viewer } from "../api/types";
import { rememberShareBase } from "../lib/share";

export interface SignupInput {
  email: string;
  password: string;
  display_name: string;
  church?: string;
}

export interface ProfileInput {
  display_name?: string;
  church?: string | null;
  current_password?: string;
  new_password?: string;
}

interface AuthState {
  viewer: Viewer | undefined;
  loading: boolean;
  isEditor: boolean;
  /** Personal mode: no sign-in on this computer; the owner account has full access. */
  singleUser: boolean;
  login: (email: string, password: string) => Promise<void>;
  signup: (input: SignupInput) => Promise<void>;
  updateProfile: (input: ProfileInput) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const me = useMe();
  rememberShareBase(me.data);
  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api<{ token: string }>("/v1/auth/login", { method: "POST", body: { email, password } });
      setToken(res.token);
      await qc.invalidateQueries();
    },
    [qc],
  );
  const signup = useCallback(
    async (input: SignupInput) => {
      const res = await api<{ token: string }>("/v1/auth/signup", { method: "POST", body: input });
      setToken(res.token);
      await qc.invalidateQueries();
    },
    [qc],
  );
  const updateProfile = useCallback(
    async (input: ProfileInput) => {
      await api("/v1/auth/me", { method: "PATCH", body: input });
      await qc.invalidateQueries({ queryKey: ["me"] });
    },
    [qc],
  );
  const logout = useCallback(async () => {
    await api("/v1/auth/logout", { method: "POST" }).catch(() => undefined);
    setToken(null);
    qc.clear();
    await qc.invalidateQueries();
  }, [qc]);
  const value = useMemo<AuthState>(
    () => ({
      viewer: me.data,
      loading: me.isLoading,
      isEditor: me.data?.role === "editor" || me.data?.role === "admin",
      singleUser: me.data?.auth_mode === "single_user",
      login,
      signup,
      updateProfile,
      logout,
    }),
    [me.data, me.isLoading, login, signup, updateProfile, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("AuthProvider missing");
  return ctx;
}

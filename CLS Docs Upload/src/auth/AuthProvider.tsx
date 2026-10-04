import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { currentSession, login as loginRequest, logout as logoutRequest } from "../api/auth";
import { setUnauthorizedHandler } from "../api/client";
import { session } from "./session";
import { User } from "../types";

type AuthValue = { user: User | null; loading: boolean; signIn: (email: string, password: string) => Promise<void>; signOut: () => Promise<void> };
const AuthContext = createContext<AuthValue>(null as any);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const clear = useCallback(async () => { await session.clear(); setUser(null); }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => { void clear(); });
    (async () => {
      const [token, stored] = await Promise.all([session.getToken(), session.getUser()]);
      if (token && stored?.role === "finance-desk") {
        setUser(stored);
        try {
          const refreshed = await currentSession();
          if (refreshed.role !== "finance-desk") await clear();
          else { await session.set(token, refreshed); setUser(refreshed); }
        } catch { /* preserve the secure session during temporary network failure */ }
      }
      setLoading(false);
    })();
  }, [clear]);

  const signIn = async (email: string, password: string) => {
    const result = await loginRequest(email, password);
    if (!result.token || result.user.role !== "finance-desk") throw new Error("You are not authorized to use the Finance Desk app.");
    await session.set(result.token, result.user);
    setUser(result.user);
  };
  const signOut = async () => { await logoutRequest(); await clear(); };
  return <AuthContext.Provider value={{ user, loading, signIn, signOut }}>{children}</AuthContext.Provider>;
}
export const useAuth = () => useContext(AuthContext);

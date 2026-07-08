"use client";

/**
 * Client-side auth/session context.
 *
 * Authentication is checked against the users table via lib/db. The session is
 * persisted as a flag (the logged-in email) in storage, and the User object is
 * held in memory. This is deliberately isolated so it can move to real auth
 * (e.g. NextAuth / Firebase Auth) without changing consumers.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { DeviceSession, User } from "@/lib/types";
import {
  clearSession,
  ensureSeed,
  findUserByEmail,
  getUsers,
  readSessionEmail,
  saveUsers,
  writeSessionEmail,
} from "@/lib/db";
import { deviceLabel, getDeviceId } from "@/lib/device";

/**
 * Record this browser as a signed-in (or signed-out) device on the user's
 * account, so the Admin can see where each account is active. Notifies the
 * DataProvider so its in-memory copy stays fresh.
 */
async function recordDevice(
  email: string,
  signedIn: boolean
): Promise<User | undefined> {
  const now = new Date().toISOString();
  const id = getDeviceId();
  const users = await getUsers();
  let updated: User | undefined;
  const next = users.map((u) => {
    if (u.email !== email) return u;
    const devices: DeviceSession[] = (u.devices ?? []).filter((d) => d.id !== id);
    const existing = (u.devices ?? []).find((d) => d.id === id);
    devices.push({
      id,
      label: deviceLabel(),
      firstSeen: existing?.firstSeen ?? now,
      lastSeen: now,
      signedIn,
    });
    updated = { ...u, devices };
    return updated;
  });
  await saveUsers(next);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ncgr:db-updated"));
  }
  return updated;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  /** Re-read the current user from storage (after Admin edits their record). */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureSeed();
      const email = readSessionEmail();
      if (email) {
        const u = await findUserByEmail(email);
        if (!cancelled && u && u.active) setUser(u);
        else clearSession();
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const u = await findUserByEmail(email);
      if (!u) return { ok: false, error: "No account with that email." };
      if (!u.active) return { ok: false, error: "This account is deactivated." };
      if (u.password !== password) return { ok: false, error: "Wrong password." };
      writeSessionEmail(u.email);
      const updated = await recordDevice(u.email, true);
      setUser(updated ?? u);
      return { ok: true };
    },
    []
  );

  const logout = useCallback(() => {
    if (user) void recordDevice(user.email, false);
    clearSession();
    setUser(null);
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const u = await findUserByEmail(user.email);
    if (u && u.active) setUser(u);
    else logout();
  }, [user, logout]);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

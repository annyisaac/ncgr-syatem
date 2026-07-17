"use client";

/**
 * Authentication via Supabase Auth.
 *
 * Login/logout/session are handled by Supabase (hashed passwords, JWT session
 * persisted by the browser client). The user's profile (role, zone, name,
 * avatar, devices, pending password request) lives in the public.users table,
 * loaded after the session is established.
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
import { findUserByEmail, saveUser } from "@/lib/db";
import { getSupabase } from "@/lib/supabase";
import { deviceLabel, getDeviceId } from "@/lib/device";

/**
 * Record this browser as a signed-in / signed-out device on the user's profile
 * so the Admin can see where each account is active. Targeted single-row update
 * (does not touch other users) so it stays fast.
 */
async function recordDevice(email: string, signedIn: boolean): Promise<void> {
  const now = new Date().toISOString();
  const id = getDeviceId();
  const u = await findUserByEmail(email);
  if (!u) return;
  const devices: DeviceSession[] = (u.devices ?? []).filter((d) => d.id !== id);
  const existing = (u.devices ?? []).find((d) => d.id === id);
  devices.push({
    id,
    label: deviceLabel(),
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    signedIn,
  });
  await saveUser({ ...u, devices });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("ncgr:db-updated"));
  }
}

const REMEMBER_KEY = "ncgr.remember.v1";
const ALIVE_KEY = "ncgr.session-alive.v1";

/**
 * "Remember me", for real.
 *
 * Supabase persists the session in storage that survives closing the browser,
 * so unchecking the box has to be enforced by us. Each browser session drops a
 * marker in sessionStorage (which does NOT survive a restart); finding a
 * persisted login with no marker means the browser was closed and reopened, so
 * a not-remembered session gets signed out before it is ever restored.
 */
function shouldDropPersistedSession(): boolean {
  if (typeof window === "undefined") return false;
  if (window.localStorage.getItem(REMEMBER_KEY) !== "0") return false;
  return window.sessionStorage.getItem(ALIVE_KEY) === null;
}

function markSessionAlive(): void {
  if (typeof window !== "undefined") window.sessionStorage.setItem(ALIVE_KEY, "1");
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
    remember?: boolean
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => Promise<void>;
  /** Re-read the current user's profile from storage. */
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (email: string): Promise<User | null> => {
    const profile = await findUserByEmail(email);
    return profile ?? null;
  }, []);

  // Restore an existing session on load, and clear on external sign-out.
  useEffect(() => {
    const sb = getSupabase();
    let active = true;
    (async () => {
      // A session the user asked us not to remember, in a reopened browser.
      if (shouldDropPersistedSession()) {
        await sb.auth.signOut();
        markSessionAlive();
        if (active) {
          setUser(null);
          setLoading(false);
        }
        return;
      }
      markSessionAlive();

      const { data } = await sb.auth.getSession();
      const email = data.session?.user?.email;
      if (email) {
        const profile = await loadProfile(email);
        if (profile && !profile.active) {
          await sb.auth.signOut();
          if (active) setUser(null);
        } else if (active) {
          setUser(profile);
        }
      }
      if (active) setLoading(false);
    })();

    const { data: sub } = sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") setUser(null);
    });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const login = useCallback(
    async (email: string, password: string, remember = true) => {
      const sb = getSupabase();
      const { data, error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.user?.email) {
        return { ok: false, error: "Wrong email or password." };
      }
      if (typeof window !== "undefined") {
        window.localStorage.setItem(REMEMBER_KEY, remember ? "1" : "0");
        markSessionAlive();
      }
      const profile = await loadProfile(data.user.email);
      if (!profile) {
        await sb.auth.signOut();
        return { ok: false, error: "No profile exists for this account." };
      }
      if (!profile.active) {
        await sb.auth.signOut();
        return { ok: false, error: "This account is deactivated." };
      }
      setUser(profile);
      // Record the device in the background so login stays fast.
      void recordDevice(profile.email, true);
      return { ok: true };
    },
    [loadProfile]
  );

  const logout = useCallback(async () => {
    if (user) await recordDevice(user.email, false);
    await getSupabase().auth.signOut();
    setUser(null);
  }, [user]);

  const refresh = useCallback(async () => {
    if (!user) return;
    const profile = await loadProfile(user.email);
    if (profile && profile.active) setUser(profile);
    else {
      await getSupabase().auth.signOut();
      setUser(null);
    }
  }, [user, loadProfile]);

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

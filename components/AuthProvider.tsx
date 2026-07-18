"use client";

/**
 * Authentication via Supabase Auth.
 *
 * Login/logout/session are handled by Supabase (hashed passwords, JWT session).
 * The session is stored per browser tab (see lib/supabase.ts), so several
 * accounts can be signed in at once — one per tab. The user's profile (role,
 * zone, name, avatar, devices, pending password request) lives in the
 * public.users table, loaded after the session is established.
 *
 * For safety the session auto-signs-out after 30 minutes with no activity in
 * the tab (mouse, keyboard, touch, scroll).
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

/** Sign the user out after this long with no activity in the tab. */
const IDLE_MS = 30 * 60 * 1000;
/** Per-tab timestamp of the last activity, so a reload after idling logs out. */
const LAST_ACTIVITY_KEY = "ncgr.last-activity.v1";
/** Left on the login screen after an idle sign-out, to explain what happened. */
export const SIGNED_OUT_REASON_KEY = "ncgr.signed-out-reason.v1";

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

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (
    email: string,
    password: string
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

  // Restore this tab's session on load, and clear on external sign-out.
  useEffect(() => {
    const sb = getSupabase();
    let active = true;
    (async () => {
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
    async (email: string, password: string) => {
      const sb = getSupabase();
      const { data, error } = await sb.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (error || !data.user?.email) {
        return { ok: false, error: "Wrong email or password." };
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
      if (typeof window !== "undefined") {
        window.sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
        window.sessionStorage.removeItem(SIGNED_OUT_REASON_KEY);
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

  // Auto sign-out after 30 minutes with no activity in this tab.
  useEffect(() => {
    if (!user || typeof window === "undefined") return;

    const idleSignOut = () => {
      window.sessionStorage.setItem(SIGNED_OUT_REASON_KEY, "idle");
      void logout();
    };

    // Reopened / reloaded after sitting idle past the limit → out immediately.
    const last = Number(window.sessionStorage.getItem(LAST_ACTIVITY_KEY) || 0);
    if (last && Date.now() - last > IDLE_MS) {
      idleSignOut();
      return;
    }

    let timer = window.setTimeout(idleSignOut, IDLE_MS);
    let lastWrite = Date.now();
    const onActivity = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(idleSignOut, IDLE_MS);
      // Persist the activity time at most every 15s to avoid storage churn.
      const now = Date.now();
      if (now - lastWrite > 15_000) {
        lastWrite = now;
        window.sessionStorage.setItem(LAST_ACTIVITY_KEY, String(now));
      }
    };

    const events = ["mousemove", "mousedown", "keydown", "touchstart", "scroll", "click"];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    // Coming back to a tab that idled in the background should re-check at once.
    const onVisible = () => {
      if (document.visibilityState === "visible") onActivity();
    };
    document.addEventListener("visibilitychange", onVisible);

    window.sessionStorage.setItem(LAST_ACTIVITY_KEY, String(Date.now()));
    return () => {
      window.clearTimeout(timer);
      events.forEach((e) => window.removeEventListener(e, onActivity));
      document.removeEventListener("visibilitychange", onVisible);
    };
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

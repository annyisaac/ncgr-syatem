/**
 * Supabase browser client (singleton).
 *
 * Uses the publishable key — safe to expose to the browser. Access is governed
 * by RLS policies keyed off the signed-in user's JWT.
 *
 * Sessions are stored **per browser tab** (sessionStorage), not in a shared
 * cookie. That lets several accounts be signed in at once — one per tab (e.g.
 * Admin in one tab, a checker in another) — without one login clobbering the
 * others. A tab keeps its login across reloads but is signed out when the tab
 * closes.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

const TAB_ID_KEY = "ncgr.tab.v1";

/** A stable id for THIS tab: survives reloads (sessionStorage), unique per tab. */
function currentTabId(): string {
  if (typeof window === "undefined") return "server";
  let id = window.sessionStorage.getItem(TAB_ID_KEY);
  if (!id) {
    id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    window.sessionStorage.setItem(TAB_ID_KEY, id);
  }
  return id;
}

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — check your .env file."
      );
    }
    const browser = typeof window !== "undefined";
    client = createClient(url, key, {
      auth: {
        // Per-tab session storage keeps each tab's login independent.
        persistSession: browser,
        autoRefreshToken: browser,
        detectSessionInUrl: false,
        storage: browser ? window.sessionStorage : undefined,
        // Per-tab storage key also isolates the refresh lock between tabs.
        storageKey: `ncgr-auth-${currentTabId()}`,
      },
    });
  }
  return client;
}

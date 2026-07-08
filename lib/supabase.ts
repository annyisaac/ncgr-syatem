/**
 * Supabase browser client (singleton).
 *
 * Uses the publishable key — safe to expose to the browser. No authentication
 * for now: the database is open via explicit RLS policies, matching the
 * app's current access model.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    if (!url || !key) {
      throw new Error(
        "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY — check your .env file."
      );
    }
    client = createBrowserClient(url, key);
  }
  return client;
}

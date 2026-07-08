/**
 * Client wrappers for the `admin-users` edge function (service-role user
 * management). Only an Admin's session is accepted by the function.
 */

import { getSupabase } from "./supabase";
import type { User } from "./types";

interface InvokeError {
  message: string;
  context?: { json?: () => Promise<{ error?: string }> };
}

async function invokeAdmin(body: Record<string, unknown>): Promise<void> {
  const { data, error } = await getSupabase().functions.invoke("admin-users", {
    body,
  });
  if (error) {
    let msg = (error as InvokeError).message || "Request failed.";
    try {
      const ctx = (error as InvokeError).context;
      const j = ctx?.json ? await ctx.json() : undefined;
      if (j?.error) msg = j.error;
    } catch {
      /* ignore parse errors */
    }
    throw new Error(msg);
  }
  if (data?.error) throw new Error(data.error as string);
}

/** Create a new staff account (auth user + profile). Admin only. */
export async function adminCreateUser(
  email: string,
  password: string,
  profile: User
): Promise<void> {
  await invokeAdmin({ action: "create", email, password, profile });
}

/** Set/reset any user's password. Admin only. */
export async function adminSetPassword(
  email: string,
  password: string
): Promise<void> {
  await invokeAdmin({ action: "setPassword", email, password });
}

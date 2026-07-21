/**
 * Event registration links (e.g. Agrishow). An Admin generates a public link
 * and shares it; visitors open /visit/{token} — no login — and register. The
 * public page reads/writes only through SECURITY DEFINER RPCs granted to anon,
 * so the anon role never touches the tables directly. The Admin reads the full
 * registrations list (RLS: staff only) and downloads it.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";

export interface EventLink {
  id: string; // == token
  token: string;
  event: string; // event name, e.g. "Agrishow 2026"
  by: string; // admin email who created it
  createdAt: string;
  active: boolean;
}

export interface EventRegistration {
  id: string;
  token: string;
  event: string;
  name: string;
  phone: string;
  province?: string;
  district?: string;
  sector?: string;
  category?: string; // customer category (farmer, agrovet, cooperative…)
  products?: string; // products interested in (comma-joined)
  plannedChicks?: number; // planned number of chicks
  purchaseMonth?: string; // expected purchase month, "yyyy-mm"
  contactMethod?: string; // preferred contact method
  consent?: boolean; // consent to receive updates
  on: string; // ISO datetime
}

export interface VisitorInput {
  name: string;
  phone: string;
  province?: string;
  district?: string;
  sector?: string;
  category?: string;
  products?: string;
  plannedChicks?: number;
  purchaseMonth?: string;
  contactMethod?: string;
  consent?: boolean;
}

function newToken(): string {
  const rnd = (globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Math.random()}`).replace(/-/g, "");
  return `ev_${rnd.slice(0, 24)}`;
}

// ---- Admin (authenticated) -----------------------------------------------

export async function listEventLinks(): Promise<EventLink[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from("event_links")
    .select("data")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load event links: ${error.message}`);
  return (data ?? []).map((r) => r.data as EventLink);
}

export async function createEventLink(event: string, by: string): Promise<EventLink> {
  const t = newToken();
  const link: EventLink = { id: t, token: t, event: event.trim(), by, createdAt: new Date().toISOString(), active: true };
  const { error } = await getSupabase()
    .from("event_links")
    .upsert({ id: t, data: link, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not create link: ${error.message}`);
  return link;
}

export async function setEventLinkActive(link: EventLink, active: boolean): Promise<void> {
  const next: EventLink = { ...link, active };
  const { error } = await getSupabase()
    .from("event_links")
    .upsert({ id: link.id, data: next, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not update link: ${error.message}`);
}

export async function listEventRegistrations(): Promise<EventRegistration[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from("event_registrations")
    .select("data")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load registrations: ${error.message}`);
  return (data ?? []).map((r) => r.data as EventRegistration);
}

// ---- Public (anon, via SECURITY DEFINER RPCs) ----------------------------

export async function eventPublicInfo(token: string): Promise<{ ok: boolean; event?: string }> {
  const { data, error } = await getSupabase().rpc("event_public_info", { p_token: token });
  if (error) return { ok: false };
  return data as { ok: boolean; event?: string };
}

export async function registerVisitor(
  token: string,
  reg: VisitorInput
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc("register_visitor", { p_token: token, p_reg: reg });
  if (error) {
    const m = error.message || "";
    if (m.includes("BAD_LINK")) return { ok: false, error: "This registration link is closed." };
    if (m.includes("BAD_INPUT")) return { ok: false, error: "Enter your name and a valid phone number." };
    return { ok: false, error: "Could not submit — please try again." };
  }
  return { ok: true };
}

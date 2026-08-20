/**
 * Team member details — self-service correction links. An Admin generates a
 * public link and shares it with the team; each member opens /team/{token}
 * (no login) and submits/corrects their personal & family details. The public
 * page reads/writes only through SECURITY DEFINER RPCs granted to anon, so the
 * anon role never touches the tables directly. Staff read the full list (RLS:
 * staff only). Re-submitting with the same National ID updates that record.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";

export interface TeamDetailLink {
  id: string; // == token
  token: string;
  title: string; // e.g. "Team details 2026"
  by: string; // admin email who created it
  createdAt: string;
  active: boolean;
}

export interface Child {
  name: string;
  nationalId?: string;
  birthDate?: string; // yyyy-mm-dd
}

export type MaritalStatus = "Single" | "Married" | "Divorced" | "Widowed";

export interface TeamDetail {
  id: string;
  token: string;
  title: string;
  fullName: string;
  nationalId?: string;
  phone?: string;
  position?: string; // role / department
  maritalStatus?: string;
  spouseName?: string; // wife / husband
  spouseId?: string;
  children: Child[];
  on: string; // ISO datetime submitted / last corrected
}

export interface TeamDetailInput {
  fullName: string;
  nationalId?: string;
  phone?: string;
  position?: string;
  maritalStatus?: string;
  spouseName?: string;
  spouseId?: string;
  children: Child[];
}

function newToken(): string {
  const rnd = (globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Math.random()}`).replace(/-/g, "");
  return `tm_${rnd.slice(0, 24)}`;
}

// ---- Admin (authenticated) -----------------------------------------------

export async function listTeamLinks(): Promise<TeamDetailLink[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from("team_detail_links")
    .select("data")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load team links: ${error.message}`);
  return (data ?? []).map((r) => r.data as TeamDetailLink);
}

export async function createTeamLink(title: string, by: string): Promise<TeamDetailLink> {
  const t = newToken();
  const link: TeamDetailLink = { id: t, token: t, title: title.trim(), by, createdAt: new Date().toISOString(), active: true };
  const { error } = await getSupabase()
    .from("team_detail_links")
    .upsert({ id: t, data: link, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not create link: ${error.message}`);
  return link;
}

export async function setTeamLinkActive(link: TeamDetailLink, active: boolean): Promise<void> {
  const next: TeamDetailLink = { ...link, active };
  const { error } = await getSupabase()
    .from("team_detail_links")
    .upsert({ id: link.id, data: next, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not update link: ${error.message}`);
}

export async function listTeamDetails(): Promise<TeamDetail[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from("team_details")
    .select("data")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load team details: ${error.message}`);
  return (data ?? []).map((r) => {
    const d = r.data as TeamDetail;
    return { ...d, children: d.children ?? [] };
  });
}

export async function deleteTeamDetail(id: string): Promise<void> {
  const { error } = await getSupabase().from("team_details").delete().eq("id", id);
  if (error) throw new Error(`Could not delete record: ${error.message}`);
}

// ---- Public (anon, via SECURITY DEFINER RPCs) ----------------------------

export async function teamLinkInfo(token: string): Promise<{ ok: boolean; title?: string }> {
  const { data, error } = await getSupabase().rpc("team_link_info", { p_token: token });
  if (error) return { ok: false };
  return data as { ok: boolean; title?: string };
}

export async function submitTeamDetail(
  token: string,
  rec: TeamDetailInput
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc("submit_team_detail", { p_token: token, p_rec: rec });
  if (error) {
    const m = error.message || "";
    if (m.includes("BAD_LINK")) return { ok: false, error: "This link is closed. Please ask for a current one." };
    if (m.includes("BAD_INPUT")) return { ok: false, error: "Please enter your full name." };
    return { ok: false, error: "Could not submit — please try again." };
  }
  return { ok: true };
}

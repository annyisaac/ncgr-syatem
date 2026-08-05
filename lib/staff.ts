/**
 * Staff directory & attendance.
 *
 * An Admin generates a public link and shares it; workers open /join/{token} —
 * no login — and submit their profile once. The public page reads/writes only
 * through SECURITY DEFINER RPCs granted to anon, so the anon role never touches
 * the tables directly. Staff (authenticated, not DSRs) read the full roster and
 * mark attendance; attendance is stored one row per worker per day.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";

export const DEPARTMENTS = [
  "Hatchery",
  "Sales & Coordination",
  "Logistics",
  "Parent Stock",
  "Finance",
  "Administration",
  "Other",
] as const;

export type AttendanceStatus = "present" | "late" | "absent" | "leave";

export const ATTENDANCE_STATUSES: { value: AttendanceStatus; label: string }[] = [
  { value: "present", label: "Present" },
  { value: "late", label: "Late" },
  { value: "absent", label: "Absent" },
  { value: "leave", label: "Leave" },
];

export interface StaffLink {
  id: string; // == token
  token: string;
  label: string; // e.g. "Staff onboarding 2026"
  by: string; // admin email who created it
  createdAt: string;
  active: boolean;
}

export interface StaffMember {
  id: string;
  token: string;
  name: string;
  phone: string;
  department: string;
  position: string;
  nationalId?: string;
  startDate?: string; // "yyyy-mm-dd"
  on: string; // ISO datetime submitted
}

export interface StaffProfileInput {
  name: string;
  phone: string;
  department: string;
  position: string;
  nationalId?: string;
  startDate?: string;
}

export interface AttendanceRecord {
  id: string; // `${staffId}:${date}`
  staffId: string;
  date: string; // "yyyy-mm-dd"
  status: AttendanceStatus;
  note?: string;
  by: string; // who marked it
  on: string; // ISO datetime marked
}

function newToken(): string {
  const rnd = (globalThis.crypto?.randomUUID?.() ?? `${Math.random()}${Math.random()}`).replace(/-/g, "");
  return `st_${rnd.slice(0, 24)}`;
}

// ---- Admin (authenticated) -----------------------------------------------

export async function listStaffLinks(): Promise<StaffLink[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from("staff_links")
    .select("data")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load staff links: ${error.message}`);
  return (data ?? []).map((r) => r.data as StaffLink);
}

export async function createStaffLink(label: string, by: string): Promise<StaffLink> {
  const t = newToken();
  const link: StaffLink = { id: t, token: t, label: label.trim() || "Staff registration", by, createdAt: new Date().toISOString(), active: true };
  const { error } = await getSupabase()
    .from("staff_links")
    .upsert({ id: t, data: link, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not create link: ${error.message}`);
  return link;
}

export async function setStaffLinkActive(link: StaffLink, active: boolean): Promise<void> {
  const next: StaffLink = { ...link, active };
  const { error } = await getSupabase()
    .from("staff_links")
    .upsert({ id: link.id, data: next, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not update link: ${error.message}`);
}

export async function listStaffMembers(): Promise<StaffMember[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from("staff_members")
    .select("data")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load staff: ${error.message}`);
  return (data ?? []).map((r) => r.data as StaffMember);
}

export async function upsertStaffMember(member: StaffMember): Promise<void> {
  const { error } = await getSupabase()
    .from("staff_members")
    .upsert({ id: member.id, data: member, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save staff member: ${error.message}`);
}

export async function removeStaffMember(id: string): Promise<void> {
  const { error } = await getSupabase().from("staff_members").delete().eq("id", id);
  if (error) throw new Error(`Could not remove staff member: ${error.message}`);
}

export async function listAttendance(): Promise<AttendanceRecord[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from("attendance_records")
    .select("data")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load attendance: ${error.message}`);
  return (data ?? []).map((r) => r.data as AttendanceRecord);
}

/** Mark (or update) one worker's attendance for a day. Keyed by staff + date. */
export async function upsertAttendance(rec: AttendanceRecord): Promise<void> {
  const { error } = await getSupabase()
    .from("attendance_records")
    .upsert({ id: rec.id, data: rec, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save attendance: ${error.message}`);
}

export async function removeAttendance(id: string): Promise<void> {
  const { error } = await getSupabase().from("attendance_records").delete().eq("id", id);
  if (error) throw new Error(`Could not clear attendance: ${error.message}`);
}

// ---- Public (anon, via SECURITY DEFINER RPCs) ----------------------------

export async function staffPublicInfo(token: string): Promise<{ ok: boolean; org?: string }> {
  const { data, error } = await getSupabase().rpc("staff_public_info", { p_token: token });
  if (error) return { ok: false };
  return data as { ok: boolean; org?: string };
}

export async function submitStaffProfile(
  token: string,
  profile: StaffProfileInput
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().rpc("submit_staff_profile", { p_token: token, p_profile: profile });
  if (error) {
    const m = error.message || "";
    if (m.includes("BAD_LINK")) return { ok: false, error: "This registration link is closed." };
    if (m.includes("BAD_INPUT")) return { ok: false, error: "Enter your name and a valid phone number." };
    return { ok: false, error: "Could not submit — please try again." };
  }
  return { ok: true };
}

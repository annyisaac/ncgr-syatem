/**
 * Period closing + audit trail.
 *
 * Closing locks a month so journal entries dated within it can't be added or
 * changed. The audit log is append-only: every finance-critical action records
 * who did what, when.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";

export interface AccountingPeriod {
  id: string;        // == period "YYYY-MM"
  period: string;
  status: "open" | "closed";
  closedBy?: string;
  closedOn?: string;
  note?: string;
}

export interface AuditEntry {
  id: string;
  on: string;        // ISO datetime
  user: string;
  module: string;
  action: string;
  detail: string;
}

// ---- Periods --------------------------------------------------------------

export async function listPeriods(): Promise<AccountingPeriod[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("accounting_periods").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load periods: ${error.message}`);
  return (data ?? []).map((r) => r.data as AccountingPeriod);
}
export async function upsertPeriod(p: AccountingPeriod): Promise<void> {
  const { error } = await getSupabase().from("accounting_periods").upsert({ id: p.id, data: p, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save period: ${error.message}`);
}

export function isPeriodClosed(periods: AccountingPeriod[], monthOrDate: string): boolean {
  const m = monthOrDate.slice(0, 7);
  return periods.some((p) => p.period === m && p.status === "closed");
}

/** Last `n` months ending at the given month, newest first. */
export function recentMonths(currentMonth: string, n = 12): string[] {
  const [y, mo] = currentMonth.split("-").map(Number);
  const base = y * 12 + (mo - 1);
  const out: string[] = [];
  for (let i = 0; i < n; i++) { const idx = base - i; out.push(`${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`); }
  return out;
}

// ---- Audit log (append-only) ----------------------------------------------

export async function listAudit(limit = 300): Promise<AuditEntry[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("audit_log").select("data").order("updated_at", { ascending: false }).limit(limit);
  if (error) throw new Error(`Could not load audit log: ${error.message}`);
  return (data ?? []).map((r) => r.data as AuditEntry);
}

export async function logAudit(user: string, module: string, action: string, detail: string): Promise<void> {
  if (!inBrowser()) return;
  const e: AuditEntry = { id: `aud_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`, on: new Date().toISOString(), user, module, action, detail };
  const { error } = await getSupabase().from("audit_log").insert({ id: e.id, data: e, updated_at: e.on });
  if (error) console.warn("audit log failed:", error.message);
}

/**
 * Double-entry accounting core: chart of accounts + general-ledger journal
 * entries, with balance/trial-balance/ledger helpers. Every posted entry must
 * balance (total debits === total credits). Higher layers (sales, purchasing,
 * payroll…) post entries here so nothing is entered twice.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";

export const ACCOUNT_TYPES = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Cost of Sales",
  "Operating Expense",
  "Other Income",
  "Other Expense",
] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Account types whose balance increases on the debit side. */
export const DEBIT_NORMAL: AccountType[] = ["Asset", "Cost of Sales", "Operating Expense", "Other Expense"];
export function normalSide(type: AccountType): "debit" | "credit" {
  return DEBIT_NORMAL.includes(type) ? "debit" : "credit";
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: AccountType;
  active: boolean;
  description?: string;
}

export interface JournalLine {
  accountCode: string;
  debit: number;
  credit: number;
  memo?: string;
}

export type JournalStatus = "draft" | "posted" | "void";

export interface JournalEntry {
  id: string;
  date: string;        // ISO date of the transaction
  ref?: string;        // document reference (invoice #, bill #, …)
  narration: string;
  lines: JournalLine[];
  status: JournalStatus;
  source?: string;     // module that generated it, e.g. "sales", "manual", "expense"
  createdBy: string;
  on: string;          // ISO datetime created
  postedBy?: string;
  postedOn?: string;
}

// ---- Storage (finance-only via RLS) --------------------------------------

export async function listAccounts(): Promise<Account[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("coa_accounts").select("data").order("updated_at", { ascending: true });
  if (error) throw new Error(`Could not load accounts: ${error.message}`);
  return (data ?? []).map((r) => r.data as Account).sort((a, b) => (a.code < b.code ? -1 : 1));
}

export async function upsertAccount(a: Account): Promise<void> {
  const { error } = await getSupabase().from("coa_accounts").upsert({ id: a.id, data: a, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save account: ${error.message}`);
}

export async function listJournals(): Promise<JournalEntry[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("journal_entries").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load journal: ${error.message}`);
  return (data ?? []).map((r) => r.data as JournalEntry);
}

export async function upsertJournal(e: JournalEntry): Promise<void> {
  const { error } = await getSupabase().from("journal_entries").upsert({ id: e.id, data: e, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save journal entry: ${error.message}`);
}

export async function deleteJournal(id: string): Promise<void> {
  const { error } = await getSupabase().from("journal_entries").delete().eq("id", id);
  if (error) throw new Error(`Could not delete journal entry: ${error.message}`);
}

export function newAccountId(code: string): string { return `coa_${code}`; }
export function newJournalId(): string { return `je_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`; }

// ---- Journal helpers ------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
export const sumDebits = (e: Pick<JournalEntry, "lines">) => round2(e.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0));
export const sumCredits = (e: Pick<JournalEntry, "lines">) => round2(e.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0));

/** A balanced entry has debits === credits and a non-zero total. */
export function isBalanced(e: Pick<JournalEntry, "lines">): boolean {
  return sumDebits(e) > 0 && sumDebits(e) === sumCredits(e);
}

// ---- Reports --------------------------------------------------------------

export interface TrialRow { code: string; name: string; type: AccountType; debit: number; credit: number; }

/** Trial balance from POSTED entries only. */
export function trialBalance(accounts: Account[], entries: JournalEntry[]): { rows: TrialRow[]; totalDebit: number; totalCredit: number } {
  const net = new Map<string, number>(); // debit − credit per account code
  for (const e of entries) {
    if (e.status !== "posted") continue;
    for (const l of e.lines) net.set(l.accountCode, (net.get(l.accountCode) ?? 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));
  }
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const rows: TrialRow[] = [];
  for (const [code, n] of net) {
    if (round2(n) === 0) continue;
    const a = byCode.get(code);
    rows.push({ code, name: a?.name ?? code, type: a?.type ?? "Asset", debit: n > 0 ? round2(n) : 0, credit: n < 0 ? round2(-n) : 0 });
  }
  rows.sort((a, b) => (a.code < b.code ? -1 : 1));
  return {
    rows,
    totalDebit: round2(rows.reduce((s, r) => s + r.debit, 0)),
    totalCredit: round2(rows.reduce((s, r) => s + r.credit, 0)),
  };
}

export interface LedgerLine { date: string; ref: string; narration: string; debit: number; credit: number; balance: number; }

/** Running-balance ledger for one account (posted entries), signed to the
 *  account's normal side so a debit-normal account grows with debits. */
export function accountLedger(account: Account, entries: JournalEntry[]): LedgerLine[] {
  const sign = normalSide(account.type) === "debit" ? 1 : -1;
  const posted = entries
    .filter((e) => e.status === "posted")
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.on < b.on ? -1 : 1));
  let running = 0;
  const out: LedgerLine[] = [];
  for (const e of posted) {
    for (const l of e.lines) {
      if (l.accountCode !== account.code) continue;
      running = round2(running + sign * ((Number(l.debit) || 0) - (Number(l.credit) || 0)));
      out.push({ date: e.date, ref: e.ref ?? "", narration: e.narration, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0, balance: running });
    }
  }
  return out;
}

/** Net balance (signed to normal side) for an account, posted entries only. */
export function accountBalance(account: Account, entries: JournalEntry[]): number {
  const rows = accountLedger(account, entries);
  return rows.length ? rows[rows.length - 1].balance : 0;
}

/**
 * Banking & reconciliation. Bank accounts map to a GL cash/bank account; their
 * transactions are the ledger movements on that account. Reconciliation ticks
 * off which movements have cleared the bank statement.
 */

import { getSupabase } from "./supabase";
import type { JournalEntry } from "./accounting";

const inBrowser = () => typeof window !== "undefined";
const round0 = (n: number) => Math.round(n);

export interface BankAccount {
  id: string;
  name: string;
  bank?: string;
  accountNumber?: string;
  glCode: string;      // GL account this bank maps to (e.g. 1100)
  active: boolean;
  by: string;
  on: string;
}

export interface BankRecon {
  id: string;          // == glCode
  glCode: string;
  reconciledIds: string[]; // journal entry ids marked cleared
  statementBalance?: number;
  statementDate?: string;
  on: string;
  by: string;
}

// ---- Storage --------------------------------------------------------------

async function fetchAll<T>(table: "bank_accounts" | "bank_recon"): Promise<T[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from(table).select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return (data ?? []).map((r) => r.data as T);
}
async function saveRow(table: "bank_accounts" | "bank_recon", row: { id: string }): Promise<void> {
  const { error } = await getSupabase().from(table).upsert({ id: row.id, data: row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save ${table}: ${error.message}`);
}
export const listBankAccounts = () => fetchAll<BankAccount>("bank_accounts");
export const upsertBankAccount = (b: BankAccount) => saveRow("bank_accounts", b);
export const listBankRecon = () => fetchAll<BankRecon>("bank_recon");
export const upsertBankRecon = (r: BankRecon) => saveRow("bank_recon", r);
export const newBankId = () => `bank_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ---- Movements & balances -------------------------------------------------

export interface BankMovement { entryId: string; date: string; ref: string; narration: string; debit: number; credit: number; }

/** Ledger movements on a bank's GL account (posted), oldest first. */
export function bankMovements(entries: JournalEntry[], glCode: string): BankMovement[] {
  const out: BankMovement[] = [];
  for (const e of entries) {
    if (e.status !== "posted") continue;
    for (const l of e.lines) {
      if (l.accountCode !== glCode) continue;
      out.push({ entryId: e.id, date: e.date, ref: e.ref ?? "", narration: e.narration, debit: Number(l.debit) || 0, credit: Number(l.credit) || 0 });
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

export function bookBalance(movements: BankMovement[]): number {
  return round0(movements.reduce((s, m) => s + m.debit - m.credit, 0));
}
export function reconciledBalance(movements: BankMovement[], reconciledIds: string[]): number {
  const set = new Set(reconciledIds);
  return round0(movements.filter((m) => set.has(m.entryId)).reduce((s, m) => s + m.debit - m.credit, 0));
}

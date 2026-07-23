/**
 * Budgets vs actual. A budget is an amount for one account in one month;
 * actuals come straight from the posted general ledger.
 */

import { getSupabase } from "./supabase";
import { normalSide, type Account, type JournalEntry } from "./accounting";

const inBrowser = () => typeof window !== "undefined";
const round0 = (n: number) => Math.round(n);

export interface Budget {
  id: string;
  period: string;      // "YYYY-MM"
  accountCode: string;
  amount: number;
  by: string;
  on: string;
}

export async function listBudgets(): Promise<Budget[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("budgets").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load budgets: ${error.message}`);
  return (data ?? []).map((r) => r.data as Budget);
}
export async function upsertBudget(b: Budget): Promise<void> {
  const { error } = await getSupabase().from("budgets").upsert({ id: b.id, data: b, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save budget: ${error.message}`);
}
export async function deleteBudget(id: string): Promise<void> {
  const { error } = await getSupabase().from("budgets").delete().eq("id", id);
  if (error) throw new Error(`Could not delete budget: ${error.message}`);
}
export const budgetId = (period: string, code: string) => `bud_${period}_${code}`;

/** Actual on an account for a month, on its natural side (expense as spend,
 *  revenue as income) — from posted entries. */
export function actualForAccount(entries: JournalEntry[], account: Account, period: string): number {
  let net = 0;
  for (const e of entries) {
    if (e.status !== "posted" || e.date.slice(0, 7) !== period) continue;
    for (const l of e.lines) if (l.accountCode === account.code) net += (Number(l.debit) || 0) - (Number(l.credit) || 0);
  }
  return round0(normalSide(account.type) === "debit" ? net : -net);
}

export interface BudgetRow { code: string; name: string; type: string; budget: number; actual: number; variance: number; favorable: boolean; pct: number; }

/** Budget-vs-actual rows for a period. Favourable = spending under budget
 *  (debit-normal) or earning over budget (credit-normal). */
export function budgetVsActual(budgets: Budget[], accounts: Account[], entries: JournalEntry[], period: string): BudgetRow[] {
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  return budgets
    .filter((b) => b.period === period)
    .map((b) => {
      const a = byCode.get(b.accountCode);
      const debitNormal = a ? normalSide(a.type) === "debit" : true;
      const actual = a ? actualForAccount(entries, a, period) : 0;
      const variance = round0(b.amount - actual); // remaining budget (spend) / shortfall (income)
      const favorable = debitNormal ? actual <= b.amount : actual >= b.amount;
      return { code: b.accountCode, name: a?.name ?? b.accountCode, type: a?.type ?? "", budget: b.amount, actual, variance, favorable, pct: b.amount ? round0((actual / b.amount) * 100) : 0 };
    })
    .sort((x, y) => (x.code < y.code ? -1 : 1));
}

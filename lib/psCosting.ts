/**
 * Parent Stock — production costing, and the posting of farm operating costs
 * to Finance.
 *
 * The cost sheet gathers a period's costs to work out cost per bird, per male,
 * per female, per fertile egg and per flock. Feed and issued stock are read
 * from the daily logs / inventory (already booked when purchased, so shown for
 * the unit-cost calc only). The manually-recorded operating costs — labour,
 * utilities, maintenance, biosecurity, depreciation, transport… — are what
 * post to the ledger, on the Accountant's Accounting page (deterministic id +
 * diffing sync, so re-runs never double-post).
 */

import { getSupabase } from "./supabase";
import type { JournalEntry } from "./accounting";

const inBrowser = () => typeof window !== "undefined";

/** Manual operating-cost categories and the GL account each posts to. */
export const PROD_COST_CATEGORIES: { key: string; label: string; account: string }[] = [
  { key: "labour", label: "Labour", account: "6000" },
  { key: "electricity", label: "Electricity", account: "6030" },
  { key: "water", label: "Water", account: "6030" },
  { key: "maintenance", label: "Maintenance", account: "6050" },
  { key: "biosecurity", label: "Biosecurity", account: "6070" },
  { key: "cleaning", label: "Cleaning materials", account: "6070" },
  { key: "consumables", label: "Farm consumables", account: "6070" },
  { key: "transport", label: "Transport", account: "6040" },
  { key: "depreciation", label: "Equipment depreciation", account: "6900" },
  { key: "other", label: "Other", account: "6900" },
];
export const accountForCost = (key: string) => PROD_COST_CATEGORIES.find((c) => c.key === key)?.account ?? "6900";
export const labelForCost = (key: string) => PROD_COST_CATEGORIES.find((c) => c.key === key)?.label ?? key;

export interface ProductionCostLine { category: string; amount: number; note?: string; }

export interface ProductionCost {
  id: string;            // == period, YYYY-MM
  period: string;
  lines: ProductionCostLine[];
  by: string;
  on: string;
}
export const manualCostTotal = (c: Pick<ProductionCost, "lines">) =>
  Math.round(c.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));

// ---- GL posting -----------------------------------------------------------

const CASH = "1000";

/** One balanced entry per period: Dr each operating-cost account (grouped) /
 *  Cr Cash for the total. Feed and issued stock are not re-posted here. */
export function deriveProductionCostEntries(costs: ProductionCost[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const c of costs) {
    const debits = new Map<string, number>();
    for (const l of c.lines) {
      const amt = Number(l.amount) || 0;
      if (amt <= 0) continue;
      const acct = accountForCost(l.category);
      debits.set(acct, Math.round((debits.get(acct) ?? 0) + amt));
    }
    const total = [...debits.values()].reduce((s, n) => s + n, 0);
    if (total <= 0) continue;
    out.push({
      id: `je_pscost_${c.period}`,
      date: `${c.period}-28`,
      ref: `PS-${c.period}`,
      narration: `Breeder farm operating costs — ${c.period}`,
      lines: [
        ...[...debits.entries()].map(([accountCode, amount]) => ({ accountCode, debit: amount, credit: 0 })),
        { accountCode: CASH, debit: 0, credit: total },
      ],
      status: "posted", source: "parentstock", createdBy: "system", on: c.on, postedBy: "system", postedOn: c.on,
    });
  }
  return out;
}

export function productionCostEntriesToSync(costs: ProductionCost[], existing: JournalEntry[]): JournalEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const sig = (e: JournalEntry) => `${e.date}|${e.status}|${JSON.stringify(e.lines)}`;
  return deriveProductionCostEntries(costs).filter((d) => { const cur = byId.get(d.id); return !cur || sig(cur) !== sig(d); });
}

// ---- Storage --------------------------------------------------------------

export async function listProductionCosts(): Promise<ProductionCost[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("ps_costs").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load production costs: ${error.message}`);
  return (data ?? []).map((r) => r.data as ProductionCost);
}
export async function upsertProductionCost(c: ProductionCost): Promise<void> {
  const { error } = await getSupabase().from("ps_costs").upsert({ id: c.id, data: c, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save production cost: ${error.message}`);
}

/**
 * Hatchery batch costing → inventory → cost of goods sold.
 *
 * Costs are first recorded where they're incurred (purchases, payroll…), which
 * debits the expense/inventory accounts. When a batch is costed and posted we
 * CAPITALISE those costs into finished-goods inventory:
 *   Dr Inventory — Chicks (1300) / Cr the source accounts (eggs, feed, labour…)
 * so nothing is counted twice.
 *
 * On delivery, chicks are relieved from inventory at the weighted-average cost
 * per saleable chick for that product:
 *   Dr Cost of Goods Sold (5000) / Cr Inventory — Chicks (1300)
 *
 * Mortality / cull / hatch losses aren't separate cost lines — they shrink the
 * saleable count, so the same total cost spreads over fewer chicks and the cost
 * per saleable chick rises automatically.
 */

import { getSupabase } from "./supabase";
import type { JournalEntry } from "./accounting";
import type { Batch } from "./hatchery/types";
import { orderTotal, type Order, type Product } from "./types";

const inBrowser = () => typeof window !== "undefined";
const round2 = (n: number) => Math.round(n * 100) / 100;

const INVENTORY_CHICKS = "1300";
const COGS = "5000";

/** Cost categories and the account each one is capitalised out of. */
export const COST_CATEGORIES: { key: string; label: string; account: string }[] = [
  { key: "eggs", label: "Hatching eggs", account: "1310" },
  { key: "transport", label: "Transport", account: "6040" },
  { key: "vaccines", label: "Vaccines & medicines", account: "6020" },
  { key: "disinfectants", label: "Disinfectants", account: "6070" },
  { key: "packaging", label: "Packaging (boxes)", account: "6070" },
  { key: "electricity", label: "Electricity", account: "6030" },
  { key: "water", label: "Water", account: "6030" },
  { key: "fuel", label: "Fuel", account: "6040" },
  { key: "labour", label: "Labour", account: "6000" },
  { key: "maintenance", label: "Machine maintenance", account: "6050" },
  { key: "consumables", label: "Consumables", account: "6070" },
  { key: "other", label: "Other", account: "6900" },
];
export const accountForCategory = (key: string) => COST_CATEGORIES.find((c) => c.key === key)?.account ?? "6900";
export const labelForCategory = (key: string) => COST_CATEGORIES.find((c) => c.key === key)?.label ?? key;

export interface CostLine { category: string; amount: number; note?: string }

export interface BatchCost {
  id: string;          // == batchId
  batchId: string;
  batchNo: string;
  product: Product;
  lines: CostLine[];
  status: "draft" | "posted";
  by: string;
  on: string;
}

// ---- Storage --------------------------------------------------------------

export async function listBatchCosts(): Promise<BatchCost[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("batch_costs").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load batch costs: ${error.message}`);
  return (data ?? []).map((r) => r.data as BatchCost);
}
export async function upsertBatchCost(c: BatchCost): Promise<void> {
  const { error } = await getSupabase().from("batch_costs").upsert({ id: c.id, data: c, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save batch cost: ${error.message}`);
}

// ---- Unit costs -----------------------------------------------------------

export const totalCost = (c: Pick<BatchCost, "lines">) => round2(c.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));

export interface UnitCosts { total: number; perEggSet: number; perHatched: number; perSaleable: number; }
export function unitCosts(c: Pick<BatchCost, "lines">, b: Batch | undefined): UnitCosts {
  const total = totalCost(c);
  const eggs = b?.eggsSet ?? 0;
  const hatched = b?.hatchedCount ?? 0;
  const saleable = b?.saleableCount ?? 0;
  return {
    total,
    perEggSet: eggs > 0 ? round2(total / eggs) : 0,
    perHatched: hatched > 0 ? round2(total / hatched) : 0,
    perSaleable: saleable > 0 ? round2(total / saleable) : 0,
  };
}

/** Weighted-average cost per saleable chick for a product, from posted batch
 *  costs (total cost ÷ total saleable chicks). */
export function avgCostPerChick(product: Product, costs: BatchCost[], batches: Batch[]): number {
  const byId = new Map(batches.map((b) => [b.id, b]));
  let cost = 0, chicks = 0;
  for (const c of costs) {
    if (c.status !== "posted" || c.product !== product) continue;
    const b = byId.get(c.batchId);
    if (!b || !b.saleableCount) continue;
    cost += totalCost(c);
    chicks += b.saleableCount;
  }
  return chicks > 0 ? round2(cost / chicks) : 0;
}

// ---- GL posting -----------------------------------------------------------

/** Capitalise posted batch costs into finished-goods inventory. */
export function deriveCostingEntries(costs: BatchCost[], batches: Batch[]): JournalEntry[] {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const out: JournalEntry[] = [];
  for (const c of costs) {
    if (c.status !== "posted") continue;
    const total = totalCost(c);
    if (total <= 0) continue;
    const b = byId.get(c.batchId);
    const date = (b?.steps?.["hatching"]?.on ?? c.on).slice(0, 10);
    // Group credits by account so repeated categories merge.
    const credits = new Map<string, number>();
    for (const l of c.lines) {
      const amt = Number(l.amount) || 0;
      if (amt <= 0) continue;
      const acct = accountForCategory(l.category);
      credits.set(acct, round2((credits.get(acct) ?? 0) + amt));
    }
    out.push({
      id: `je_batchcost_${c.batchId}`,
      date,
      ref: c.batchNo,
      narration: `Batch cost capitalised — ${c.batchNo}`,
      lines: [
        { accountCode: INVENTORY_CHICKS, debit: total, credit: 0 },
        ...[...credits.entries()].map(([accountCode, amount]) => ({ accountCode, debit: 0, credit: amount })),
      ],
      status: "posted",
      source: "costing",
      createdBy: "system",
      on: c.on,
      postedBy: "system",
      postedOn: c.on,
    });
  }
  return out;
}

/** Relieve inventory at weighted-average cost when an order is delivered. */
export function deriveCogsEntries(orders: Order[], costs: BatchCost[], batches: Batch[]): JournalEntry[] {
  const avg: Record<string, number> = {
    "Ross 308": avgCostPerChick("Ross 308", costs, batches),
    "Tetra Super Harco": avgCostPerChick("Tetra Super Harco", costs, batches),
  };
  const out: JournalEntry[] = [];
  for (const o of orders) {
    if (o.status === "refunded" || o.status === "rejected") continue;
    if (!(o.deliverOk || o.status === "fulfilled")) continue;
    const unit = avg[o.product] ?? 0;
    if (unit <= 0) continue;
    const chicks = o.delivered ?? o.chicks;
    const amount = round2(chicks * unit);
    if (amount <= 0) continue;
    out.push({
      id: `je_cogs_${o.id}`,
      date: o.date,
      ref: `COGS-${o.id.slice(-8)}`,
      narration: `Cost of goods sold — ${o.name} · ${chicks.toLocaleString()} ${o.product}`,
      lines: [
        { accountCode: COGS, debit: amount, credit: 0 },
        { accountCode: INVENTORY_CHICKS, debit: 0, credit: amount },
      ],
      status: "posted",
      source: "costing",
      createdBy: "system",
      on: o.createdAt,
      postedBy: "system",
      postedOn: o.createdAt,
    });
  }
  return out;
}

export function costingEntriesToSync(costs: BatchCost[], batches: Batch[], orders: Order[], existing: JournalEntry[]): JournalEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const sig = (e: JournalEntry) => `${e.date}|${e.status}|${JSON.stringify(e.lines)}`;
  return [...deriveCostingEntries(costs, batches), ...deriveCogsEntries(orders, costs, batches)]
    .filter((d) => { const cur = byId.get(d.id); return !cur || sig(cur) !== sig(d); });
}

// ---- Batch profitability --------------------------------------------------

export interface BatchProfit { batchId: string; batchNo: string; product: Product; cost: number; saleable: number; perChick: number; revenue: number; sold: number; margin: number; }

/** Revenue attributed to a batch's product at the average sell price of
 *  delivered orders, vs its cost — an indicative batch profitability. */
export function batchProfitability(costs: BatchCost[], batches: Batch[], orders: Order[]): BatchProfit[] {
  const byId = new Map(batches.map((b) => [b.id, b]));
  const delivered = orders.filter((o) => (o.deliverOk || o.status === "fulfilled") && o.status !== "refunded" && o.status !== "rejected");
  const priceOf = (p: Product) => {
    const list = delivered.filter((o) => o.product === p);
    const chicks = list.reduce((s, o) => s + (o.delivered ?? o.chicks), 0);
    const rev = list.reduce((s, o) => s + orderTotal(o), 0);
    return chicks > 0 ? rev / chicks : 0;
  };
  return costs.filter((c) => c.status === "posted").map((c) => {
    const b = byId.get(c.batchId);
    const saleable = b?.saleableCount ?? 0;
    const cost = totalCost(c);
    const unitPrice = priceOf(c.product);
    const revenue = round2(saleable * unitPrice);
    return {
      batchId: c.batchId, batchNo: c.batchNo, product: c.product, cost, saleable,
      perChick: saleable > 0 ? round2(cost / saleable) : 0,
      revenue, sold: saleable, margin: round2(revenue - cost),
    };
  }).sort((a, b) => (a.batchNo < b.batchNo ? 1 : -1));
}

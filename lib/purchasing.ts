/**
 * Purchasing & Payables: suppliers, purchase bills, and supplier payments —
 * with automatic double-entry posting to the general ledger.
 *
 * Postings (deterministic ids → idempotent sync):
 *  - Posted bill: Dr each line's account (expense/inventory) / Cr Accounts
 *    Payable (2000), for the bill total.
 *  - Each payment: Dr Accounts Payable (2000) / Cr Cash (1000, cash) or Bank
 *    (1100), for the payment amount.
 */

import { getSupabase } from "./supabase";
import type { JournalEntry } from "./accounting";

const inBrowser = () => typeof window !== "undefined";
const AP = "2000";

export interface Supplier {
  id: string;
  name: string;
  phone?: string;
  email?: string;
  supplies?: string; // what they supply
  notes?: string;
  active: boolean;
  by: string;
  on: string;
}

export interface PurchaseLine {
  accountCode: string; // expense or inventory account to debit
  description: string;
  amount: number;
}

export interface PurchasePayment {
  amt: number;
  date: string;
  method: "cash" | "bank";
  ref?: string;
  by: string;
  on: string;
}

export type PurchaseStatus = "draft" | "posted";

export interface Purchase {
  id: string;
  supplierId: string;
  supplierName: string;
  date: string;   // bill date
  ref?: string;   // supplier invoice / bill number
  lines: PurchaseLine[];
  status: PurchaseStatus;
  payments: PurchasePayment[];
  createdBy: string;
  on: string;
}

// ---- Storage --------------------------------------------------------------

async function fetchAll<T>(table: "suppliers" | "purchases"): Promise<T[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from(table).select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return (data ?? []).map((r) => r.data as T);
}
async function saveRow(table: "suppliers" | "purchases", row: { id: string }): Promise<void> {
  const { error } = await getSupabase().from(table).upsert({ id: row.id, data: row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save ${table}: ${error.message}`);
}

export const listSuppliers = () => fetchAll<Supplier>("suppliers");
export const upsertSupplier = (s: Supplier) => saveRow("suppliers", s);
export const listPurchases = () => fetchAll<Purchase>("purchases");
export const upsertPurchase = (p: Purchase) => saveRow("purchases", p);

export const newSupplierId = () => `sup_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export const newPurchaseId = () => `pur_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ---- Money helpers --------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;
export const purchaseTotal = (p: Pick<Purchase, "lines">) => round2(p.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));
export const purchasePaid = (p: Pick<Purchase, "payments">) => round2(p.payments.reduce((s, x) => s + (Number(x.amt) || 0), 0));
export const purchaseBalance = (p: Pick<Purchase, "lines" | "payments">) => round2(purchaseTotal(p) - purchasePaid(p));

/** Outstanding a supplier is owed across their posted bills. */
export function supplierBalance(supplierId: string, purchases: Purchase[]): number {
  return round2(
    purchases
      .filter((p) => p.supplierId === supplierId && p.status === "posted")
      .reduce((s, p) => s + Math.max(0, purchaseBalance(p)), 0)
  );
}

// ---- AP aging -------------------------------------------------------------

const daysBetween = (fromISO: string, toISO: string) =>
  Math.max(0, Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000));

export interface PayableRow {
  supplierId: string;
  name: string;
  total: number;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90: number;
}

export function apAging(purchases: Purchase[], suppliers: Supplier[], today: string): { rows: PayableRow[]; totals: Omit<PayableRow, "supplierId" | "name"> } {
  const nameOf = new Map(suppliers.map((s) => [s.id, s.name]));
  const bySup = new Map<string, PayableRow>();
  for (const p of purchases) {
    if (p.status !== "posted") continue;
    const bal = purchaseBalance(p);
    if (bal <= 0) continue;
    const age = daysBetween(p.date, today);
    const row = bySup.get(p.supplierId) ?? { supplierId: p.supplierId, name: nameOf.get(p.supplierId) ?? p.supplierName, total: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 };
    row.total = round2(row.total + bal);
    if (age <= 30) row.d0_30 = round2(row.d0_30 + bal);
    else if (age <= 60) row.d31_60 = round2(row.d31_60 + bal);
    else if (age <= 90) row.d61_90 = round2(row.d61_90 + bal);
    else row.d90 = round2(row.d90 + bal);
    bySup.set(p.supplierId, row);
  }
  const rows = [...bySup.values()].sort((a, b) => b.total - a.total);
  const totals = rows.reduce(
    (t, r) => ({ total: round2(t.total + r.total), d0_30: round2(t.d0_30 + r.d0_30), d31_60: round2(t.d31_60 + r.d31_60), d61_90: round2(t.d61_90 + r.d61_90), d90: round2(t.d90 + r.d90) }),
    { total: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 }
  );
  return { rows, totals };
}

// ---- GL posting -----------------------------------------------------------

export function derivePurchaseEntries(purchases: Purchase[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const p of purchases) {
    if (p.status !== "posted") continue;
    const total = purchaseTotal(p);
    if (total > 0) {
      out.push({
        id: `je_pur_bill_${p.id}`,
        date: p.date,
        ref: p.ref || `BILL-${p.id.slice(-6)}`,
        narration: `Purchase — ${p.supplierName}`,
        lines: [
          ...p.lines.filter((l) => (Number(l.amount) || 0) > 0).map((l) => ({ accountCode: l.accountCode, debit: round2(Number(l.amount) || 0), credit: 0, memo: l.description })),
          { accountCode: AP, debit: 0, credit: total },
        ],
        status: "posted",
        source: "purchasing",
        createdBy: "system",
        on: p.on,
        postedBy: "system",
        postedOn: p.on,
      });
    }
    p.payments.forEach((pay, i) => {
      const cashAcct = pay.method === "cash" ? "1000" : "1100";
      out.push({
        id: `je_pur_pay_${p.id}_${i}`,
        date: pay.date,
        ref: pay.ref || `PAY-${p.id.slice(-6)}`,
        narration: `Supplier payment — ${p.supplierName}`,
        lines: [
          { accountCode: AP, debit: pay.amt, credit: 0 },
          { accountCode: cashAcct, debit: 0, credit: pay.amt },
        ],
        status: "posted",
        source: "purchasing",
        createdBy: "system",
        on: pay.on,
        postedBy: "system",
        postedOn: pay.on,
      });
    });
  }
  return out;
}

export function purchaseEntriesToSync(purchases: Purchase[], existing: JournalEntry[]): JournalEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const sig = (e: JournalEntry) => `${e.date}|${e.status}|${JSON.stringify(e.lines)}`;
  return derivePurchaseEntries(purchases).filter((d) => {
    const cur = byId.get(d.id);
    return !cur || sig(cur) !== sig(d);
  });
}

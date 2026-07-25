/**
 * Logistics → General Ledger.
 *
 * Connects the operational logistics module to the books, the same way
 * salesLedger / purchasing / costing do: deterministic journal-entry ids +
 * a diffing sync so re-runs never double-post. The Accountant's Accounting
 * page runs the sync, so posting stays a finance action.
 *
 * Postings:
 *  - Goods received & handed to Finance → Dr Inventory (1300) / Cr AP (2000)
 *    at the accepted value (a payable to the supplier).
 *  - Posted logistics expense → Dr the category's expense account / Cr Cash
 *    (1000), Bank (1100) or AP (2000) depending on how it was paid.
 *  - Completed trip transport cost → Dr the allocation's account / Cr AP (2000)
 *    (an accrual), except a customer delivery charge which isn't a cost.
 */

import type { JournalEntry } from "./accounting";
import { grnAcceptedValue, type GoodsReceipt } from "./procurement";
import { tripTotalCost, type Trip } from "./trips";
import type { LogisticsExpense } from "./logisticsOps";
import type { MaterialRequest } from "./materialRequests";

const round2 = (n: number) => Math.round(n * 100) / 100;

const INVENTORY = "1300";
const AP = "2000";
const CASH = "1000";
const BANK = "1100";
const COGS = "5000";

/** Logistics expense category → the GL expense account it posts to. */
const EXPENSE_ACCOUNT: Record<string, string> = {
  "Fuel": "6040", "Vehicle hire": "6040", "Loading": "6040", "Offloading": "6040",
  "Driver allowance": "6040", "Parking": "6040", "Road expense": "6040",
  "Repairs": "6050", "Transport permit": "6900", "Accommodation": "6900", "Other": "6900",
};
const expenseAccount = (category: string) => EXPENSE_ACCOUNT[category] ?? "6900";

/** Trip cost allocation → the GL account it lands in. */
const ALLOCATION_ACCOUNT: Record<string, string> = {
  "Inventory landed cost": INVENTORY,
  "Delivery expense": "6040",
  "Distribution overhead": "6040",
  "Cost of sales": COGS,
};

function entry(id: string, date: string, ref: string, narration: string, debitAcct: string, creditAcct: string, amount: number, on: string): JournalEntry {
  return {
    id, date, ref, narration,
    lines: [
      { accountCode: debitAcct, debit: amount, credit: 0 },
      { accountCode: creditAcct, debit: 0, credit: amount },
    ],
    status: "posted", source: "logistics", createdBy: "system", on, postedBy: "system", postedOn: on,
  };
}

/** Handed-off goods received notes → a supplier payable for the accepted goods. */
export function deriveGrnEntries(receipts: GoodsReceipt[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const g of receipts) {
    if (!g.handedToFinance) continue;
    const amount = grnAcceptedValue(g);
    if (amount <= 0) continue;
    out.push(entry(`je_grn_${g.id}`, (g.handedOn ?? g.receivedDate).slice(0, 10), g.invoiceNo || g.ref,
      `Goods received — ${g.supplierName} (${g.poRef})`, INVENTORY, AP, amount, g.on));
  }
  return out;
}

/** Posted logistics expenses → an expense against cash, bank or payables. */
export function deriveLogisticsExpenseEntries(expenses: LogisticsExpense[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const e of expenses) {
    if (e.status !== "Posted") continue;
    const amount = round2(Number(e.amount) || 0);
    if (amount <= 0) continue;
    // Logistics expenses are settled at posting (cash/bank), so credit the
    // funding account directly — no dangling payable to reconcile later.
    const credit = e.paymentMethod === "Bank" ? BANK : CASH;
    out.push(entry(`je_lex_${e.id}`, e.date.slice(0, 10), e.ref,
      `Logistics — ${e.category}${e.payee ? ` · ${e.payee}` : ""}`, expenseAccount(e.category), credit, amount, e.on));
  }
  return out;
}

/** Completed trips → their transport cost, allocated per company policy. */
export function deriveTripEntries(trips: Trip[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const t of trips) {
    if (t.status !== "Completed") continue;
    if (t.allocation === "Customer delivery charge") continue; // billed to the customer, not a cost
    const amount = tripTotalCost(t);
    if (amount <= 0) continue;
    const debit = ALLOCATION_ACCOUNT[t.allocation] ?? "6040";
    const date = t.departAt && /^\d{4}-\d{2}-\d{2}/.test(t.departAt) ? t.departAt.slice(0, 10) : t.on.slice(0, 10);
    // Trip costs (fuel, allowances) are paid as they're incurred — credit Cash.
    out.push(entry(`je_trip_${t.id}`, date, t.ref, `Transport — ${t.ref} (${t.allocation})`, debit, CASH, amount, t.on));
  }
  return out;
}

/** Materials → Consumables & Supplies (6070); spare parts → Repairs &
 *  Maintenance (6050). */
const materialAccount = (type: string) => (type === "Spare parts" ? "6050" : "6070");

/** Paid material/spare-part requests → the expense against cash or bank,
 *  posted when Logistics confirms the payment (status Paid or Filed). */
export function deriveMaterialRequestEntries(requests: MaterialRequest[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const r of requests) {
    if (r.status !== "Paid" && r.status !== "Filed") continue;
    const p = r.payment;
    const amount = round2(Number(p?.amount) || 0);
    if (!p || amount <= 0) continue;
    const credit = p.method === "Bank" ? BANK : CASH;
    out.push(entry(`je_msr_${r.id}`, p.on.slice(0, 10), r.ref,
      `${r.type}${p.supplier ? ` · ${p.supplier}` : ""} — ${r.ref}`, materialAccount(r.type), credit, amount, p.on));
  }
  return out;
}

/** All logistics postings that are missing or changed vs the current ledger. */
export function logisticsEntriesToSync(
  receipts: GoodsReceipt[], expenses: LogisticsExpense[], trips: Trip[], materialRequests: MaterialRequest[], existing: JournalEntry[]
): JournalEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const sig = (e: JournalEntry) => `${e.date}|${e.status}|${JSON.stringify(e.lines)}`;
  return [...deriveGrnEntries(receipts), ...deriveLogisticsExpenseEntries(expenses), ...deriveTripEntries(trips), ...deriveMaterialRequestEntries(materialRequests)]
    .filter((d) => { const cur = byId.get(d.id); return !cur || sig(cur) !== sig(d); });
}

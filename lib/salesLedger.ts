/**
 * Sales → General Ledger auto-posting.
 *
 * Derives double-entry journal entries from sales orders so nothing is entered
 * twice. Each entry has a deterministic id (keyed by order + event), so
 * re-running just overwrites the same row — safe to sync repeatedly.
 *
 * Postings:
 *  - On delivery: Dr Accounts Receivable (1200) / Cr Sales Revenue (4000 Ross,
 *    4010 Tetra) for the billed amount.
 *  - Each verified receipt: Dr Cash (1000, CASH) or Bank (1100) / Cr AR (1200).
 *
 * COGS / inventory relief comes with the inventory-costing phase.
 */

import { orderTotal, type Order } from "./types";
import type { JournalEntry } from "./accounting";

const AR = "1200";
const REV = { "Ross 308": "4000", "Tetra Super Harco": "4010" } as const;

export function deriveSalesEntries(orders: Order[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const o of orders) {
    if (o.status === "refunded" || o.status === "rejected") continue;
    const revAcct = REV[o.product] ?? "4000";

    // Revenue + receivable recognised on delivery.
    if (o.deliverOk || o.status === "fulfilled") {
      const amt = orderTotal(o);
      if (amt > 0) {
        out.push({
          id: `je_sales_inv_${o.id}`,
          date: o.date,
          ref: `INV-${o.id.slice(-8)}`,
          narration: `Sales invoice — ${o.name} · ${o.product}`,
          lines: [
            { accountCode: AR, debit: amt, credit: 0 },
            { accountCode: revAcct, debit: 0, credit: amt },
          ],
          status: "posted",
          source: "sales",
          createdBy: "system",
          on: o.createdAt,
          postedBy: "system",
          postedOn: o.createdAt,
        });
      }
    }

    // Cash/bank receipts for each verified (non-voided) payment.
    o.payments.forEach((p, i) => {
      if (!p.verified || p.voided) return;
      const cashAcct = (p.ref || "").trim().toUpperCase() === "CASH" ? "1000" : "1100";
      out.push({
        id: `je_sales_rcpt_${o.id}_${i}`,
        date: (p.on || o.createdAt).slice(0, 10),
        ref: (p.ref || "").slice(0, 20) || "RECEIPT",
        narration: `Customer receipt — ${o.name}`,
        lines: [
          { accountCode: cashAcct, debit: p.amt, credit: 0 },
          { accountCode: AR, debit: 0, credit: p.amt },
        ],
        status: "posted",
        source: "sales",
        createdBy: "system",
        on: p.on || o.createdAt,
        postedBy: "system",
        postedOn: p.on || o.createdAt,
      });
    });
  }
  return out;
}

/** Which derived entries are missing or differ from what's already stored —
 *  the set that a sync needs to write. */
export function salesEntriesToSync(orders: Order[], existing: JournalEntry[]): JournalEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const sig = (e: JournalEntry) => `${e.date}|${e.status}|${JSON.stringify(e.lines)}`;
  return deriveSalesEntries(orders).filter((d) => {
    const cur = byId.get(d.id);
    return !cur || sig(cur) !== sig(d);
  });
}

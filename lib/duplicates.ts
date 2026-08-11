/**
 * Order-quality detector (pure): finds likely duplicate orders and reused
 * payment references so the Admin can flag them for the sellers to check.
 *
 * This is READ-ONLY analysis over the loaded orders — it never mutates data.
 * The DB triggers now prevent NEW duplicates; this surfaces the ones that
 * pre-date them (or any edge that slips through) for human review.
 */

import { normRef } from "./verification";
import type { Order } from "./types";

const isActive = (o: Order) => o.status !== "rejected" && o.status !== "refunded";
/** Already actioned: a payment sent back to the seller or held for Admin
 *  approval is being corrected, so it drops off the "to review" list until it's
 *  resolved (otherwise it would keep re-appearing after you send it back). */
const isBeingCorrected = (o: Order) =>
  o.payments.some((p) => !p.voided && (p.returnedForFix || p.reusedDispute || p.pendingApproval));
const normName = (s: string) => (s ?? "").trim().toLowerCase();
const normPhone = (s: string): string => {
  const d = (s ?? "").replace(/\D/g, "");
  return d.startsWith("250") ? d.slice(3) : d.replace(/^0/, "");
};

/** Method/placeholder words that aren't real transaction ids (kept in step with
 *  the DB's ncgr_is_txn_ref). "Bank", "MoMo", "Cash" etc. normalize to < 8 chars
 *  and are dropped by the length check below; these are the 8+ char ones. */
const PLACEHOLDER_REFS = new Set(["imported", "banktransfer", "mobilemoney", "notprovided", "onaccount"]);

/** A payment reference counts only if it's a real transaction id — long enough
 *  (≥ 8 chars) and not a method/placeholder word. Stops "Bank"/"MoMo"/date
 *  fragments from reading as a reused reference. */
function realRef(ref: string): string | null {
  const r = normRef(ref);
  if (r.length < 8 || PLACEHOLDER_REFS.has(r)) return null;
  return r;
}

/** A non-voided transaction ref shared by two different orders in the set. */
function sharedRefOf(orders: Order[]): string | undefined {
  const seen = new Map<string, string>(); // normalized ref -> order id
  for (const o of orders) {
    for (const p of o.payments) {
      if (p.voided) continue;
      const r = realRef(p.ref);
      if (!r) continue;
      const prev = seen.get(r);
      if (prev && prev !== o.id) return p.ref;
      seen.set(r, o.id);
    }
  }
  return undefined;
}

export interface OrderIssue {
  id: string;
  kind: "same-customer" | "reused-ref";
  title: string;
  subtitle: string;
  /** A transaction ref the orders share — present ⇒ money is double-counted. */
  sharedRef?: string;
  orders: Order[];
}

/**
 * Flags two kinds of problem across the active orders:
 *  - same customer (phone, else name) + product + delivery date on >1 order;
 *  - the same transaction reference on payments of >1 order.
 * An exact-same order set is reported once (as the customer duplicate).
 */
export function findOrderIssues(orders: Order[]): OrderIssue[] {
  const active = orders.filter((o) => isActive(o) && !isBeingCorrected(o));
  const issues: OrderIssue[] = [];
  const seen = new Set<string>(); // order-id-set signatures already reported
  const sig = (os: Order[]) => os.map((o) => o.id).sort().join(",");

  // 1) Same customer + product + delivery date.
  const byCust = new Map<string, Order[]>();
  for (const o of active) {
    const ident = normPhone(o.phone) || normName(o.name);
    if (!ident) continue;
    const key = `${ident}|${o.product}|${o.date}`;
    const arr = byCust.get(key);
    if (arr) arr.push(o);
    else byCust.set(key, [o]);
  }
  for (const [key, os] of byCust) {
    if (os.length < 2) continue;
    os.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    issues.push({
      id: `cust:${key}`,
      kind: "same-customer",
      title: os[0].name,
      subtitle: `${os.length} orders · ${os[0].product} · ${os[0].date}`,
      sharedRef: sharedRefOf(os),
      orders: os,
    });
    seen.add(sig(os));
  }

  // 2) Same transaction reference on different orders (e.g. cross-customer, or
  //    any pair not already caught above).
  const byRef = new Map<string, Map<string, Order>>();
  for (const o of active) {
    for (const p of o.payments) {
      if (p.voided) continue;
      const r = realRef(p.ref);
      if (!r) continue;
      let m = byRef.get(r);
      if (!m) { m = new Map(); byRef.set(r, m); }
      m.set(o.id, o);
    }
  }
  for (const [, m] of byRef) {
    if (m.size < 2) continue;
    const os = [...m.values()].sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    if (seen.has(sig(os))) continue; // already reported as a customer duplicate
    const ref = os
      .flatMap((o) => o.payments)
      .find((p) => !p.voided && realRef(p.ref) && os.filter((oo) => oo.payments.some((pp) => !pp.voided && normRef(pp.ref) === normRef(p.ref))).length > 1)?.ref;
    issues.push({
      id: `ref:${ref ?? sig(os)}`,
      kind: "reused-ref",
      title: os.map((o) => o.name).join(" · "),
      subtitle: `same payment ref on ${m.size} orders`,
      sharedRef: ref,
      orders: os,
    });
    seen.add(sig(os));
  }

  // Money-double-count issues first, then the rest, newest delivery date first.
  return issues.sort((a, b) => {
    const am = a.sharedRef ? 0 : 1;
    const bm = b.sharedRef ? 0 : 1;
    if (am !== bm) return am - bm;
    return (b.orders[0]?.date ?? "").localeCompare(a.orders[0]?.date ?? "");
  });
}

/**
 * How much money an issue double-counts: the shared reference's amount times the
 * number of extra orders carrying it. 0 when there is no shared reference.
 */
export function doubleCountedAmount(issue: OrderIssue): number {
  if (!issue.sharedRef) return 0;
  const key = normRef(issue.sharedRef);
  let amt = 0;
  let count = 0;
  for (const o of issue.orders) {
    for (const p of o.payments) {
      if (p.voided) continue;
      if (normRef(p.ref) === key) {
        amt = Number(p.amt) || amt;
        count++;
      }
    }
  }
  return count > 1 ? amt * (count - 1) : 0;
}

/**
 * Commission computation (pure).
 *
 * Rates: 100 RWF per delivered Tetra chick; 20 RWF per Ross 308 chick.
 * "Eligible chicks" = the chicks that will be delivered (chicks + 2% + comp)?
 * Commission is paid per DELIVERED chick — we use the ordered `chicks` count
 * (the sellable birds) as the commissionable quantity.
 *
 * An order is commission-eligible when it is delivered, OR paid in advance
 * (fully paid) before delivery.
 */

import { commissionRate } from "./config";
import { isFullyPaid, type Order } from "./types";

/** Commission-relevant quantity for an order (ordered chicks). */
export function commissionChicks(order: Order): number {
  return order.chicks;
}

export function orderCommission(order: Order): number {
  return commissionChicks(order) * commissionRate(order.product);
}

function isClosedOrder(order: Order): boolean {
  return order.status === "refunded" || order.status === "rejected";
}

/** Advance = fully paid but not yet delivered. */
export function isAdvanceEligible(order: Order): boolean {
  return !order.deliverOk && !isClosedOrder(order) && isFullyPaid(order);
}

/** An order that counts toward commission (delivered or paid-in-advance). */
export function isCommissionEligible(order: Order): boolean {
  if (isClosedOrder(order)) return false;
  if (!order.dsrId) return false;
  return order.deliverOk || isFullyPaid(order);
}

export type CommissionRowStatus =
  | "due" // eligible, not yet requested/paid
  | "initiated" // a request exists awaiting Admin
  | "paid" // commPaid and delivered
  | "paid-advance"; // commPaid but not yet delivered

export interface DSRCommissionRow {
  dsrId: string;
  dsrName: string;
  district: string;
  product: Order["product"];
  orderIds: string[];
  chicks: number;
  amount: number;
  delivered: number; // count delivered
  advance: number; // count paid-in-advance (not delivered)
  initiatedAmount: number;
  paidAmount: number;
  dueAmount: number;
}

/**
 * Aggregate commission per DSR over a set of (already date/role-filtered)
 * orders. Only commission-eligible orders contribute.
 */
export function commissionByDSR(orders: Order[]): DSRCommissionRow[] {
  const map = new Map<string, DSRCommissionRow>();

  for (const o of orders) {
    if (!isCommissionEligible(o)) continue;
    const key = o.dsrId!;
    const row =
      map.get(key) ??
      ({
        dsrId: key,
        dsrName: o.dsr ?? "—",
        district: o.district,
        product: o.product,
        orderIds: [],
        chicks: 0,
        amount: 0,
        delivered: 0,
        advance: 0,
        initiatedAmount: 0,
        paidAmount: 0,
        dueAmount: 0,
      } satisfies DSRCommissionRow);

    const amt = orderCommission(o);
    row.orderIds.push(o.id);
    row.chicks += commissionChicks(o);
    row.amount += amt;
    if (o.deliverOk) row.delivered += 1;
    else row.advance += 1;

    if (o.commPaid) row.paidAmount += amt;
    else if (o.commReq) row.initiatedAmount += amt;
    else row.dueAmount += amt;

    map.set(key, row);
  }

  return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
}

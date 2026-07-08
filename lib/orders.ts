/**
 * Order lifecycle helpers (pure). The UI calls these to compute the next order
 * state; persistence happens via the DataProvider.
 *
 * Lifecycle gates:
 *  1. Created -> "Not confirmed"
 *  2. Payment recorded (amount + transaction id)
 *  3. Confirm order — only after >=1 payment exists
 *  4. Checker verifies each payment
 *  5. Fulfill — needs verified payments AND fully paid (Admin can override)
 *  6. Never deleted — only rescheduled / edited / refunded
 */

import { nowISO } from "./format";
import {
  allVerified,
  isFullyPaid,
  type Order,
  type Payment,
  type User,
} from "./types";

/** Append an audit line tagged with the actor and timestamp. */
export function logLine(actor: User, action: string): string {
  return `${nowISO()} — ${action} (by ${actor.name})`;
}

export function withHistory(order: Order, actor: User, action: string): Order {
  return { ...order, history: [...order.history, logLine(actor, action)] };
}

export type PaymentCheckState =
  | "none"
  | "awaiting"
  | "partial"
  | "checked";

export function paymentCheckState(order: Order): {
  state: PaymentCheckState;
  verified: number;
  total: number;
} {
  const total = order.payments.length;
  const verified = order.payments.filter((p) => p.verified).length;
  if (total === 0) return { state: "none", verified, total };
  if (verified === 0) return { state: "awaiting", verified, total };
  if (verified < total) return { state: "partial", verified, total };
  return { state: "checked", verified, total };
}

// ---------------------------------------------------------------------------
// Gate checks (return a reason string when blocked, or null when allowed)
// ---------------------------------------------------------------------------

export function canConfirm(order: Order, isAdmin = false): string | null {
  if (order.confirmedOk) return "Already confirmed.";
  if (order.status !== "pending") return "Order is not pending.";
  // Only Admin may confirm an order that has no payment yet.
  if (order.payments.length === 0 && !isAdmin)
    return "Record at least one payment before confirming.";
  return null;
}

export function canAddPayment(order: Order): string | null {
  if (order.status === "refunded") return "Order was refunded.";
  if (isFullyPaid(order) && allVerified(order))
    return "Order is fully paid and fully checked.";
  return null;
}

/**
 * Standard (non-Admin) fulfill gate: order confirmed, every payment verified,
 * and fully paid.
 */
export function canFulfill(order: Order): string | null {
  if (order.deliverOk) return "Already delivered.";
  if (order.status === "refunded") return "Order was refunded.";
  if (!order.confirmedOk) return "Confirm the order first.";
  if (!allVerified(order)) return "Payments are not all checker-verified.";
  if (!isFullyPaid(order)) return "Order is not fully paid.";
  return null;
}

/** Whether the Admin override "Approve debt" is meaningful for this order. */
export function canApproveDebt(order: Order): string | null {
  if (order.deliverOk) return "Already delivered.";
  if (order.status === "refunded") return "Order was refunded.";
  if (isFullyPaid(order)) return "Order is already fully paid.";
  return null;
}

// ---------------------------------------------------------------------------
// State transitions (return the next order — caller persists)
// ---------------------------------------------------------------------------

export function confirmOrder(order: Order, actor: User): Order {
  return withHistory({ ...order, confirmedOk: true }, actor, "Confirmed order");
}

export function addPayment(order: Order, payment: Payment, actor: User): Order {
  return withHistory(
    { ...order, payments: [...order.payments, payment] },
    actor,
    `Recorded payment ${payment.amt.toLocaleString()} RWF (ref ${payment.ref})`
  );
}

export function fulfillOrder(
  order: Order,
  actor: User,
  note?: string
): Order {
  return withHistory(
    { ...order, deliverOk: true, status: "fulfilled" },
    actor,
    note ?? "Fulfilled (delivered)"
  );
}

export function rescheduleOrder(
  order: Order,
  newDate: string,
  actor: User
): Order {
  return withHistory(
    { ...order, date: newDate, created: newDate },
    actor,
    `Rescheduled delivery to ${newDate}`
  );
}

export function refundOrder(order: Order, reason: string, actor: User): Order {
  return withHistory(
    { ...order, status: "refunded", request: undefined },
    actor,
    `Refunded — ${reason}`
  );
}

/** Move an order up (-1) or down (+1) within its delivery-date plan group. */
export function reorderPlan(
  orders: Order[],
  orderId: string,
  dir: -1 | 1
): Order[] {
  const target = orders.find((o) => o.id === orderId);
  if (!target) return orders;
  const group = orders
    .filter((o) => o.date === target.date)
    .sort((a, b) => a.plan - b.plan);
  const idx = group.findIndex((o) => o.id === orderId);
  const swapIdx = idx + dir;
  if (swapIdx < 0 || swapIdx >= group.length) return orders;

  // Reassign contiguous plan indices, then swap the two positions.
  const order = group.map((o) => o.id);
  [order[idx], order[swapIdx]] = [order[swapIdx], order[idx]];
  const planById = new Map(order.map((id, i) => [id, i]));
  return orders.map((o) =>
    planById.has(o.id) ? { ...o, plan: planById.get(o.id)! } : o
  );
}

/** True when an order was delivered while still carrying a balance. */
export function isDebtApproved(order: Order): boolean {
  return (
    order.deliverOk === true &&
    order.payments.reduce((s, p) => s + p.amt, 0) < order.chicks * order.price
  );
}

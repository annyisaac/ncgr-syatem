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

import { nowISO, todayISO } from "./format";
import {
  allVerified,
  balance,
  customerCredit,
  isFullyPaid,
  orderTotal,
  paidAmount,
  sameCustomer,
  toDeliver,
  type Availability,
  type Order,
  type Payment,
  type Product,
  type User,
} from "./types";

/** Append an audit line tagged with the actor and timestamp. */
export function logLine(actor: User, action: string): string {
  return `${nowISO()} — ${action} (by ${actor.name})`;
}

// ---------------------------------------------------------------------------
// Oversold detection — a delivery date whose ordered chicks exceed the number
// the admin made available for that product (e.g. after they lower the number).
// ---------------------------------------------------------------------------

export interface OversoldGroup {
  date: string;
  product: Product;
  cap: number; // chicks the admin made available for this product that day
  ordered: number; // active chicks ordered for this product that day
  over: number; // ordered − cap (always > 0)
}

const PRODUCTS: Product[] = ["Ross 308", "Tetra Super Harco"];
const isLiveOrder = (s?: string) => s !== "refunded" && s !== "rejected";

/**
 * Every date+product whose active orders exceed the available cap, worst first.
 * Computed from the orders the caller can see, so roles with full product
 * visibility (Admin, Accountant, payment checkers) get the exact figure.
 */
export function oversoldGroups(
  orders: Pick<Order, "date" | "product" | "chicks" | "comp" | "status">[],
  availability: Pick<Availability, "date" | "ross" | "tetra">[]
): OversoldGroup[] {
  const out: OversoldGroup[] = [];
  for (const a of availability) {
    for (const product of PRODUCTS) {
      const cap = product === "Ross 308" ? a.ross : a.tetra;
      const ordered = orders
        .filter((o) => o.date === a.date && o.product === product && isLiveOrder(o.status))
        .reduce((s, o) => s + toDeliver(o), 0);
      if (ordered > cap) out.push({ date: a.date, product, cap, ordered, over: ordered - cap });
    }
  }
  return out.sort((x, y) => y.over - x.over);
}

/** Set of "date|product" keys that are oversold — for flagging order rows. */
export function oversoldKeys(
  orders: Pick<Order, "date" | "product" | "chicks" | "comp" | "status">[],
  availability: Pick<Availability, "date" | "ross" | "tetra">[]
): Set<string> {
  return new Set(oversoldGroups(orders, availability).map((g) => `${g.date}|${g.product}`));
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
  const active = order.payments.filter((p) => !p.voided);
  const total = active.length;
  const verified = active.filter((p) => p.verified).length;
  if (total === 0) return { state: "none", verified, total };
  if (verified === 0) return { state: "awaiting", verified, total };
  if (verified < total) return { state: "partial", verified, total };
  return { state: "checked", verified, total };
}

// ---------------------------------------------------------------------------
// Gate checks (return a reason string when blocked, or null when allowed)
// ---------------------------------------------------------------------------

export function canConfirm(order: Order, allowUnpaid = false): string | null {
  if (order.confirmedOk) return "Already confirmed.";
  if (order.status !== "pending") return "Order is not pending.";
  // Admin and payment checkers may confirm an order that has no payment yet;
  // sellers must record a payment first. Applied customer credit counts as a
  // payment (it's already-verified money), so a credit-funded order can confirm.
  const hasCredit = (order.creditApplied ?? 0) > 0;
  if (order.payments.length === 0 && !hasCredit && !allowUnpaid)
    return "Record at least one payment before confirming.";
  return null;
}

/** True once an order is closed and can no longer move through the lifecycle. */
export function isClosed(order: Order): boolean {
  return order.status === "refunded" || order.status === "rejected";
}

/** True once an order's delivery date has arrived (today or earlier). A delivery
 *  can't be recorded before its scheduled date. */
export function deliveryDateReached(order: Pick<Order, "date">): boolean {
  return !!order.date && order.date <= todayISO();
}

export type Stage = { label: string; tone: "green" | "gold" | "info" | "neutral" | "red" };

/**
 * The human-facing status shown in the DSR / tracking views. Once a payment is
 * recorded the order moves off "Awaiting payment" (so a DSR sees the change
 * immediately) — it then waits for a checker to verify before "Confirmed".
 */
export function orderStage(o: Order): Stage {
  if (o.status === "refunded") return { label: "Refunded", tone: "red" };
  if (o.status === "rejected") return { label: "Rejected", tone: "red" };
  if (o.deliverOk) return { label: "Delivered", tone: "green" };
  if (o.routeId) return { label: "On the truck", tone: "info" };
  if (o.allocatedOk) return { label: "Allocated — chicks reserved", tone: "gold" };
  if (o.confirmedOk) return { label: "Confirmed — awaiting delivery", tone: "gold" };
  if (o.payments.length > 0) return { label: "Payment recorded — awaiting verification", tone: "gold" };
  return { label: "Awaiting payment", tone: "neutral" };
}

export function canAddPayment(order: Order): string | null {
  if (isClosed(order)) return `Order was ${order.status}.`;
  // No more payments once the balance reaches zero (fully paid), verified or not.
  if (isFullyPaid(order)) return "Order is fully paid — balance is zero.";
  return null;
}

/**
 * Standard (non-Admin) fulfill gate: order confirmed, every payment verified,
 * and fully paid.
 */
export function canFulfill(order: Order): string | null {
  if (order.deliverOk) return "Already delivered.";
  if (isClosed(order)) return `Order was ${order.status}.`;
  if (!deliveryDateReached(order)) return `Can't deliver before the delivery date (${order.date}).`;
  if (!order.confirmedOk) return "Confirm the order first.";
  if (!allVerified(order)) return "Payments are not all checker-verified.";
  if (!isFullyPaid(order)) return "Order is not fully paid.";
  if (!order.allocatedOk) return "Chicks not allocated at the hatchery yet.";
  return null;
}

/**
 * Allocation gate (delivery planning): an order may only be put on a route once
 * its payments are all checker-verified — unless it has been approved to go out
 * on debt.
 */
export function canAllocate(order: Order): string | null {
  if (order.debtOk) return null; // cleared to deliver on debt
  if (allVerified(order)) return null; // every payment checker-verified
  if (order.payments.length === 0)
    return "No verified payment yet — verify a payment first, or approve delivery on debt.";
  return "Payments are not all checker-verified — or approve delivery on debt.";
}

/** Whether the Admin override "Approve debt" is meaningful for this order. */
export function canApproveDebt(order: Order): string | null {
  if (order.deliverOk) return "Already delivered.";
  if (isClosed(order)) return `Order was ${order.status}.`;
  if (isFullyPaid(order)) return "Order is already fully paid.";
  return null;
}

/** Reject/cancel a pending order (Admin, Zone Manager, or Ross receiver). */
export function canReject(order: Order): string | null {
  if (order.deliverOk) return "Order was already delivered.";
  if (isClosed(order)) return `Order was already ${order.status}.`;
  return null;
}

// ---------------------------------------------------------------------------
// State transitions (return the next order — caller persists)
// ---------------------------------------------------------------------------

export function confirmOrder(order: Order, actor: User): Order {
  return withHistory({ ...order, confirmedOk: true }, actor, "Confirmed order");
}

/**
 * Clear an order to be delivered on debt: it becomes confirmed and allocatable
 * even though its payments aren't verified/fully paid. It still goes out through
 * the normal route → driver-delivery flow (not fulfilled here).
 */
export function approveDebt(order: Order, actor: User, note?: string): Order {
  return withHistory(
    { ...order, confirmedOk: true, debtOk: true },
    actor,
    note ?? "Approved delivery on debt"
  );
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
    { ...order, deliverOk: true, status: "fulfilled", deliveredAt: nowISO() },
    actor,
    note ?? "Fulfilled (delivered)"
  );
}

/** Credit (RWF) to auto-apply to an order from the customer's wallet — capped at
 *  what the order is billed. Pass the current order list (the order itself is
 *  excluded so its own bill doesn't cancel the credit). */
export function creditToApply(order: Order, orders: Order[]): number {
  return Math.min(customerCredit(orders, order, order.id), orderTotal(order));
}

/**
 * Re-allocate a customer's credit across ALL their active orders so applied
 * credit is never stale — the fix for "edit one order, another order's balance
 * silently goes wrong". The customer's total cash surplus (from any overpaid
 * order) is spread onto their underpaid orders, oldest delivery date first,
 * capped at each order's shortfall.
 *
 * `orders` must already contain the just-changed order(s). Returns ONLY the
 * orders whose `creditApplied` actually changed (each with an audit line), so
 * callers persist a minimal set and no spurious history is written.
 */
export function recomputeCustomerCredit(
  orders: Order[],
  ref: Pick<Order, "phone" | "name">,
  actor: User
): Order[] {
  const mine = orders.filter((o) => !isClosed(o) && sameCustomer(o, ref));
  // Gross surplus cash from any overpaid order, minus credit already consumed by
  // DELIVERED orders (their credit is locked — never reclaimed after delivery).
  const grossSurplus = mine.reduce((s, o) => s + Math.max(0, paidAmount(o) - orderTotal(o)), 0);
  const lockedDelivered = mine.reduce((s, o) => s + (o.deliverOk ? o.creditApplied ?? 0 : 0), 0);
  let pool = Math.max(0, grossSurplus - lockedDelivered);
  // Fill still-open orders oldest delivery date first (createdAt breaks ties).
  const open = mine
    .filter((o) => !o.deliverOk)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt < b.createdAt ? -1 : 1));

  const changed: Order[] = [];
  for (const o of open) {
    const shortfall = orderTotal(o) - paidAmount(o);
    let target = 0;
    if (shortfall > 0 && pool > 0) {
      target = Math.min(pool, shortfall);
    }
    target = Math.round(target);
    pool -= target;
    if (target === Math.round(o.creditApplied ?? 0)) continue; // no change
    const next: Order = target > 0
      ? { ...o, creditApplied: target }
      : (() => { const rest = { ...o }; delete rest.creditApplied; return rest; })();
    changed.push(
      withHistory(next, actor, target > 0
        ? `Applied customer credit auto-updated to ${target.toLocaleString()} RWF`
        : "Applied customer credit auto-cleared")
    );
  }
  return changed;
}

/**
 * Record a short delivery: `delivered` paid chicks were handed over (fewer than
 * ordered). The order is marked delivered and billed for that count; a backorder
 * is spun off for the remaining chicks on `nextDate`, already carrying any
 * surplus the customer paid as applied credit. Returns both orders to persist.
 */
export function shortDeliver(
  order: Order,
  delivered: number,
  nextDate: string,
  actor: User,
  orders: Order[],
  newId: (prefix: string) => string
): { order: Order; backorder: Order } {
  const remaining = Math.max(0, order.chicks - delivered);
  const deliveredOrder = withHistory(
    { ...order, delivered, deliverOk: true, status: "fulfilled" as const },
    actor,
    `Short delivery — ${delivered.toLocaleString()} of ${order.chicks.toLocaleString()} chicks; ${remaining.toLocaleString()} carried to a backorder`
  );

  // First plan slot on the backorder's date (like a reschedule — front of day).
  const plansOnDate = orders
    .filter((o) => o.date === nextDate && o.status !== "refunded" && o.status !== "rejected")
    .map((o) => o.plan);
  const plan = (plansOnDate.length ? Math.min(...plansOnDate) : 0) - 1;

  let backorder: Order = {
    ...order,
    id: newId("ord"),
    chicks: remaining,
    comp: 0,
    delivered: undefined,
    deliverOk: undefined,
    status: "pending",
    confirmedOk: true, // continuation of an already-confirmed order
    debtOk: undefined,
    deliveryFail: undefined,
    routeId: undefined,
    deliveryChicks: undefined,
    pickupLocation: undefined,
    request: undefined,
    commReq: undefined,
    commPaid: undefined,
    creditApplied: undefined,
    backorderOf: order.id,
    payments: [],
    date: nextDate,
    created: nextDate,
    createdAt: nowISO(),
    plan,
    history: [logLine(actor, `Backorder for ${remaining.toLocaleString()} chicks carried from ${order.name}'s short delivery`)],
  };

  // Surplus from the (now smaller-billed) delivered order becomes credit that
  // covers this backorder — compute against the updated delivered order.
  const updated = orders.map((o) => (o.id === deliveredOrder.id ? deliveredOrder : o));
  const applied = creditToApply(backorder, updated);
  if (applied > 0) {
    backorder = withHistory(
      { ...backorder, creditApplied: applied },
      actor,
      `Applied ${applied.toLocaleString()} RWF customer credit from the earlier payment`
    );
  }

  return { order: deliveredOrder, backorder };
}

/**
 * Split a confirmed order into two same-day stops so its chicks can go on
 * different trucks/routes. The original keeps `chicks - splitQty`; a sibling
 * order (`splitOf`) carries `splitQty`, unallocated, on the same date. Any
 * payment surplus freed by the smaller original is applied to the sibling as
 * customer credit — the customer's total owed is unchanged.
 */
export function splitOrder(
  order: Order,
  splitQty: number,
  actor: User,
  orders: Order[],
  newId: (prefix: string) => string
): { original: Order; child: Order } {
  const keep = Math.max(0, order.chicks - splitQty);
  const original = withHistory(
    {
      ...order,
      chicks: keep,
      // If it was already allocated to a route, cap the load to what remains.
      deliveryChicks: order.deliveryChicks != null ? Math.min(order.deliveryChicks, keep) : undefined,
    },
    actor,
    `Split — ${splitQty.toLocaleString()} of ${order.chicks.toLocaleString()} chicks moved to a separate same-day stop`
  );

  let child: Order = {
    ...order,
    id: newId("ord"),
    chicks: splitQty,
    comp: 0,
    delivered: undefined,
    deliverOk: undefined,
    hasProof: undefined,
    status: "pending",
    confirmedOk: true, // same confirmed order, just split for delivery
    debtOk: undefined,
    deliveryFail: undefined,
    routeId: undefined,
    deliveryChicks: undefined,
    pickupLocation: undefined,
    request: undefined,
    commReq: undefined,
    commPaid: undefined,
    creditApplied: undefined,
    splitOf: order.id,
    backorderOf: undefined,
    payments: [],
    date: order.date,
    created: order.date,
    createdAt: nowISO(),
    plan: order.plan,
    history: [logLine(actor, `Split-off stop for ${splitQty.toLocaleString()} chicks from ${order.name}'s order`)],
  };

  const updated = orders.map((o) => (o.id === original.id ? original : o));
  const applied = creditToApply(child, updated);
  if (applied > 0) {
    child = withHistory(
      { ...child, creditApplied: applied },
      actor,
      `Applied ${applied.toLocaleString()} RWF customer credit from the original order's payment`
    );
  }

  return { original, child };
}

/**
 * Reschedule an order to a new delivery date. When the full order list is
 * passed, the order is placed FIRST in the new date's delivery plan (it gets a
 * plan index below every active order already on that date) — so a rescheduled
 * customer jumps to the front of the day they were moved to.
 */
export function rescheduleOrder(
  order: Order,
  newDate: string,
  actor: User,
  orders?: Order[]
): Order {
  let plan = order.plan;
  if (orders) {
    const plansOnDate = orders
      .filter(
        (o) =>
          o.id !== order.id &&
          o.date === newDate &&
          o.status !== "refunded" &&
          o.status !== "rejected"
      )
      .map((o) => o.plan);
    plan = (plansOnDate.length ? Math.min(...plansOnDate) : 0) - 1;
  }
  // Rescheduling a delivered order reopens it: it is no longer fulfilled, so it
  // goes back to pending and off its old route to be freshly allocated and
  // re-delivered on the new date. Payments and confirmation are kept.
  const reopen = order.deliverOk
    ? {
        status: "pending" as const,
        deliverOk: undefined,
        delivered: undefined,
        deliveryChicks: undefined,
        deliveryFail: undefined,
        routeId: undefined,
        pickupLocation: undefined,
      }
    : {};
  return withHistory(
    { ...order, ...reopen, date: newDate, created: newDate, plan, rescheduled: true, rescheduledFrom: order.date },
    actor,
    order.deliverOk
      ? `Rescheduled delivery to ${newDate} — reopened for delivery, placed first`
      : `Rescheduled delivery to ${newDate} — placed first`
  );
}

export function refundOrder(order: Order, reason: string, actor: User): Order {
  return withHistory(
    { ...order, status: "refunded", request: undefined },
    actor,
    `Refunded — ${reason}`
  );
}

export function rejectOrder(order: Order, reason: string, actor: User): Order {
  return withHistory(
    { ...order, status: "rejected", request: undefined },
    actor,
    `Rejected — ${reason}`
  );
}

/**
 * Reverse a rejection: an Admin restores a rejected order to the live "pending"
 * status. Rejection never cleared the lifecycle flags or payments, so the order
 * simply resumes where it was. The one-live-order-per-customer-per-date rule
 * applies again, so the caller must check no other live order holds the slot.
 */
export function reverseRejection(order: Order, reason: string, actor: User): Order {
  return withHistory(
    { ...order, status: "pending" },
    actor,
    `Rejection reversed — restored to pending — ${reason}`
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
  return order.deliverOk === true && balance(order) > 0;
}

/**
 * Commission workflow orchestration (pure). Each function returns the updated
 * orders / request objects; the caller persists them via the DataProvider.
 */

import { nowISO } from "./format";
import { isCommissionEligible, orderCommission } from "./commission";
import type { CommissionRequest, Order, Product, User } from "./types";

/**
 * A payout run limited to a period. `only` is the set of order ids on screen
 * (already filtered by delivery date); `periodFrom`/`periodTo` are recorded on
 * the request so the history says what the payment covered. Omit the whole
 * object to pay everything outstanding, as before.
 */
export interface PayoutScope {
  only?: Set<string>;
  periodFrom?: string;
  periodTo?: string;
}

/**
 * Eligible orders for a DSR that have not been requested or paid yet,
 * optionally narrowed to the period's orders (`scope.only`).
 */
export function dueOrdersForDSR(orders: Order[], dsrId: string, scope?: PayoutScope): Order[] {
  return orders.filter(
    (o) =>
      o.dsrId === dsrId &&
      (!scope?.only || scope.only.has(o.id)) &&
      isCommissionEligible(o) &&
      !o.commReq &&
      !o.commPaid
  );
}

function buildRequest(
  due: Order[],
  dsrId: string,
  dsrName: string,
  product: Product,
  actor: User,
  id: string,
  status: CommissionRequest["status"],
  scope?: PayoutScope
): CommissionRequest {
  return {
    id,
    dsrId,
    dsrName,
    district: due[0]?.district ?? "—",
    product,
    orderIds: due.map((o) => o.id),
    amount: due.reduce((s, o) => s + orderCommission(o), 0),
    chicks: due.reduce((s, o) => s + o.chicks, 0),
    by: actor.email,
    on: nowISO(),
    status,
    ...(scope?.periodFrom ? { periodFrom: scope.periodFrom } : {}),
    ...(scope?.periodTo ? { periodTo: scope.periodTo } : {}),
    ...(status !== "initiated"
      ? { decidedBy: actor.email, decidedOn: nowISO() }
      : {}),
  };
}

/** A salesperson/manager initiates a commission payment request. */
export function initiateCommission(
  orders: Order[],
  dsrId: string,
  dsrName: string,
  product: Product,
  actor: User,
  newId: () => string,
  scope?: PayoutScope
): { request: CommissionRequest; orders: Order[] } | null {
  const due = dueOrdersForDSR(orders, dsrId, scope);
  if (due.length === 0) return null;
  const request = buildRequest(due, dsrId, dsrName, product, actor, newId(), "initiated", scope);
  const ids = new Set(due.map((o) => o.id));
  const updated = orders.map((o) =>
    ids.has(o.id) ? { ...o, commReq: true } : o
  );
  return { request, orders: updated };
}

/** Admin approves a request — marks its orders commission-paid. */
export function approveCommission(
  request: CommissionRequest,
  orders: Order[],
  actor: User
): { request: CommissionRequest; orders: Order[] } {
  const ids = new Set(request.orderIds);
  const updated = orders.map((o) =>
    ids.has(o.id) ? { ...o, commReq: true, commPaid: true } : o
  );
  return {
    request: { ...request, status: "approved", decidedBy: actor.email, decidedOn: nowISO() },
    orders: updated,
  };
}

/** Admin rejects a request — releases its orders back to "due". */
export function rejectCommission(
  request: CommissionRequest,
  orders: Order[],
  actor: User
): { request: CommissionRequest; orders: Order[] } {
  const ids = new Set(request.orderIds);
  const updated = orders.map((o) =>
    ids.has(o.id) ? { ...o, commReq: false } : o
  );
  return {
    request: { ...request, status: "rejected", decidedBy: actor.email, decidedOn: nowISO() },
    orders: updated,
  };
}

/** Admin pays commission directly (skips the request queue). */
export function payCommissionNow(
  orders: Order[],
  dsrId: string,
  dsrName: string,
  product: Product,
  actor: User,
  newId: () => string,
  scope?: PayoutScope
): { request: CommissionRequest; orders: Order[] } | null {
  const due = dueOrdersForDSR(orders, dsrId, scope);
  if (due.length === 0) return null;
  const request = buildRequest(due, dsrId, dsrName, product, actor, newId(), "approved", scope);
  const ids = new Set(due.map((o) => o.id));
  const updated = orders.map((o) =>
    ids.has(o.id) ? { ...o, commReq: true, commPaid: true } : o
  );
  return { request, orders: updated };
}

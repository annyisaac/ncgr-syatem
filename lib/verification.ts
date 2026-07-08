/**
 * Automatic payment verification against uploaded bank statements (pure).
 *
 * Rules:
 *  - Each unverified payment's transaction id is searched across ALL statements.
 *  - Exact ref match with equal amount    -> auto-verified.
 *  - Exact ref match with different amount -> adopt the bank amount, verify,
 *    and log the correction.
 *  - No match                             -> "Not in any statement".
 *  - Ref found more than once             -> "Duplicate ref" (needs manual).
 */

import { nowISO } from "./format";
import type { BankStatement, Order, User } from "./types";

export type AutoResult = "verified" | "corrected" | "missing" | "duplicate";

export interface AutoOutcome {
  orderId: string;
  client: string;
  ref: string;
  result: AutoResult;
  detail: string;
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function runAutoCheck(
  orders: Order[],
  statements: BankStatement[],
  actor: User,
  visibleIds: Set<string>
): { orders: Order[]; outcomes: AutoOutcome[] } {
  const allRows = statements.flatMap((s) => s.rows);
  const outcomes: AutoOutcome[] = [];

  const updated = orders.map((order) => {
    if (!visibleIds.has(order.id)) return order;
    if (!order.confirmedOk) return order;

    let changed = false;
    const extraHistory: string[] = [];

    const payments = order.payments.map((p) => {
      if (p.verified) return p;

      const matches = allRows.filter((r) => norm(r.ref) === norm(p.ref));
      if (matches.length === 0) {
        outcomes.push({
          orderId: order.id,
          client: order.name,
          ref: p.ref,
          result: "missing",
          detail: "Not in any statement",
        });
        changed = true;
        return { ...p, flag: "Not in any statement" };
      }
      if (matches.length > 1) {
        outcomes.push({
          orderId: order.id,
          client: order.name,
          ref: p.ref,
          result: "duplicate",
          detail: `Ref appears ${matches.length} times`,
        });
        changed = true;
        return { ...p, flag: "Duplicate ref" };
      }

      const bank = matches[0];
      const base = {
        ...p,
        verified: true,
        verifiedBy: actor.email,
        verifiedOn: nowISO(),
        checkedRef: p.ref,
      };
      if (bank.amt === p.amt) {
        outcomes.push({
          orderId: order.id,
          client: order.name,
          ref: p.ref,
          result: "verified",
          detail: "Auto-verified from statement",
        });
        changed = true;
        return { ...base, comment: "Auto-verified from bank statement", flag: undefined };
      }
      // Adopt the bank amount.
      const was = p.amt;
      outcomes.push({
        orderId: order.id,
        client: order.name,
        ref: p.ref,
        result: "corrected",
        detail: `Amount corrected ${was.toLocaleString()} -> ${bank.amt.toLocaleString()}`,
      });
      extraHistory.push(
        `${nowISO()} — Payment ${p.ref} amount corrected from ${was.toLocaleString()} to ${bank.amt.toLocaleString()} RWF (auto, by ${actor.name})`
      );
      changed = true;
      return {
        ...base,
        amt: bank.amt,
        comment: "Auto-verified; amount adopted from bank statement",
        flag: `Amount corrected from ${was.toLocaleString()}`,
      };
    });

    if (!changed) return order;
    return { ...order, payments, history: [...order.history, ...extraHistory] };
  });

  return { orders: updated, outcomes };
}

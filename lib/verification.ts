/**
 * Automatic payment verification against uploaded bank statements (pure).
 *
 * Rules:
 *  - Transaction ids are compared after normalization (see `normRef`) so bank
 *    exports that space, punctuate or zero-pad an id still match.
 *  - Each unverified payment's id is searched across ALL statements.
 *  - Exact ref match with equal amount        -> auto-verified.
 *  - Exact ref match, amount within tolerance  -> adopt bank amount, verify,
 *    log the correction.
 *  - Exact ref match, amount off beyond tolerance -> held for manual review
 *    (never silently reduce/inflate what a customer is credited).
 *  - No match                                  -> "Not in any statement".
 *  - Ref found with several amounts             -> "Duplicate ref" (manual).
 *  - Ref already matched to an earlier payment  -> "collision": a single bank
 *    credit is never counted against two payments.
 */

import { nowISO } from "./format";
import type { BankStatement, Order, User } from "./types";

export type AutoResult = "verified" | "corrected" | "review" | "missing" | "duplicate" | "collision";

export interface AutoOutcome {
  orderId: string;
  client: string;
  ref: string;
  result: AutoResult;
  detail: string;
}

/**
 * A statement amount within this tolerance of the recorded amount is adopted
 * automatically; a larger gap (either direction) is held for a human, so an
 * auto-check never quietly rewrites a materially different figure.
 */
export const AMOUNT_REVIEW_FLAT = 1000; // RWF
export const AMOUNT_REVIEW_PCT = 0.02; // 2% of the recorded amount

function amountNeedsReview(recorded: number, bank: number, currency: string): boolean {
  // The flat floor is an RWF figure; for USD/EUR a tiny flat keeps the percentage rule in charge.
  const flat = currency === "RWF" ? AMOUNT_REVIEW_FLAT : 1;
  return Math.abs(bank - recorded) > Math.max(flat, recorded * AMOUNT_REVIEW_PCT);
}

/**
 * Normalize a transaction id for comparison: keep only letters and digits,
 * lowercase, and strip leading zeros from long all-digit ids (bank exports
 * sometimes zero-pad them). This makes "2915 1640 4175", "291516404175" and
 * "0291516404175" compare equal while staying strict enough that genuinely
 * different — or short — ids never collide.
 */
export function normRef(s: string): string {
  const cleaned = s.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (/^\d+$/.test(cleaned) && cleaned.length > 8) return cleaned.replace(/^0+/, "");
  return cleaned;
}

function norm(s: string): string {
  return normRef(s);
}

/**
 * Statement rows that share a transaction id AND amount are the same payment
 * listed twice — e.g. an overlapping period or a statement uploaded twice — not
 * a real duplicate. Collapse them so only genuinely different amounts count as
 * an ambiguous "duplicate ref".
 */
export function distinctByAmount<T extends { amt: number }>(rows: T[]): T[] {
  const seen = new Set<number>();
  const out: T[] = [];
  for (const r of rows) {
    if (seen.has(r.amt)) continue;
    seen.add(r.amt);
    out.push(r);
  }
  return out;
}

export function runAutoCheck(
  orders: Order[],
  statements: BankStatement[],
  actor: User,
  visibleIds: Set<string>
): { orders: Order[]; outcomes: AutoOutcome[] } {
  const outcomes: AutoOutcome[] = [];

  // Index the statements once, SCOPED BY CURRENCY so a payment only ever matches
  // a bank credit in its own currency. Key = "<currency>|<normalized ref>". A ref
  // is *claimed* by the first payment that matches it and then removed, so a
  // single bank credit can only ever verify one payment — the rest "collision".
  const byRef = new Map<string, number[]>();
  for (const s of statements) {
    // Payout exports are money going OUT to DSRs — never a customer payment.
    // They settle commission instead (see lib/commissionAuto.ts).
    if (s.kind === "payouts") continue;
    const cur = s.currency ?? "RWF";
    for (const row of s.rows) {
      const key = cur + "|" + norm(row.ref);
      const amts = byRef.get(key);
      if (!amts) byRef.set(key, [row.amt]);
      else if (!amts.includes(row.amt)) amts.push(row.amt);
    }
  }
  // Every ref the statements ever held — used to tell "never in any statement"
  // apart from "already matched to an earlier payment".
  const everSeen = new Set(byRef.keys());

  const updated = orders.map((order) => {
    if (!visibleIds.has(order.id)) return order;
    if (!order.confirmedOk) return order;

    const cur = order.currency ?? "RWF";
    let changed = false;
    const extraHistory: string[] = [];

    const payments = order.payments.map((p) => {
      if (p.verified) return p;
      if (p.voided) return p; // Admin-rejected — never auto-re-verify.
      if (p.returnedForFix) return p; // with the seller to correct the id

      const key = cur + "|" + norm(p.ref);
      const avail = byRef.get(key);

      if (!avail) {
        // Ref not (or no longer) available.
        if (everSeen.has(key)) {
          outcomes.push({
            orderId: order.id,
            client: order.name,
            ref: p.ref,
            result: "collision",
            detail: "Ref already matched to an earlier payment",
          });
          changed = true;
          return { ...p, flag: "Ref already matched to another payment" };
        }
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

      // Claim the ref so no later payment can reuse the same bank credit.
      byRef.delete(key);

      if (avail.length > 1) {
        outcomes.push({
          orderId: order.id,
          client: order.name,
          ref: p.ref,
          result: "duplicate",
          detail: `Ref appears with ${avail.length} different amounts`,
        });
        changed = true;
        return { ...p, flag: "Duplicate ref" };
      }

      const bankAmt = avail[0];
      const base = {
        ...p,
        verified: true as const,
        verifiedBy: actor.email,
        verifiedOn: nowISO(),
        checkedRef: p.ref,
      };

      if (bankAmt === p.amt) {
        outcomes.push({
          orderId: order.id,
          client: order.name,
          ref: p.ref,
          result: "verified",
          detail: "Auto-verified from statement",
        });
        changed = true;
        return { ...base, comment: "Auto-verified from bank statement", flag: undefined, pendingApproval: undefined };
      }

      // Amounts differ. The bank statement is the source of truth, so the payment
      // is ALWAYS set to the statement amount and the recorded amount is discarded.
      // A material gap is flagged as an override so the Admin is notified (the
      // notify_order trigger fires on the "overridden" flag); a small gap is a
      // quiet correction.
      const was = p.amt;
      const large = amountNeedsReview(p.amt, bankAmt, cur);
      outcomes.push({
        orderId: order.id,
        client: order.name,
        ref: p.ref,
        result: "corrected",
        detail: large
          ? `Amount overridden ${was.toLocaleString()} → ${bankAmt.toLocaleString()} (statement) — Admin notified`
          : `Amount corrected ${was.toLocaleString()} → ${bankAmt.toLocaleString()}`,
      });
      extraHistory.push(
        `${nowISO()} — Payment ${p.ref} amount ${large ? "overridden" : "corrected"} from ${was.toLocaleString()} to ${bankAmt.toLocaleString()} ${cur} — used bank statement (auto, by ${actor.name})`
      );
      changed = true;
      return {
        ...base,
        amt: bankAmt,
        comment: "Auto-verified; amount adopted from bank statement",
        flag: large
          ? `Amount overridden: recorded ${cur} ${was.toLocaleString()} vs statement ${cur} ${bankAmt.toLocaleString()}`
          : `Amount corrected from ${was.toLocaleString()}`,
        pendingApproval: undefined,
      };
    });

    if (!changed) return order;
    return { ...order, payments, history: [...order.history, ...extraHistory] };
  });

  return { orders: updated, outcomes };
}


/**
 * Automatic settlement of DSR commission against an uploaded PAYOUTS bank
 * statement (pure).
 *
 * This is the mirror of lib/verification.ts, which verifies money coming IN
 * from customers by transaction id. Commission is money going OUT, and a payout
 * export usually carries the DSR's phone rather than a reference we recorded in
 * advance — so the match key here is (phone + exact amount) instead of a ref.
 * That key is weaker than a transaction id, so the rules are deliberately
 * tighter:
 *
 *  - Only a statement marked `kind: "payouts"` is ever considered. An incoming
 *    payment from a DSR who is also a customer can never settle their own
 *    commission.
 *  - Only requests a manager already INITIATED are settled. The statement is
 *    evidence that the money left, never authorisation to pay — so uploading a
 *    statement can never create a payout on its own.
 *  - The amount must equal the request total exactly. No tolerance: a payout
 *    that doesn't match to the franc is a human's problem.
 *  - Each statement row is claimed by at most one request, so a single bank
 *    debit can never settle two commission requests.
 *  - Two candidate rows for one request, or two candidate requests for one row,
 *    are held as "ambiguous" rather than guessed at.
 */

import { normalizePhone, nowISO } from "./format";
import type { BankStatement, CommissionRequest, DSR, Order, User } from "./types";

export type CommissionAutoResult = "paid" | "ambiguous" | "missing" | "no_phone" | "no_phone_column";

export interface CommissionAutoOutcome {
  requestId: string;
  dsrName: string;
  phone: string;
  amount: number;
  result: CommissionAutoResult;
  detail: string;
}

/** One usable row of a payouts statement, flattened and identified. */
interface PayoutRow {
  key: string; // statement id + row index — the claim identity
  phone: string; // normalized
  amt: number;
  ref: string;
  fileName: string;
  /** Parsed row date, when the statement had a date column we could read. */
  time: number | null;
}

/**
 * Statement dates are raw text from whatever the bank exported, so they are
 * parsed leniently: anything unreadable simply drops the date constraint for
 * that row rather than discarding a real payment.
 */
function rowTime(raw?: string): number | null {
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/** The payouts statements, flattened into claimable rows that carry a phone. */
function payoutRows(statements: BankStatement[]): PayoutRow[] {
  const out: PayoutRow[] = [];
  for (const s of statements) {
    if (s.kind !== "payouts") continue;
    s.rows.forEach((r, i) => {
      const phone = normalizePhone(r.phone ?? "");
      if (!phone) return;
      out.push({
        key: `${s.id}#${i}`,
        phone,
        amt: r.amt,
        ref: r.ref,
        fileName: s.fileName,
        time: rowTime(r.date),
      });
    });
  }
  return out;
}

/**
 * Settle initiated commission requests against payouts statements.
 *
 * Returns the updated requests and orders (only those that changed are
 * different objects, so callers can diff and write just those), plus one
 * outcome per request considered.
 */
export function runCommissionAutoCheck(
  requests: CommissionRequest[],
  dsrs: DSR[],
  statements: BankStatement[],
  orders: Order[],
  actor: User
): { requests: CommissionRequest[]; orders: Order[]; outcomes: CommissionAutoOutcome[] } {
  const outcomes: CommissionAutoOutcome[] = [];
  const rows = payoutRows(statements);
  const claimed = new Set<string>();
  const hasPayoutStatement = statements.some((s) => s.kind === "payouts");
  const phoneOf = new Map(dsrs.map((d) => [d.id, d.phone ?? ""]));

  // Oldest request first, so a settlement order is deterministic when two
  // requests could both match the same row.
  const pending = requests
    .filter((r) => r.status === "initiated")
    .slice()
    .sort((a, b) => (a.on < b.on ? -1 : 1));

  const settled = new Map<string, CommissionRequest>();
  const paidOrderIds = new Set<string>();

  for (const req of pending) {
    const phone = normalizePhone(phoneOf.get(req.dsrId) ?? "");

    if (!phone) {
      outcomes.push({
        requestId: req.id,
        dsrName: req.dsrName,
        phone: "—",
        amount: req.amount,
        result: "no_phone",
        detail: "This DSR has no phone number on their record — add one to match payouts.",
      });
      continue;
    }

    if (!hasPayoutStatement || rows.length === 0) {
      outcomes.push({
        requestId: req.id,
        dsrName: req.dsrName,
        phone,
        amount: req.amount,
        result: "no_phone_column",
        detail: hasPayoutStatement
          ? "The payouts statement has no phone column mapped — re-upload it and map the phone/receiver column."
          : "No payouts statement uploaded yet.",
      });
      continue;
    }

    // A payout cannot predate the request that authorised it. Rows with an
    // unreadable date are allowed through on amount + phone alone.
    const requestedAt = Date.parse(req.on);
    const candidates = rows.filter(
      (r) =>
        !claimed.has(r.key) &&
        r.phone === phone &&
        r.amt === req.amount &&
        (r.time === null || Number.isNaN(requestedAt) || r.time >= requestedAt - 86_400_000)
    );

    if (candidates.length === 0) {
      outcomes.push({
        requestId: req.id,
        dsrName: req.dsrName,
        phone,
        amount: req.amount,
        result: "missing",
        detail: "No payout in the statement for this phone and exact amount.",
      });
      continue;
    }

    if (candidates.length > 1) {
      outcomes.push({
        requestId: req.id,
        dsrName: req.dsrName,
        phone,
        amount: req.amount,
        result: "ambiguous",
        detail: `${candidates.length} payouts match this phone and amount — settle this one by hand.`,
      });
      continue;
    }

    const row = candidates[0];
    claimed.add(row.key);
    settled.set(req.id, {
      ...req,
      status: "approved",
      decidedBy: actor.email,
      decidedOn: nowISO(),
      statementRef: row.ref,
      statementFile: row.fileName,
    });
    req.orderIds.forEach((id) => paidOrderIds.add(id));
    outcomes.push({
      requestId: req.id,
      dsrName: req.dsrName,
      phone,
      amount: req.amount,
      result: "paid",
      detail: `Matched payout ${row.ref || "(no ref)"} in ${row.fileName} — marked paid.`,
    });
  }

  return {
    requests: requests.map((r) => settled.get(r.id) ?? r),
    orders: orders.map((o) =>
      paidOrderIds.has(o.id) ? { ...o, commReq: true, commPaid: true } : o
    ),
    outcomes,
  };
}

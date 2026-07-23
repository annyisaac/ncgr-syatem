/**
 * Tax reporting from the general ledger. PAYE / RSSB / Withholding are read
 * exactly from their payable accounts; VAT is an estimate from sales and
 * purchases (VAT isn't split at transaction time yet) — confirm with RRA/EBM.
 */

import { sumDebits, type JournalEntry } from "./accounting";

const round0 = (n: number) => Math.round(n);

/** Debit/credit totals on one account within [from,to] (posted only). */
export function accountMovement(entries: JournalEntry[], code: string, from?: string, to?: string): { debit: number; credit: number } {
  let debit = 0, credit = 0;
  for (const e of entries) {
    if (e.status !== "posted") continue;
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    for (const l of e.lines) {
      if (l.accountCode !== code) continue;
      debit += Number(l.debit) || 0;
      credit += Number(l.credit) || 0;
    }
  }
  return { debit: round0(debit), credit: round0(credit) };
}

/** Outstanding balance owed on a liability (credit − debit) up to `to`. */
export function payableBalance(entries: JournalEntry[], code: string, to?: string): number {
  const m = accountMovement(entries, code, undefined, to);
  return round0(m.credit - m.debit);
}

export interface PayableTaxLine { charged: number; paid: number; balance: number; }
/** For a statutory deduction account: amount charged (credits) and settled
 *  (debits) in the period, plus the total balance still owed to date. */
export function statutory(entries: JournalEntry[], code: string, from: string | undefined, to: string): PayableTaxLine {
  const period = accountMovement(entries, code, from, to);
  return { charged: period.credit, paid: period.debit, balance: payableBalance(entries, code, to) };
}

/** Total value of purchase bills posted in the period (input-VAT base). */
export function purchasesBase(entries: JournalEntry[], from?: string, to?: string): number {
  let total = 0;
  for (const e of entries) {
    if (e.status !== "posted" || e.source !== "purchasing") continue;
    if (!e.id.startsWith("je_pur_bill")) continue;
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    total += sumDebits(e);
  }
  return round0(total);
}

export interface VatResult { salesBase: number; outputVat: number; purchasesBase: number; inputVat: number; netVat: number; rate: number; }
export function vatReport(salesGross: number, purchases: number, rate: number, inclusive: boolean): VatResult {
  const outNet = inclusive ? salesGross / (1 + rate) : salesGross;
  const outputVat = round0(inclusive ? salesGross - outNet : salesGross * rate);
  const inNet = inclusive ? purchases / (1 + rate) : purchases;
  const inputVat = round0(inclusive ? purchases - inNet : purchases * rate);
  return { salesBase: round0(salesGross), outputVat, purchasesBase: round0(purchases), inputVat, netVat: round0(outputVat - inputVat), rate };
}

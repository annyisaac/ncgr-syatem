/**
 * Financial statements built from the general ledger (posted journal entries):
 * Income Statement (P&L), Balance Sheet, and a cash summary. Everything is
 * derived from the double-entry data — no separate bookkeeping.
 */

import type { Account, AccountType, JournalEntry } from "./accounting";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Net (debit − credit) per account code from posted entries within [from,to]. */
function nets(entries: JournalEntry[], from?: string, to?: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of entries) {
    if (e.status !== "posted") continue;
    if (from && e.date < from) continue;
    if (to && e.date > to) continue;
    for (const l of e.lines) m.set(l.accountCode, (m.get(l.accountCode) ?? 0) + (Number(l.debit) || 0) - (Number(l.credit) || 0));
  }
  return m;
}

export interface StmtLine { code: string; name: string; amount: number; }
export interface StmtGroup { type: string; lines: StmtLine[]; total: number; }

/** Build a statement group for the given account types, with amounts shown on
 *  the group's natural side (revenues/liabilities/equity positive as credits). */
function group(accounts: Account[], net: Map<string, number>, types: AccountType[], creditPositive: boolean, label: string): StmtGroup {
  const lines: StmtLine[] = [];
  for (const a of accounts) {
    if (!types.includes(a.type)) continue;
    const raw = net.get(a.code) ?? 0;
    const amount = round2(creditPositive ? -raw : raw);
    if (amount === 0) continue;
    lines.push({ code: a.code, name: a.name, amount });
  }
  lines.sort((a, b) => (a.code < b.code ? -1 : 1));
  return { type: label, lines, total: round2(lines.reduce((s, l) => s + l.amount, 0)) };
}

// ---- Income statement (P&L) ----------------------------------------------

export interface IncomeStatement {
  revenue: StmtGroup;
  costOfSales: StmtGroup;
  grossProfit: number;
  opex: StmtGroup;
  operatingProfit: number;
  otherIncome: StmtGroup;
  otherExpense: StmtGroup;
  netProfit: number;
}

export function incomeStatement(accounts: Account[], entries: JournalEntry[], from?: string, to?: string): IncomeStatement {
  const net = nets(entries, from, to);
  const revenue = group(accounts, net, ["Revenue"], true, "Revenue");
  const costOfSales = group(accounts, net, ["Cost of Sales"], false, "Cost of Sales");
  const opex = group(accounts, net, ["Operating Expense"], false, "Operating Expenses");
  const otherIncome = group(accounts, net, ["Other Income"], true, "Other Income");
  const otherExpense = group(accounts, net, ["Other Expense"], false, "Other Expenses");
  const grossProfit = round2(revenue.total - costOfSales.total);
  const operatingProfit = round2(grossProfit - opex.total);
  const netProfit = round2(operatingProfit + otherIncome.total - otherExpense.total);
  return { revenue, costOfSales, grossProfit, opex, operatingProfit, otherIncome, otherExpense, netProfit };
}

// ---- Balance sheet --------------------------------------------------------

export interface BalanceSheet {
  assets: StmtGroup;
  liabilities: StmtGroup;
  equity: StmtGroup;
  currentEarnings: number;
  totalAssets: number;
  totalLiabilitiesEquity: number;
  balanced: boolean;
}

export function balanceSheet(accounts: Account[], entries: JournalEntry[], asOf?: string): BalanceSheet {
  const net = nets(entries, undefined, asOf);
  const assets = group(accounts, net, ["Asset"], false, "Assets");
  const liabilities = group(accounts, net, ["Liability"], true, "Liabilities");
  const equity = group(accounts, net, ["Equity"], true, "Equity");
  // Current-period earnings (P&L up to asOf) belong to equity.
  const is = incomeStatement(accounts, entries, undefined, asOf);
  const currentEarnings = is.netProfit;
  const totalAssets = round2(assets.total);
  const totalLiabilitiesEquity = round2(liabilities.total + equity.total + currentEarnings);
  return { assets, liabilities, equity, currentEarnings, totalAssets, totalLiabilitiesEquity, balanced: Math.abs(totalAssets - totalLiabilitiesEquity) < 0.5 };
}

// ---- Cash summary ---------------------------------------------------------

const CASH_CODES = ["1000", "1010", "1100"];

export interface CashSummary { opening: number; inflow: number; outflow: number; closing: number; }

export function cashSummary(entries: JournalEntry[], from?: string, to?: string): CashSummary {
  let opening = 0, inflow = 0, outflow = 0;
  for (const e of entries) {
    if (e.status !== "posted") continue;
    for (const l of e.lines) {
      if (!CASH_CODES.includes(l.accountCode)) continue;
      const d = Number(l.debit) || 0, c = Number(l.credit) || 0;
      if (from && e.date < from) { opening += d - c; continue; }
      if (to && e.date > to) continue;
      inflow += d; outflow += c;
    }
  }
  return { opening: round2(opening), inflow: round2(inflow), outflow: round2(outflow), closing: round2(opening + inflow - outflow) };
}

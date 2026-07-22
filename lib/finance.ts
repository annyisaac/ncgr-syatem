/**
 * Finance helpers for the Accountant workspace.
 *
 * Expenses are a small finance-only ledger (its own table). The aggregation
 * helpers turn the existing sales data (orders, payments, commissions) plus
 * expenses into the numbers an accountant needs: revenue, cash collected,
 * receivables, commissions paid, expenses, and net position.
 */

import { getSupabase } from "./supabase";
import {
  balance,
  customerCredit,
  orderTotal,
  sameCustomer,
  type CommissionRequest,
  type Order,
  type Product,
} from "./types";

const inBrowser = () => typeof window !== "undefined";

export const EXPENSE_CATEGORIES = [
  "Supplies",
  "Spare parts",
  "Feed",
  "Salaries & wages",
  "Utilities",
  "Transport",
  "Rent",
  "Repairs & maintenance",
  "Other",
] as const;

export interface Expense {
  id: string;
  category: string;
  amount: number;
  date: string; // ISO date
  note?: string;
  by: string; // email
  on: string; // ISO datetime recorded
}

// ---- Expense storage (finance-only via RLS) ------------------------------

export async function listExpenses(): Promise<Expense[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase()
    .from("expenses")
    .select("data")
    .order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load expenses: ${error.message}`);
  return (data ?? []).map((r) => r.data as Expense);
}

export async function upsertExpense(e: Expense): Promise<void> {
  const { error } = await getSupabase()
    .from("expenses")
    .upsert({ id: e.id, data: e, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save expense: ${error.message}`);
}

export async function removeExpense(id: string): Promise<void> {
  const { error } = await getSupabase().from("expenses").delete().eq("id", id);
  if (error) throw new Error(`Could not delete expense: ${error.message}`);
}

// ---- Aggregation ----------------------------------------------------------

const live = (o: Order) => o.status !== "refunded" && o.status !== "rejected";
const verifiedPaid = (o: Order) =>
  o.payments.filter((p) => p.verified).reduce((s, p) => s + p.amt, 0);

export interface ProductLine {
  product: Product;
  revenue: number;
  collected: number;
  receivable: number;
  orders: number;
  chicks: number;
}

export interface FinanceSummary {
  revenue: number;        // billed value of live orders in range
  collected: number;      // verified payments on those orders
  receivable: number;     // outstanding balances (owed to us)
  commissionsPaid: number; // approved commission payouts in range
  expenses: number;       // recorded expenses in range
  net: number;            // collected − commissions − expenses (cash basis)
  grossMargin: number;    // revenue − commissions − expenses (accrual)
  creditHeld: number;     // customer credit we owe back (liability)
  orders: number;
  chicksSold: number;
  byProduct: ProductLine[];
}

const PRODUCTS: Product[] = ["Ross 308", "Tetra Super Harco"];

/** Everything the finance dashboard shows, for orders whose delivery date is in
 *  range (commissions/expenses filtered by their own dates). */
export function financeSummary(
  orders: Order[],
  commissions: CommissionRequest[],
  expenses: Expense[],
  inRange: (dateISO: string) => boolean
): FinanceSummary {
  const scoped = orders.filter((o) => live(o) && inRange(o.date));

  const byProduct: ProductLine[] = PRODUCTS.map((product) => {
    const list = scoped.filter((o) => o.product === product);
    return {
      product,
      revenue: list.reduce((s, o) => s + orderTotal(o), 0),
      collected: list.reduce((s, o) => s + verifiedPaid(o), 0),
      receivable: list.reduce((s, o) => s + Math.max(0, balance(o)), 0),
      orders: list.length,
      chicks: list.reduce((s, o) => s + (o.delivered ?? o.chicks), 0),
    };
  });

  const revenue = byProduct.reduce((s, p) => s + p.revenue, 0);
  const collected = byProduct.reduce((s, p) => s + p.collected, 0);
  const receivable = byProduct.reduce((s, p) => s + p.receivable, 0);

  const commissionsPaid = commissions
    .filter((c) => c.status === "approved" && inRange((c.decidedOn ?? c.on).slice(0, 10)))
    .reduce((s, c) => s + c.amount, 0);

  const expensesTotal = expenses
    .filter((e) => inRange(e.date))
    .reduce((s, e) => s + e.amount, 0);

  // Customer credit is a snapshot (money we hold), computed across all live
  // orders — one entry per distinct customer.
  const liveOrders = orders.filter(live);
  const seen: Order[] = [];
  let creditHeld = 0;
  for (const o of liveOrders) {
    if (seen.some((s) => sameCustomer(s, o))) continue;
    seen.push(o);
    creditHeld += customerCredit(liveOrders, o);
  }

  return {
    revenue,
    collected,
    receivable,
    commissionsPaid,
    expenses: expensesTotal,
    net: collected - commissionsPaid - expensesTotal,
    grossMargin: revenue - commissionsPaid - expensesTotal,
    creditHeld,
    orders: scoped.length,
    chicksSold: byProduct.reduce((s, p) => s + p.chicks, 0),
    byProduct,
  };
}

export function newExpenseId(): string {
  return `exp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

// ---- Profit & Loss --------------------------------------------------------

export interface PnL {
  revenue: number;
  commissions: number;
  grossProfit: number;
  expenseLines: { category: string; amount: number }[];
  totalExpenses: number;
  netProfit: number;
}

export function profitAndLoss(s: FinanceSummary, expenses: Expense[], inRange: (d: string) => boolean): PnL {
  const map = new Map<string, number>();
  for (const e of expenses.filter((x) => inRange(x.date))) {
    map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
  }
  const expenseLines = [...map.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  const totalExpenses = expenseLines.reduce((t, l) => t + l.amount, 0);
  const grossProfit = s.revenue - s.commissionsPaid;
  return {
    revenue: s.revenue,
    commissions: s.commissionsPaid,
    grossProfit,
    expenseLines,
    totalExpenses,
    netProfit: grossProfit - totalExpenses,
  };
}

// ---- Aged receivables (debtors) ------------------------------------------

const daysBetween = (fromISO: string, toISO: string) =>
  Math.max(0, Math.round((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000));

export interface DebtorRow {
  name: string;
  phone: string;
  total: number;
  d0_30: number;
  d31_60: number;
  d61_90: number;
  d90: number;
  oldestDays: number;
  orders: Order[];
}

export function agedReceivables(orders: Order[], today: string): { rows: DebtorRow[]; totals: Omit<DebtorRow, "name" | "phone" | "orders" | "oldestDays"> } {
  const owed = orders.filter((o) => live(o) && balance(o) > 0);
  const byCustomer = new Map<string, DebtorRow>();
  for (const o of owed) {
    const key = `${o.name.trim().toLowerCase()}|${o.phone.replace(/\D/g, "")}`;
    const bal = balance(o);
    const age = daysBetween(o.date, today);
    const row = byCustomer.get(key) ?? { name: o.name, phone: o.phone, total: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0, oldestDays: 0, orders: [] };
    row.total += bal;
    if (age <= 30) row.d0_30 += bal;
    else if (age <= 60) row.d31_60 += bal;
    else if (age <= 90) row.d61_90 += bal;
    else row.d90 += bal;
    row.oldestDays = Math.max(row.oldestDays, age);
    row.orders.push(o);
    byCustomer.set(key, row);
  }
  const rows = [...byCustomer.values()].sort((a, b) => b.total - a.total);
  const totals = rows.reduce(
    (t, r) => ({ total: t.total + r.total, d0_30: t.d0_30 + r.d0_30, d31_60: t.d31_60 + r.d31_60, d61_90: t.d61_90 + r.d61_90, d90: t.d90 + r.d90 }),
    { total: 0, d0_30: 0, d31_60: 0, d61_90: 0, d90: 0 }
  );
  return { rows, totals };
}

// ---- Monthly cash-flow series --------------------------------------------

export interface MonthPoint {
  key: string;   // "2026-07"
  label: string; // "Jul 26"
  moneyIn: number;
  moneyOut: number;
  net: number;
  running: number;
}

const monthKey = (iso: string) => iso.slice(0, 7);

export function monthlySeries(
  orders: Order[],
  commissions: CommissionRequest[],
  expenses: Expense[],
  months: number,
  today: string
): MonthPoint[] {
  const keys: string[] = [];
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00`);
  for (let i = months - 1; i >= 0; i--) {
    const dd = new Date(d.getFullYear(), d.getMonth() - i, 1);
    keys.push(`${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, "0")}`);
  }
  const inByMonth = new Map<string, number>();
  const outByMonth = new Map<string, number>();

  for (const o of orders.filter(live)) {
    for (const p of o.payments) {
      if (!p.verified) continue;
      const k = monthKey(p.on);
      inByMonth.set(k, (inByMonth.get(k) ?? 0) + p.amt);
    }
  }
  for (const c of commissions.filter((x) => x.status === "approved")) {
    const k = monthKey(c.decidedOn ?? c.on);
    outByMonth.set(k, (outByMonth.get(k) ?? 0) + c.amount);
  }
  for (const e of expenses) {
    const k = monthKey(e.date);
    outByMonth.set(k, (outByMonth.get(k) ?? 0) + e.amount);
  }

  let running = 0;
  return keys.map((key) => {
    const [y, m] = key.split("-");
    const label = new Date(Number(y), Number(m) - 1, 1).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    const moneyIn = inByMonth.get(key) ?? 0;
    const moneyOut = outByMonth.get(key) ?? 0;
    const net = moneyIn - moneyOut;
    running += net;
    return { key, label, moneyIn, moneyOut, net, running };
  });
}

// ---- VAT ------------------------------------------------------------------

export interface VatResult { base: number; rate: number; inclusive: boolean; net: number; vat: number; }

export function computeVat(amount: number, rate: number, inclusive: boolean): VatResult {
  if (inclusive) {
    const net = amount / (1 + rate);
    return { base: amount, rate, inclusive, net, vat: amount - net };
  }
  return { base: amount, rate, inclusive, net: amount, vat: amount * rate };
}

// ---- Customer statement ---------------------------------------------------

export interface CustomerStatement {
  name: string;
  phone: string;
  orders: Order[];
  totalBilled: number;
  totalPaid: number;
  balance: number;
  credit: number;
}

export function customerStatement(orders: Order[], ref: Pick<Order, "name" | "phone">): CustomerStatement {
  const theirs = orders.filter((o) => live(o) && sameCustomer(o, ref)).sort((a, b) => (a.date < b.date ? -1 : 1));
  const totalBilled = theirs.reduce((s, o) => s + orderTotal(o), 0);
  const totalPaid = theirs.reduce((s, o) => s + verifiedPaid(o), 0);
  return {
    name: ref.name,
    phone: ref.phone,
    orders: theirs,
    totalBilled,
    totalPaid,
    balance: theirs.reduce((s, o) => s + Math.max(0, balance(o)), 0),
    credit: customerCredit(orders, ref),
  };
}

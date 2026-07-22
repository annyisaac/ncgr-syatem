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

/**
 * Stock transfers, returns and logistics expenses — the remaining operational
 * movements Logistics records and submits, with Finance verifying and posting.
 *
 * Logistics records; the Operations Manager verifies; the Accountant/Admin
 * approves and posts. Nothing here writes to the ledger directly.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";
const round2 = (n: number) => Math.round(n * 100) / 100;
const rand = () => Math.random().toString(36).slice(2, 6);

// ---------------------------------------------------------------------------
// Stock transfers
// ---------------------------------------------------------------------------

export const TRANSFER_LOCATIONS = [
  "Parent Stock Farm", "Hatchery", "Main Store", "Department Store", "Delivery Vehicle", "Other location",
] as const;
export const TRANSFER_STATUSES = ["Requested", "Approved", "Issued", "In Transit", "Received", "Cancelled"] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export interface TransferLine { item: string; unit: string; requested: number; issued?: number; received?: number; damaged?: number; }
export const transferShortage = (l: TransferLine) => Math.max(0, (Number(l.issued ?? l.requested) || 0) - (Number(l.received) || 0) - (Number(l.damaged) || 0));

export interface StockTransfer {
  id: string;
  ref: string;          // TRF-0001
  from: string;
  to: string;
  reason?: string;
  lines: TransferLine[];
  tripId?: string;
  status: TransferStatus;
  requestedBy: string;
  on: string;
  approvedBy?: string;
  approvedOn?: string;
  history: string[];
}

// ---------------------------------------------------------------------------
// Returns
// ---------------------------------------------------------------------------

export const RETURN_SOURCES = ["Customer", "Driver", "Department", "Supplier"] as const;
export const RETURN_STATUSES = ["Open", "Under review", "Resolved", "Closed", "Cancelled"] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];
export const RETURN_RESOLUTIONS = ["Replacement", "Credit note", "Refund", "Restock", "Scrap"] as const;
export const RETURN_CONDITIONS = ["Good / resalable", "Damaged", "Dead", "Expired", "Wrong item"] as const;

export interface ReturnRecord {
  id: string;
  ref: string;          // RET-0001
  source: string;       // Customer | Driver | Department | Supplier
  orderId?: string;     // customer returns
  customerName?: string;
  supplierName?: string; // supplier returns
  poRef?: string;
  product?: string;
  quantity: number;
  reason?: string;
  condition?: string;
  tripId?: string;
  responsible?: string;
  financialEffect?: number; // RWF; sign per company policy
  resolution?: string;
  notifyFinance?: boolean;
  status: ReturnStatus;
  by: string;
  on: string;
  history: string[];
}

// ---------------------------------------------------------------------------
// Logistics expenses
// ---------------------------------------------------------------------------

export const LOGISTICS_EXPENSE_CATEGORIES = [
  "Fuel", "Vehicle hire", "Loading", "Offloading", "Driver allowance", "Parking",
  "Repairs", "Transport permit", "Accommodation", "Road expense", "Other",
] as const;
export const PAYMENT_METHODS = ["Cash", "Bank", "Mobile money"] as const;

/** Draft → Submitted → Verified (Ops) → Approved → Posted, or Rejected. */
export const EXPENSE_STATUSES = ["Draft", "Submitted", "Verified", "Approved", "Posted", "Rejected"] as const;
export type ExpenseStatus = (typeof EXPENSE_STATUSES)[number];
export const EXPENSE_PAYMENT_STATUSES = ["Unpaid", "Partially Paid", "Paid"] as const;

export interface LogisticsExpense {
  id: string;
  ref: string;          // LEX-0001
  date: string;
  category: string;
  tripId?: string;
  vehicleId?: string;
  amount: number;
  paymentMethod?: string;
  payee?: string;
  reason?: string;
  receiptRef?: string;
  costCentre?: string;
  batchOrOrder?: string;
  status: ExpenseStatus;
  paymentStatus?: string;
  submittedBy: string;
  on: string;
  verifiedBy?: string;
  approvedBy?: string;
  postedBy?: string;
  history: string[];
}

// ---------------------------------------------------------------------------
// Storage — jsonb-per-row
// ---------------------------------------------------------------------------

type OpsTable = "stock_transfers" | "returns" | "logistics_expenses";
async function listRows<T>(table: OpsTable): Promise<T[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from(table).select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return (data ?? []).map((r) => r.data as T);
}
async function saveRow(table: OpsTable, row: { id: string }): Promise<void> {
  const { error } = await getSupabase().from(table).upsert({ id: row.id, data: row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save ${table}: ${error.message}`);
}

export const listTransfers = () => listRows<StockTransfer>("stock_transfers");
export const upsertTransfer = (t: StockTransfer) => saveRow("stock_transfers", t);
export const listReturns = () => listRows<ReturnRecord>("returns");
export const upsertReturn = (r: ReturnRecord) => saveRow("returns", r);
export const listLogisticsExpenses = () => listRows<LogisticsExpense>("logistics_expenses");
export const upsertLogisticsExpense = (e: LogisticsExpense) => saveRow("logistics_expenses", e);

export const newTransferId = () => `trf_${Date.now().toString(36)}_${rand()}`;
export const newReturnId = () => `ret_${Date.now().toString(36)}_${rand()}`;
export const newLogisticsExpenseId = () => `lex_${Date.now().toString(36)}_${rand()}`;

export const expenseTotal = (list: Pick<LogisticsExpense, "amount">[]) => round2(list.reduce((s, e) => s + (Number(e.amount) || 0), 0));

export function stamp(actor: string, action: string): string {
  return `${new Date().toISOString()} · ${actor} · ${action}`;
}
export function nextRef(prefix: string, existing: { ref: string }[]): string {
  let max = 0;
  for (const r of existing) { const m = /(\d+)\s*$/.exec(r.ref ?? ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

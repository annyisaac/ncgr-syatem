/**
 * Procurement chain — the upstream half of purchasing that Logistics owns:
 *   Purchase Request → Quotations → Purchase Order → Goods Received Note
 * ending in a three-way match and a handoff to the Accountant, who records the
 * supplier bill and runs payment (see lib/purchasing.ts for the AP side).
 *
 * Logistics records and submits; approvals are made by the Operations Manager
 * or Admin; Finance verifies and posts. Nothing here writes to the ledger.
 *
 * Documents are captured as references (name + note), matching how bank
 * statements are handled elsewhere — the binary isn't stored.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";
const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Purchase requests (+ embedded quotations)
// ---------------------------------------------------------------------------

export const PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const UNITS = ["pcs", "kg", "litres", "bags", "boxes", "trays", "rolls", "sets", "hours", "trips"] as const;

/** submitted → approved (visible to Logistics for sourcing) → ordered → closed. */
export type PRStatus = "draft" | "submitted" | "approved" | "rejected" | "ordered" | "closed";

export interface PRItem { description: string; quantity: number; unit: string; }

export interface Quotation {
  id: string;
  supplierName: string;
  supplierId?: string;
  price: number;        // goods subtotal
  tax: number;
  transport: number;
  deliveryDays?: number;
  paymentTerms?: string;
  docRef?: string;      // quotation document reference
  note?: string;
  on: string;
}
export const quoteTotal = (q: Pick<Quotation, "price" | "tax" | "transport">) =>
  round2((Number(q.price) || 0) + (Number(q.tax) || 0) + (Number(q.transport) || 0));

export interface PurchaseRequest {
  id: string;
  ref: string;          // PR-0001
  department: string;
  items: PRItem[];
  requiredDate?: string;
  reason?: string;
  destination?: string;
  priority: Priority;
  docRef?: string;
  status: PRStatus;
  quotations: Quotation[];
  recommendedQuoteId?: string;
  requestedBy: string;
  on: string;
  decidedBy?: string;
  decidedOn?: string;
  decisionNote?: string; // rejection reason, returned to the requester
  history: string[];
}

// ---------------------------------------------------------------------------
// Purchase orders
// ---------------------------------------------------------------------------

export const PO_STATUSES = [
  "Draft", "Pending Approval", "Approved", "Sent to Supplier",
  "Partially Received", "Fully Received", "Cancelled", "Closed",
] as const;
export type POStatus = (typeof PO_STATUSES)[number];

export interface POLine { description: string; quantity: number; unit: string; unitPrice: number; taxPct?: number; }

export interface PurchaseOrder {
  id: string;
  ref: string;          // PO-0001
  requestId?: string;
  requestRef?: string;
  supplierId?: string;
  supplierName: string;
  lines: POLine[];
  transport: number;
  currency: string;
  deliveryDate?: string;
  deliveryLocation?: string;
  paymentTerms?: string;
  status: POStatus;
  docRef?: string;
  createdBy: string;
  on: string;
  approvedBy?: string;
  approvedOn?: string;
  history: string[];
}

export const poLineTotal = (l: POLine) =>
  round2((Number(l.quantity) || 0) * (Number(l.unitPrice) || 0) * (1 + (Number(l.taxPct) || 0) / 100));
export const poTotal = (p: Pick<PurchaseOrder, "lines" | "transport">) =>
  round2(p.lines.reduce((s, l) => s + poLineTotal(l), 0) + (Number(p.transport) || 0));

// ---------------------------------------------------------------------------
// Goods received notes
// ---------------------------------------------------------------------------

export interface GRNLine {
  description: string;
  ordered: number;
  received: number;
  accepted: number;
  rejected: number;
  damaged: number;
  unitPrice: number;
  batch?: string;
  expiry?: string;
}

export interface GoodsReceipt {
  id: string;
  ref: string;          // GRN-0001
  poId: string;
  poRef: string;
  supplierName: string;
  receivedDate: string;
  deliveryNoteNo?: string;
  location?: string;
  deliveredBy?: string;
  receivedBy: string;
  lines: GRNLine[];
  invoiceNo?: string;
  invoiceAmount?: number;
  invoiceDocRef?: string;
  comments?: string;
  handedToFinance?: boolean;
  handedOn?: string;
  on: string;
  history: string[];
}

export const grnAcceptedValue = (g: Pick<GoodsReceipt, "lines">) =>
  round2(g.lines.reduce((s, l) => s + (Number(l.accepted) || 0) * (Number(l.unitPrice) || 0), 0));

/** How much of a PO has been received across all its GRNs (by accepted qty). */
export function poReceivedQty(poId: string, receipts: GoodsReceipt[]): number {
  return receipts.filter((g) => g.poId === poId).reduce((s, g) => s + g.lines.reduce((t, l) => t + (Number(l.accepted) || 0), 0), 0);
}
export function poOrderedQty(po: Pick<PurchaseOrder, "lines">): number {
  return po.lines.reduce((s, l) => s + (Number(l.quantity) || 0), 0);
}

// ---- Three-way match (PO ↔ GRN ↔ Invoice) --------------------------------

export type MatchState = "ok" | "flag" | "pending";
export interface MatchResult {
  state: MatchState;
  poValue: number;
  acceptedValue: number;
  invoiceValue: number;
  flags: string[];
}
/** Compare the approved PO, the goods actually accepted, and the supplier
 *  invoice; flag any material difference for Logistics to explain. */
export function threeWayMatch(po: PurchaseOrder | undefined, grn: GoodsReceipt): MatchResult {
  const poValue = po ? poTotal(po) : 0;
  const acceptedValue = grnAcceptedValue(grn);
  const invoiceValue = Number(grn.invoiceAmount) || 0;
  const flags: string[] = [];
  if (!grn.invoiceNo || invoiceValue <= 0) return { state: "pending", poValue, acceptedValue, invoiceValue, flags: ["Supplier invoice not entered"] };

  const tol = Math.max(1, invoiceValue * 0.02); // 2% tolerance
  if (Math.abs(invoiceValue - acceptedValue) > tol) flags.push(`Invoice ${invoiceValue.toLocaleString()} ≠ accepted goods ${acceptedValue.toLocaleString()}`);
  if (po && invoiceValue - poValue > tol) flags.push(`Invoice exceeds PO ${poValue.toLocaleString()}`);
  for (const l of grn.lines) {
    if ((Number(l.received) || 0) > (Number(l.ordered) || 0)) flags.push(`${l.description}: received more than ordered`);
    if ((Number(l.rejected) || 0) + (Number(l.damaged) || 0) > 0) flags.push(`${l.description}: ${(l.rejected || 0) + (l.damaged || 0)} rejected/damaged`);
  }
  return { state: flags.length ? "flag" : "ok", poValue, acceptedValue, invoiceValue, flags };
}

// ---------------------------------------------------------------------------
// Storage — jsonb-per-row
// ---------------------------------------------------------------------------

type ProcTable = "purchase_requests" | "purchase_orders" | "goods_receipts";
async function listRows<T>(table: ProcTable): Promise<T[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from(table).select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return (data ?? []).map((r) => r.data as T);
}
async function saveRow(table: ProcTable, row: { id: string }): Promise<void> {
  const { error } = await getSupabase().from(table).upsert({ id: row.id, data: row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save ${table}: ${error.message}`);
}

export const listRequests = () => listRows<PurchaseRequest>("purchase_requests");
export const upsertRequest = (r: PurchaseRequest) => saveRow("purchase_requests", r);
export const listPurchaseOrders = () => listRows<PurchaseOrder>("purchase_orders");
export const upsertPurchaseOrder = (p: PurchaseOrder) => saveRow("purchase_orders", p);
export const listReceipts = () => listRows<GoodsReceipt>("goods_receipts");
export const upsertReceipt = (g: GoodsReceipt) => saveRow("goods_receipts", g);

// ---- ids & sequential refs ------------------------------------------------

const rand = () => Math.random().toString(36).slice(2, 6);
export const newRequestId = () => `pr_${Date.now().toString(36)}_${rand()}`;
export const newQuoteId = () => `q_${Date.now().toString(36)}_${rand()}`;
export const newPoId = () => `po_${Date.now().toString(36)}_${rand()}`;
export const newGrnId = () => `grn_${Date.now().toString(36)}_${rand()}`;

/** Next human ref like PR-0007 from the existing rows. */
export function nextRef(prefix: string, existing: { ref: string }[]): string {
  let max = 0;
  for (const r of existing) {
    const m = /(\d+)\s*$/.exec(r.ref ?? "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}

export function stamp(actor: string, action: string): string {
  return `${new Date().toISOString()} · ${actor} · ${action}`;
}

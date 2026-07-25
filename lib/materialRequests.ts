/**
 * Materials & spare-parts requests.
 *
 * A department raises a request; it routes Logistics → Admin → Finance for
 * approval, Logistics confirms the payment once the items are bought, and
 * Finance files the record:
 *
 *   Requested → Logistics approved → Admin approved → Finance authorized
 *             → Paid (Logistics confirms) → Filed (Finance keeps)
 *
 * Any approver can reject, returning it to the requester with a reason.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";

export const MSR_TYPES = ["Materials", "Spare parts"] as const;
export const MSR_PRIORITIES = ["Low", "Normal", "High", "Urgent"] as const;
export const MSR_PAYMENT_METHODS = ["Cash", "Bank", "Mobile money"] as const;
export const MSR_UNITS = ["pcs", "sets", "kg", "litres", "metres", "rolls", "boxes", "pairs"] as const;

export const MSR_STATUSES = [
  "Requested", "Logistics approved", "Admin approved", "Finance authorized", "Paid", "Filed", "Rejected",
] as const;
export type MSRStatus = (typeof MSR_STATUSES)[number];

export interface MSRItem { name: string; quantity: number; unit: string; note?: string; }
export interface MSRPayment { amount: number; method: string; ref?: string; supplier?: string; by: string; on: string; }

export interface MaterialRequest {
  id: string;
  ref: string;            // MSR-0001
  type: string;           // Materials | Spare parts
  department?: string;
  forItem?: string;       // machine / area the parts are for
  items: MSRItem[];
  reason?: string;
  priority: string;
  status: MSRStatus;
  requestedBy: string;
  requestedByName?: string;
  on: string;
  logisticsBy?: string;
  logisticsOn?: string;
  adminBy?: string;
  adminOn?: string;
  financeBy?: string;
  financeOn?: string;
  payment?: MSRPayment;
  receivedToStock?: boolean; // items added to inventory / spare parts on payment
  filedBy?: string;
  filedOn?: string;
  decisionNote?: string;  // rejection reason
  history: string[];
}

// ---- Flow helpers ---------------------------------------------------------

/** The next status when the current stage is approved. */
export const NEXT_STATUS: Partial<Record<MSRStatus, MSRStatus>> = {
  "Requested": "Logistics approved",
  "Logistics approved": "Admin approved",
  "Admin approved": "Finance authorized",
  "Finance authorized": "Paid",
  "Paid": "Filed",
};

/** Who advances each stage. */
export function whoActs(status: MSRStatus): "logistics" | "admin" | "finance" | null {
  switch (status) {
    case "Requested": return "logistics";        // Logistics approves
    case "Logistics approved": return "admin";    // Admin approves
    case "Admin approved": return "finance";      // Finance authorises
    case "Finance authorized": return "logistics"; // Logistics confirms payment
    case "Paid": return "finance";                // Finance files
    default: return null;
  }
}

export const isOpen = (r: MaterialRequest) => r.status !== "Filed" && r.status !== "Rejected";

// ---- Storage --------------------------------------------------------------

export async function listMaterialRequests(): Promise<MaterialRequest[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("material_requests").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load material requests: ${error.message}`);
  return (data ?? []).map((r) => r.data as MaterialRequest);
}
export async function upsertMaterialRequest(r: MaterialRequest): Promise<void> {
  const { error } = await getSupabase().from("material_requests").upsert({ id: r.id, data: r, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save material request: ${error.message}`);
}

export const newMaterialRequestId = () => `msr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export function nextRef(existing: { ref: string }[]): string {
  let max = 0;
  for (const r of existing) { const m = /(\d+)\s*$/.exec(r.ref ?? ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `MSR-${String(max + 1).padStart(4, "0")}`;
}
export function stamp(actor: string, action: string): string {
  return `${new Date().toISOString()} · ${actor} · ${action}`;
}

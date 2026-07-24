/**
 * Parent Stock — farm inventory, stock movements and requisitions.
 *
 * Covers feed, vaccines, medicines, chemicals, cleaning materials, PPE,
 * consumables and spare parts. Movements (receipt, issue, wastage, transfer,
 * return, adjustment) keep each item's balance current; a low-stock flag
 * fires at the reorder level. Requisitions are raised and the Parent Stock
 * Manager approves internal requests, which issue stock.
 *
 * Feed consumption and water are read from the daily logs, so feed-per-bird
 * and feed cost need no re-entry.
 */

import { getSupabase } from "./supabase";
import type { DailyLog } from "./psDaily";
import type { BreederFlock } from "./parentStock";

const inBrowser = () => typeof window !== "undefined";
const round1 = (n: number) => Math.round(n * 10) / 10;

export const INVENTORY_CATEGORIES = [
  "Feed", "Vaccine", "Medicine", "Chemical", "Cleaning material", "PPE", "Consumable", "Spare part", "Other",
] as const;

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  currentStock: number;
  reorderLevel?: number;
  unitCost?: number;
  active: boolean;
  by: string;
  on: string;
}

export const MOVE_TYPES = ["Receipt", "Issue", "Transfer out", "Wastage", "Return", "Adjustment"] as const;
export type MoveType = (typeof MOVE_TYPES)[number];

export interface StockMove {
  id: string;
  itemId: string;
  itemName: string;
  type: MoveType;
  quantity: number;     // positive; sign is applied by type (Adjustment may be negative)
  flockId?: string;
  flockCode?: string;
  date: string;
  reason?: string;
  unitCost?: number;
  by: string;
  on: string;
}

/** How a movement changes the item balance. */
export function moveEffect(m: Pick<StockMove, "type" | "quantity">): number {
  const q = Number(m.quantity) || 0;
  switch (m.type) {
    case "Receipt": case "Return": return q;
    case "Issue": case "Transfer out": case "Wastage": return -q;
    case "Adjustment": return q; // enter a negative quantity to reduce
  }
}

export const REQUISITION_STATUSES = ["Requested", "Approved", "Issued", "Rejected"] as const;
export type RequisitionStatus = (typeof REQUISITION_STATUSES)[number];

export interface Requisition {
  id: string;
  ref: string;          // REQ-0001
  itemId?: string;
  itemName: string;
  category?: string;
  quantity: number;
  unit?: string;
  reason?: string;
  status: RequisitionStatus;
  requestedBy: string;
  on: string;
  decidedBy?: string;
  decidedOn?: string;
  history: string[];
}

// ---- Alerts / feed metrics ------------------------------------------------

export const isLow = (i: InventoryItem) =>
  i.active && i.reorderLevel != null && i.currentStock <= i.reorderLevel;

export interface FeedWater {
  feedKg: number; waterL: number; birds: number;
  feedPerBird: number; waterPerBird: number; feedCost: number;
}
/** Feed & water consumed from the daily logs, with per-bird figures and feed
 *  cost at the average feed unit cost. */
export function feedWaterSummary(logs: DailyLog[], flocks: BreederFlock[], items: InventoryItem[]): FeedWater {
  const feedKg = logs.reduce((s, l) => s + (Number(l.feedKg) || 0), 0);
  const waterL = logs.reduce((s, l) => s + (Number(l.waterL) || 0), 0);
  const birds = flocks.filter((f) => f.active && f.stage !== "Depleted").reduce((s, f) => s + (f.currentPopulation || 0), 0);
  const feedItems = items.filter((i) => i.category === "Feed" && i.unitCost);
  const feedUnitCost = feedItems.length ? feedItems.reduce((s, i) => s + (i.unitCost || 0), 0) / feedItems.length : 0;
  return {
    feedKg: round1(feedKg), waterL: round1(waterL), birds,
    feedPerBird: birds > 0 ? round1(feedKg / birds) : 0,
    waterPerBird: birds > 0 ? round1(waterL / birds) : 0,
    feedCost: Math.round(feedKg * feedUnitCost),
  };
}

// ---- Storage --------------------------------------------------------------

type Tbl = "ps_inventory" | "ps_stock_moves" | "ps_requisitions";
async function listRows<T>(t: Tbl): Promise<T[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from(t).select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load ${t}: ${error.message}`);
  return (data ?? []).map((r) => r.data as T);
}
async function saveRow(t: Tbl, row: { id: string }): Promise<void> {
  const { error } = await getSupabase().from(t).upsert({ id: row.id, data: row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save ${t}: ${error.message}`);
}

export const listItems = () => listRows<InventoryItem>("ps_inventory");
export const upsertItem = (i: InventoryItem) => saveRow("ps_inventory", i);
export const listMoves = () => listRows<StockMove>("ps_stock_moves");
export const upsertMove = (m: StockMove) => saveRow("ps_stock_moves", m);
export const listRequisitions = () => listRows<Requisition>("ps_requisitions");
export const upsertRequisition = (r: Requisition) => saveRow("ps_requisitions", r);

export const newItemId = () => `psi_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export const newMoveId = () => `psm_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export const newRequisitionId = () => `psr_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function nextRef(prefix: string, existing: { ref: string }[]): string {
  let max = 0;
  for (const r of existing) { const m = /(\d+)\s*$/.exec(r.ref ?? ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
export function stamp(actor: string, action: string): string {
  return `${new Date().toISOString()} · ${actor} · ${action}`;
}

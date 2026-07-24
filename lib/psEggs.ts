/**
 * Parent Stock — fertile-egg inventory and transfers to the hatchery.
 *
 * Hatchable eggs recorded in the daily logs build the farm's fertile-egg
 * balance; an egg transfer order dispatches trays to the hatchery (with the
 * vehicle and driver from Logistics), reducing that balance and awaiting a
 * receiving confirmation that closes the loop.
 */

import { getSupabase } from "./supabase";
import type { DailyLog } from "./psDaily";

const inBrowser = () => typeof window !== "undefined";

export const EGG_TRANSFER_STATUSES = ["Draft", "Dispatched", "Received", "Cancelled"] as const;
export type EggTransferStatus = (typeof EGG_TRANSFER_STATUSES)[number];

export interface EggTransfer {
  id: string;
  ref: string;              // ETO-0001
  date: string;
  houseId?: string;         // source production house
  houseName?: string;
  hatcheryBatchRef?: string; // hatchery batch these eggs join
  trays: number;
  eggsPerTray: number;
  eggQuantity: number;      // total eggs (trays × eggsPerTray, or entered)
  vehicleId?: string;       // Logistics vehicle
  vehicleLabel?: string;
  driverId?: string;        // Logistics driver
  driverLabel?: string;
  dispatchTime?: string;
  status: EggTransferStatus;
  receivedBy?: string;
  receivedAt?: string;
  receivedQuantity?: number;
  notes?: string;
  by: string;
  on: string;
  history: string[];
}

/** Eggs counted as gone from the farm once dispatched (or received). */
const countsOut = (t: EggTransfer) => t.status === "Dispatched" || t.status === "Received";

export interface FertileBalance { produced: number; transferred: number; available: number; }
/** Farm fertile-egg balance: hatchable eggs produced (daily logs) minus what
 *  has been dispatched to the hatchery. */
export function fertileBalance(dailyLogs: DailyLog[], transfers: EggTransfer[]): FertileBalance {
  const produced = dailyLogs.reduce((s, l) => s + (Number(l.hatchableEggs) || 0), 0);
  const transferred = transfers.filter(countsOut).reduce((s, t) => s + (Number(t.eggQuantity) || 0), 0);
  return { produced, transferred, available: Math.max(0, produced - transferred) };
}

// ---- Storage --------------------------------------------------------------

export async function listEggTransfers(): Promise<EggTransfer[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("ps_egg_transfers").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load egg transfers: ${error.message}`);
  return (data ?? []).map((r) => r.data as EggTransfer);
}
export async function upsertEggTransfer(t: EggTransfer): Promise<void> {
  const { error } = await getSupabase().from("ps_egg_transfers").upsert({ id: t.id, data: t, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save egg transfer: ${error.message}`);
}

export const newEggTransferId = () => `pse_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export function nextRef(prefix: string, existing: { ref: string }[]): string {
  let max = 0;
  for (const r of existing) { const m = /(\d+)\s*$/.exec(r.ref ?? ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
export function stamp(actor: string, action: string): string {
  return `${new Date().toISOString()} · ${actor} · ${action}`;
}

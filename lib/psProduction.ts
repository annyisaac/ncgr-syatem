/**
 * Parent Stock — production houses & male transfers.
 *
 * Males are reared separately, then transferred into a female production house
 * per the breeding program. A transfer reduces the male flock and grows the
 * house's male population; the female population is the linked female flock's
 * live count. The male:female ratio is watched against company standards.
 */

import { getSupabase } from "./supabase";
import type { BreederFlock } from "./parentStock";

const inBrowser = () => typeof window !== "undefined";
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Company breeding standard: roughly one male per 9–10 females (≈8–12% males). */
export const RATIO_MIN_MALE_PCT = 8;
export const RATIO_MAX_MALE_PCT = 12;

export interface ProductionHouse {
  id: string;
  name: string;
  femaleFlockId?: string;
  femaleFlockCode?: string;
  malePopulation: number;   // accumulated from transfers in
  fertilityPct?: number;    // latest measured fertility (from candling)
  hatchabilityPct?: number; // latest measured hatchability
  active: boolean;
  by: string;
  on: string;
  history: string[];
}

export interface MaleTransfer {
  id: string;
  ref: string;              // TRF-M-0001
  maleFlockId: string;
  maleFlockCode: string;
  houseId: string;
  houseName: string;
  date: string;
  quantity: number;         // males that arrived alive
  mortality: number;        // died in transit
  reason?: string;
  by: string;
  on: string;
}

// ---- Ratio -----------------------------------------------------------------

export interface RatioResult { females: number; males: number; malePct: number; ratioLabel: string; state: "ok" | "low" | "high" | "none"; }
export function houseRatio(house: ProductionHouse, femaleFlock: BreederFlock | undefined): RatioResult {
  const females = femaleFlock?.currentPopulation ?? 0;
  const males = house.malePopulation || 0;
  if (females <= 0 || males <= 0) return { females, males, malePct: 0, ratioLabel: "—", state: "none" };
  const malePct = round1((males / females) * 100);
  const ratioLabel = `1 : ${round1(females / males)}`;
  const state = malePct < RATIO_MIN_MALE_PCT ? "low" : malePct > RATIO_MAX_MALE_PCT ? "high" : "ok";
  return { females, males, malePct, ratioLabel, state };
}

// ---- Storage --------------------------------------------------------------

export async function listHouses(): Promise<ProductionHouse[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("ps_houses").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load production houses: ${error.message}`);
  return (data ?? []).map((r) => r.data as ProductionHouse);
}
export async function upsertHouse(h: ProductionHouse): Promise<void> {
  const { error } = await getSupabase().from("ps_houses").upsert({ id: h.id, data: h, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save production house: ${error.message}`);
}

export async function listTransfers(): Promise<MaleTransfer[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("ps_transfers").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load transfers: ${error.message}`);
  return (data ?? []).map((r) => r.data as MaleTransfer);
}
export async function upsertTransfer(t: MaleTransfer): Promise<void> {
  const { error } = await getSupabase().from("ps_transfers").upsert({ id: t.id, data: t, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save transfer: ${error.message}`);
}

export const newHouseId = () => `psh_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export const newTransferId = () => `pst_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function nextRef(prefix: string, existing: { ref: string }[]): string {
  let max = 0;
  for (const r of existing) { const m = /(\d+)\s*$/.exec(r.ref ?? ""); if (m) max = Math.max(max, parseInt(m[1], 10)); }
  return `${prefix}-${String(max + 1).padStart(4, "0")}`;
}
export function stamp(actor: string, action: string): string {
  return `${new Date().toISOString()} · ${actor} · ${action}`;
}

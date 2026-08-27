/**
 * Parent Stock (breeder farm) — male and female breeder flocks, production
 * houses, fertile-egg production, and the costs that flow to Finance.
 *
 * Male and female flocks are managed separately through rearing; selected
 * males are later transferred into female production houses per the breeding
 * program (a later phase). Phase 1 is the breeder-flock register.
 */

import { getSupabase } from "./supabase";

const inBrowser = () => typeof window !== "undefined";
const round1 = (n: number) => Math.round(n * 10) / 10;

/** Common parent-line breeds; the field is free text so others can be entered. */
export const PS_BREEDS = ["Ross 308", "Tetra Super Harco", "Sasso", "Kuroiler", "Other"] as const;

export type Sex = "Male" | "Female";
/** Rearing → Production (in lay / breeding) → Depleted (flock ended). */
export const PS_STAGES = ["Rearing", "Production", "Depleted"] as const;
export type FlockStage = (typeof PS_STAGES)[number];

export interface BreederFlock {
  id: string;
  code: string;              // flock ID, e.g. PS-M-2026-01
  sex: Sex;
  placementId?: string;      // links the male & female flocks placed together
  breed: string;
  supplier?: string;
  hatchDate?: string;        // ISO date
  placementDate?: string;    // ISO date placed on this farm
  house?: string;
  initialPopulation: number;
  currentPopulation: number; // updated by daily mortality and male transfers
  transferredOut?: number;   // males cumulatively moved out to production houses (incl. transfer mortality)
  bodyWeightG?: number;      // latest average body weight (grams)
  uniformityPct?: number;    // latest uniformity %
  laying?: boolean;          // females: laying has begun
  lastGradedOn?: string;     // ISO date the flock was last graded for uniformity
  photostimOn?: string;      // ISO date of first light stimulation (photostimulation)
  stage: FlockStage;
  notes?: string;
  active: boolean;
  by: string;
  on: string;
  history: string[];
}

// ---- Derived metrics ------------------------------------------------------

const weeksBetween = (fromISO: string, toISO: string) =>
  Math.max(0, Math.floor((Date.parse(toISO) - Date.parse(fromISO)) / (7 * 86_400_000)));

/** Flock age in weeks from hatch (falls back to placement). */
export function ageWeeks(f: Pick<BreederFlock, "hatchDate" | "placementDate">, todayISO: string): number | null {
  const from = f.hatchDate || f.placementDate;
  return from ? weeksBetween(from, todayISO) : null;
}

/** Birds lost since placement (initial − current), and that as a %. */
export const depletion = (f: Pick<BreederFlock, "initialPopulation" | "currentPopulation">) =>
  Math.max(0, (f.initialPopulation || 0) - (f.currentPopulation || 0));
export const depletionPct = (f: Pick<BreederFlock, "initialPopulation" | "currentPopulation">) =>
  f.initialPopulation > 0 ? round1((depletion(f) / f.initialPopulation) * 100) : 0;

export interface FlockTotals { flocks: number; birds: number; }
export function totalsForSex(flocks: BreederFlock[], sex: Sex): FlockTotals {
  const live = flocks.filter((f) => f.active && f.sex === sex && f.stage !== "Depleted");
  return { flocks: live.length, birds: live.reduce((s, f) => s + (f.currentPopulation || 0), 0) };
}

/** Weighted-average body weight across a set of flocks (by population). */
export function avgBodyWeight(flocks: BreederFlock[]): number {
  let w = 0, n = 0;
  for (const f of flocks) { if (f.bodyWeightG && f.currentPopulation) { w += f.bodyWeightG * f.currentPopulation; n += f.currentPopulation; } }
  return n > 0 ? Math.round(w / n) : 0;
}

// ---- Storage --------------------------------------------------------------

export async function listFlocks(): Promise<BreederFlock[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("ps_flocks").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load breeder flocks: ${error.message}`);
  return (data ?? []).map((r) => r.data as BreederFlock);
}
export async function upsertFlock(f: BreederFlock): Promise<void> {
  const { error } = await getSupabase().from("ps_flocks").upsert({ id: f.id, data: f, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save breeder flock: ${error.message}`);
}

export const newFlockId = () => `psf_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
/** Shared id tying together the male & female flocks placed in one delivery. */
export const newPlacementId = () => `psp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

export function stamp(actor: string, action: string): string {
  return `${new Date().toISOString()} · ${actor} · ${action}`;
}

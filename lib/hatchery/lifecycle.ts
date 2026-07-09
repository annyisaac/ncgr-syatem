/**
 * Batch lifecycle helpers & KPI calculations (pure).
 */

import { nowISO } from "../format";
import type { User } from "../types";
import {
  LIFECYCLE_STEPS,
  type Batch,
  type ChickInventory,
} from "./types";

/** Days between incubation set and expected hatch (standard 21 days). */
export const INCUBATION_DAYS = 21;
export const CANDLING_1_DAY = 10;
export const CANDLING_2_DAY = 18;

/** Add days to a yyyy-mm-dd date, returning yyyy-mm-dd. */
export function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function stepIndex(key: string): number {
  return LIFECYCLE_STEPS.findIndex((s) => s.key === key);
}

export function stepLabel(key: string): string {
  return LIFECYCLE_STEPS.find((s) => s.key === key)?.label ?? key;
}

export function nextStepKey(key: string): string | null {
  const i = stepIndex(key);
  if (i < 0 || i >= LIFECYCLE_STEPS.length - 1) return null;
  return LIFECYCLE_STEPS[i + 1].key;
}

/** Mark a step complete (records who/when) and advance currentStep to it. */
export function markStep(batch: Batch, stepKey: string, actor: User): Batch {
  const on = nowISO();
  return {
    ...batch,
    currentStep: stepKey,
    steps: { ...batch.steps, [stepKey]: { by: actor.email, on } },
    history: [
      ...batch.history,
      `${on} — ${stepLabel(stepKey)} (by ${actor.name})`,
    ],
  };
}

export function isStepDone(batch: Batch, stepKey: string): boolean {
  return !!batch.steps[stepKey];
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function fertilityPct(b: Batch): number {
  if (!b.eggCount) return 0;
  return (b.fertileCount / b.eggCount) * 100;
}

export function hatchabilityPct(b: Batch): number {
  const base = b.fertileCount || b.eggCount;
  if (!base) return 0;
  return (b.hatchedCount / base) * 100;
}

export function gradeAPct(b: Batch): number {
  if (!b.hatchedCount) return 0;
  return (b.gradeAcount / b.hatchedCount) * 100;
}

export function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

export interface HatcheryKpis {
  activeBatches: number;
  eggsSet: number;
  chicksHatched: number;
  hatchability: number; // %
  gradeA: number; // %
  sellableAvailable: number; // sum of current inventory
}

export function computeKpis(
  batches: Batch[],
  inventory: ChickInventory[]
): HatcheryKpis {
  const hatched = batches.filter((b) => b.hatchedCount > 0);
  return {
    activeBatches: batches.filter((b) => b.status === "active").length,
    eggsSet: batches.reduce((s, b) => s + (b.eggCount || 0), 0),
    chicksHatched: batches.reduce((s, b) => s + (b.hatchedCount || 0), 0),
    hatchability: avg(hatched.map(hatchabilityPct)),
    gradeA: avg(hatched.map(gradeAPct)),
    sellableAvailable: inventory.reduce((s, i) => s + (i.availableCount || 0), 0),
  };
}

// ---------------------------------------------------------------------------
// Machine reading range checks (out-of-range flags)
// ---------------------------------------------------------------------------

export const RANGES = {
  setter: { temp: [37.2, 37.8] as [number, number], humidity: [50, 60] as [number, number] },
  hatcher: { temp: [36.7, 37.5] as [number, number], humidity: [65, 75] as [number, number] },
};

export function isOutOfRange(
  machineId: "setter" | "hatcher",
  temp: number,
  humidity: number
): { temp: boolean; humidity: boolean } {
  const r = RANGES[machineId];
  return {
    temp: temp < r.temp[0] || temp > r.temp[1],
    humidity: humidity < r.humidity[0] || humidity > r.humidity[1],
  };
}

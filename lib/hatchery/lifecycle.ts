/** Batch lifecycle helpers, batch-code generation & KPIs (pure). */

import { nowISO } from "../format";
import type { Product, User } from "../types";
import {
  CHICKS_PER_BOX,
  INCUBATION_DAYS,
  LIFECYCLE_STEPS,
  MAX_MACHINE_TEMP_F,
  PRODUCT_CODE,
  type Batch,
  type BatchFlock,
  type Candling,
  type ChickInventory,
  type Machine,
  type MachineAssignment,
  type Reception,
} from "./types";

// ---------------------------------------------------------------------------
// Receptions
// ---------------------------------------------------------------------------

/** Settable eggs = received − cracked (farm+set) − misshapen − dirty. */
export function settableEggs(r: Reception): number {
  return Math.max(
    0,
    r.eggsReceived - r.crackedOnFarm - r.crackedOnSet - r.misshapen - r.dirty
  );
}

// ---------------------------------------------------------------------------
// Dates & batch code
// ---------------------------------------------------------------------------

export function addDays(dateIso: string, days: number): string {
  const d = new Date(dateIso + "T00:00:00");
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** ISO 8601 week number. */
export function isoWeek(dateIso: string): number {
  const d = new Date(dateIso + "T00:00:00");
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const firstDayNr = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNr + 3);
  return 1 + Math.round((target.getTime() - firstThursday.getTime()) / (7 * 864e5));
}

/** NCGR-H26-W29-02 (company · H+year · W+week · product code). */
export function batchCode(dateIso: string, product: Product): string {
  const d = new Date(dateIso + "T00:00:00");
  const yy = String(d.getFullYear()).slice(-2);
  const ww = String(isoWeek(dateIso)).padStart(2, "0");
  return `NCGR-H${yy}-W${ww}-${PRODUCT_CODE[product]}`;
}

export function expectedHatchDate(setDate: string): string {
  return addDays(setDate, INCUBATION_DAYS);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

export function stepIndex(key: string): number {
  return LIFECYCLE_STEPS.findIndex((s) => s.key === key);
}
export function stepLabel(key: string): string {
  return LIFECYCLE_STEPS.find((s) => s.key === key)?.label ?? key;
}
export function isStepDone(batch: Batch, key: string): boolean {
  return !!batch.steps[key];
}
export function nextStep(batch: Batch): { key: string; label: string } | undefined {
  return LIFECYCLE_STEPS.find((s) => !batch.steps[s.key]);
}
export function markStep(batch: Batch, key: string, actor: User): Batch {
  const on = nowISO();
  return {
    ...batch,
    currentStep: key,
    steps: { ...batch.steps, [key]: { by: actor.email, on } },
    history: [...batch.history, `${on} — ${stepLabel(key)} (by ${actor.name})`],
  };
}

// ---------------------------------------------------------------------------
// Candling & hatch maths
// ---------------------------------------------------------------------------

export function candlingTotal(cats: Record<string, number>): number {
  return Object.values(cats).reduce((s, n) => s + (Number(n) || 0), 0);
}

export function removedInStage(batch: Batch, stage: 1 | 2): number {
  return batch.candlings
    .filter((c) => c.stage === stage)
    .reduce((s, c) => s + c.totalRemoved, 0);
}

export function hasCandling(batch: Batch, stage: 1 | 2): boolean {
  return batch.candlings.some((c) => c.stage === stage);
}

// ---------------------------------------------------------------------------
// Per-flock candling & transfer (a batch/product can hold many flocks)
// ---------------------------------------------------------------------------

/**
 * The flocks in a batch. Legacy batches (set before multi-flock) have no
 * `flocks[]`, so we synthesise a single flock from the batch's own fields —
 * every reader keeps working.
 */
export function batchFlocks(b: Batch): BatchFlock[] {
  if (b.flocks && b.flocks.length) return b.flocks;
  return [
    {
      flockId: b.flockId,
      farm: b.farm,
      ageOfFlock: 0,
      receptionIds: b.receptionIds,
      eggsSet: b.eggsSet,
      candlings: b.candlings,
      transfers: b.transfers,
    },
  ];
}

export function flockRemoved(f: BatchFlock, stage: 1 | 2): number {
  return f.candlings.filter((c) => c.stage === stage).reduce((s, c) => s + c.totalRemoved, 0);
}
export function flockHasCandling(f: BatchFlock, stage: 1 | 2): boolean {
  return f.candlings.some((c) => c.stage === stage);
}
export function flockFertileAfterC1(f: BatchFlock): number {
  return f.eggsSet - flockRemoved(f, 1);
}
export function flockFertileAfterC2(f: BatchFlock): number {
  return flockFertileAfterC1(f) - flockRemoved(f, 2);
}
export function flockTransferred(f: BatchFlock): number {
  return f.transfers.reduce((s, a) => s + a.eggs, 0);
}
/** A flock is "done" with transfer once its fertile eggs are all assigned. */
export function flockTransferDone(f: BatchFlock): boolean {
  return flockFertileAfterC2(f) <= 0 || flockTransferred(f) >= flockFertileAfterC2(f);
}

/** Every flock in the batch has been candled at this stage. */
export function batchAllCandled(b: Batch, stage: 1 | 2): boolean {
  return batchFlocks(b).every((f) => flockHasCandling(f, stage));
}
/** Every flock's fertile eggs have been transferred. */
export function batchAllTransferred(b: Batch): boolean {
  return batchFlocks(b).every(flockTransferDone);
}

/**
 * Recompute the batch-level totals (eggsSet, candlings, transfers) from its
 * flocks, so batch-level readers (hatch, KPIs, machine capacity) stay correct.
 * Only touches batches that actually use `flocks[]`.
 */
export function recomputeBatchAggregates(b: Batch): Batch {
  if (!b.flocks || !b.flocks.length) return b;
  return {
    ...b,
    eggsSet: b.flocks.reduce((s, f) => s + f.eggsSet, 0),
    candlings: b.flocks.flatMap((f) => f.candlings),
    transfers: b.flocks.flatMap((f) => f.transfers),
  };
}

/** Unhatched = eggs set − candling1 − candling2 − hatched. */
export function unhatchedFrom(batch: Batch, hatched: number): number {
  return Math.max(
    0,
    batch.eggsSet - removedInStage(batch, 1) - removedInStage(batch, 2) - hatched
  );
}

/** Sanity check: set − C1 − C2 − unhatched === hatched. */
export function hatchBalances(batch: Batch): boolean {
  return (
    batch.eggsSet -
      removedInStage(batch, 1) -
      removedInStage(batch, 2) -
      batch.unhatchedCount ===
    batch.hatchedCount
  );
}

export function saleableFrom(hatched: number, culls: number): number {
  return Math.max(0, hatched - culls);
}

// ---------------------------------------------------------------------------
// Machines & capacity
// ---------------------------------------------------------------------------

export function isMachineOverTemp(...temps: number[]): boolean {
  return temps.some((t) => t > MAX_MACHINE_TEMP_F);
}

/** Eggs already assigned to a machine across all batches (for a given field). */
export function eggsInMachine(
  batches: Batch[],
  machineCode: string,
  field: "setters" | "transfers"
): number {
  return batches.reduce((sum, b) => {
    const list: MachineAssignment[] = b[field] ?? [];
    return sum + list.filter((a) => a.machineCode === machineCode).reduce((s, a) => s + a.eggs, 0);
  }, 0);
}

export function machineFreeCapacity(
  machine: Machine,
  batches: Batch[],
  field: "setters" | "transfers"
): number {
  return Math.max(0, machine.capacity - eggsInMachine(batches, machine.code, field));
}

// ---------------------------------------------------------------------------
// Boxes
// ---------------------------------------------------------------------------

export function boxesNeeded(chicks: number): number {
  return Math.ceil(chicks / CHICKS_PER_BOX);
}

// ---------------------------------------------------------------------------
// KPIs
// ---------------------------------------------------------------------------

export function fertilityPct(b: Batch): number {
  if (!b.eggsSet) return 0;
  const fertile = b.eggsSet - removedInStage(b, 1);
  return (fertile / b.eggsSet) * 100;
}
export function hatchabilityPct(b: Batch): number {
  const fertile = b.eggsSet - removedInStage(b, 1) - removedInStage(b, 2);
  if (fertile <= 0) return 0;
  return (b.hatchedCount / fertile) * 100;
}
function avg(nums: number[]): number {
  return nums.length ? nums.reduce((s, n) => s + n, 0) / nums.length : 0;
}

export interface HatcheryKpis {
  activeBatches: number;
  eggsSet: number;
  chicksHatched: number;
  hatchability: number;
  saleableAvailable: number;
}
export function computeKpis(batches: Batch[], inventory: ChickInventory[]): HatcheryKpis {
  const hatched = batches.filter((b) => b.hatchedCount > 0);
  return {
    activeBatches: batches.filter((b) => b.status === "active").length,
    eggsSet: batches.reduce((s, b) => s + (b.eggsSet || 0), 0),
    chicksHatched: batches.reduce((s, b) => s + (b.hatchedCount || 0), 0),
    hatchability: avg(hatched.map(hatchabilityPct)),
    saleableAvailable: inventory.reduce((s, i) => s + (i.availableCount || 0), 0),
  };
}

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

/** The ISO week-year of a date — the year that owns its ISO week. It rolls to
 *  the next year exactly when the week wraps from 52/53 back to 01, so it pairs
 *  correctly with isoWeek() at the December/January boundary. */
export function isoWeekYear(dateIso: string): number {
  const d = new Date(dateIso + "T00:00:00");
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3); // Thursday of this week
  return target.getUTCFullYear();
}

/**
 * Batch number: NCGR-H{year}-W{week}-{product}. Week is the ISO calendar week
 * (so a hatchery that sets weekly counts up W28, W29, …); at year end the week
 * wraps to W01 and H (the ISO week-year) increments. Suffix is the product
 * code — 01 Ross 308, 02 Tetra Super Harco. e.g. NCGR-H26-W29-02.
 */
export function batchCode(dateIso: string, product: Product): string {
  const yy = String(isoWeekYear(dateIso)).slice(-2);
  const ww = String(isoWeek(dateIso)).padStart(2, "0");
  return `NCGR-H${yy}-W${ww}-${PRODUCT_CODE[product]}`;
}

/** Pull the H (2-digit week-year) and W (week number) out of a batch number. */
function parseHW(batchNo: string): { h: number; w: number } | null {
  const m = /-H(\d+)-W(\d+)-/.exec(batchNo);
  return m ? { h: Number(m[1]), w: Number(m[2]) } : null;
}

/**
 * The batch number for a NEW set, counted sequentially:
 * - batches sharing a set date share a week (so the Ross "01" and Tetra "02" of
 *   one setting get the same W),
 * - otherwise it's the next week after the highest existing batch,
 * - past week 52 the H rolls over and the week restarts at 01,
 * - the very first batch ever anchors to its set date's ISO week.
 */
export function nextBatchNo(batches: Batch[], product: Product, setDate: string): string {
  const same = setDate ? batches.find((b) => b.setDate === setDate) : undefined;
  let h: number;
  let w: number;
  if (same && parseHW(same.batchNo)) {
    ({ h, w } = parseHW(same.batchNo)!);
  } else {
    let max: { h: number; w: number } | null = null;
    for (const b of batches) {
      const hw = parseHW(b.batchNo);
      if (hw && (!max || hw.h > max.h || (hw.h === max.h && hw.w > max.w))) max = hw;
    }
    if (!max) {
      h = Number(String(isoWeekYear(setDate)).slice(-2));
      w = isoWeek(setDate);
    } else if (max.w >= 52) {
      h = max.h + 1;
      w = 1;
    } else {
      h = max.h;
      w = max.w + 1;
    }
  }
  return `NCGR-H${String(h).padStart(2, "0")}-W${String(w).padStart(2, "0")}-${PRODUCT_CODE[product]}`;
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

/**
 * Eggs currently occupying a machine across all batches. The eggs move on and
 * free the machine: a **setter** is emptied once its batch has transferred to a
 * hatcher, a **hatcher** once its batch has hatched — so machines become
 * available again for the next batch.
 */
export function eggsInMachine(
  batches: Batch[],
  machineCode: string,
  field: "setters" | "transfers"
): number {
  return batches.reduce((sum, b) => {
    if (field === "setters" && b.steps["transfer"]) return sum; // eggs left the setter
    if (field === "transfers" && (b.steps["hatching"] || b.hatchedCount > 0)) return sum; // eggs hatched out
    if (b.status === "delivered" || b.status === "dispatched") return sum; // batch is done
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

/**
 * A machine is "active" while it holds eggs — setters from setting until the
 * eggs are transferred out, hatchers from transfer until the chicks hatch.
 * Given the machine codes touched by an operation and the already-updated
 * batches, return the machines whose active flag needs to change, ready to save.
 */
export function machinesToSync(
  machines: Machine[],
  codes: string[],
  batches: Batch[]
): Machine[] {
  const touched = new Set(codes);
  const changed: Machine[] = [];
  for (const m of machines) {
    if (!touched.has(m.code)) continue;
    const field = m.type === "setter" ? "setters" : "transfers";
    const active = eggsInMachine(batches, m.code, field) > 0;
    if (active !== m.active) changed.push({ ...m, active, on: new Date().toISOString() });
  }
  return changed;
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

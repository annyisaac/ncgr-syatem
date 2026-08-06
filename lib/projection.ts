/**
 * Batch → availability projection.
 *
 * When a batch is set, its chicks are expected on the delivery calendar
 * INCUBATION_DAYS (21) later, at DEFAULT_HATCH_RATE (80%) of the eggs set.
 * The projected number is adjustable per batch (Batch.projectedChicks) by the
 * Production Technician, Hatchery Manager or Admin. These projections are
 * summed per hatch date and published into the `availability` table so sales
 * can place orders against the expected chicks.
 */

import type { Batch } from "@/lib/hatchery/types";
import type { Availability, Product } from "@/lib/types";
import { todayISO } from "@/lib/format";

export const INCUBATION_DAYS = 21;
export const DEFAULT_HATCH_RATE = 0.8; // 80% of eggs set are expected to hatch
// Per-product default hatch rates (Ross and Tetra don't hatch identically).
// Edit here to change the projection default; a batch's own adjusted number wins.
export const ROSS_HATCH_RATE = 0.8;
export const TETRA_HATCH_RATE = 0.8;

export function hatchRateFor(product: Product): number {
  return product === "Ross 308" ? ROSS_HATCH_RATE : TETRA_HATCH_RATE;
}

/** The delivery date a batch's chicks become available: set date + 21 days. */
export function hatchDateOf(setDate: string): string {
  const d = new Date(setDate + "T00:00:00");
  d.setDate(d.getDate() + INCUBATION_DAYS);
  return d.toISOString().slice(0, 10);
}

/** Whole days from `from` (default today) until `dateISO` — negative once past. */
export function daysUntil(dateISO: string, from: string = todayISO()): number {
  const a = new Date(dateISO + "T00:00:00").getTime();
  const b = new Date(from + "T00:00:00").getTime();
  return Math.round((a - b) / 86_400_000);
}

/** Projected saleable chicks for a batch — product hatch rate of eggs set, unless adjusted. */
export function projectedChicksOf(b: Pick<Batch, "eggsSet" | "projectedChicks" | "productType">): number {
  if (b.projectedChicks != null) return Math.max(0, Math.round(b.projectedChicks));
  return Math.round((b.eggsSet || 0) * hatchRateFor(b.productType));
}

/** Actual saleable chicks once a batch has hatched (0 before hatch). */
export function actualChicksOf(
  b: Pick<Batch, "saleableCount" | "countedTotal" | "hatchedCount" | "culls">
): number {
  if (b.saleableCount && b.saleableCount > 0) return b.saleableCount;
  if (b.countedTotal && b.countedTotal > 0) return b.countedTotal;
  return Math.max(0, (b.hatchedCount || 0) - (b.culls || 0));
}

export interface HatchAccuracy {
  batch: Batch;
  hatchDate: string;
  projected: number;
  actual: number;
}

/** Hatched batches (actual chicks known), newest hatch first — for projection accuracy. */
export function hatchedBatches(batches: Batch[]): HatchAccuracy[] {
  return batches
    .filter((b) => b.setDate && actualChicksOf(b) > 0)
    .map((b) => ({
      batch: b,
      hatchDate: hatchDateOf(b.setDate!),
      projected: projectedChicksOf(b),
      actual: actualChicksOf(b),
    }))
    .sort((a, b) => (a.hatchDate < b.hatchDate ? 1 : a.hatchDate > b.hatchDate ? -1 : 0));
}

export interface BatchProjection {
  batch: Batch;
  hatchDate: string;
  product: Product;
  eggsSet: number;
  projected: number;
}

/**
 * Upcoming batch projections (hatch date on/after `from`, batch still open),
 * ordered by hatch date ascending.
 */
export function batchProjections(batches: Batch[], from: string = todayISO()): BatchProjection[] {
  return batches
    .filter((b) => b.setDate && b.status !== "inactive")
    .map((b) => ({
      batch: b,
      hatchDate: hatchDateOf(b.setDate!),
      product: b.productType,
      eggsSet: b.eggsSet || 0,
      projected: projectedChicksOf(b),
    }))
    .filter((p) => p.hatchDate >= from && p.projected > 0)
    .sort((a, b) => (a.hatchDate < b.hatchDate ? -1 : a.hatchDate > b.hatchDate ? 1 : 0));
}

/** Sum projections into per-hatch-date { ross, tetra } chick totals. */
export function availabilityFromBatches(
  batches: Batch[],
  from?: string
): Map<string, { ross: number; tetra: number }> {
  const map = new Map<string, { ross: number; tetra: number }>();
  for (const p of batchProjections(batches, from)) {
    const cur = map.get(p.hatchDate) ?? { ross: 0, tetra: 0 };
    if (p.product === "Ross 308") cur.ross += p.projected;
    else cur.tetra += p.projected;
    map.set(p.hatchDate, cur);
  }
  return map;
}

/**
 * Build the batch-published availability row for one hatch date, or null when no
 * batch projects chicks for it. `prev` preserves the original author when re-syncing.
 */
export function batchAvailabilityRow(
  date: string,
  batches: Batch[],
  prev: Availability | undefined,
  by: string,
  on: string
): Availability | null {
  const v = availabilityFromBatches(batches).get(date);
  if (!v || (v.ross <= 0 && v.tetra <= 0)) return null;
  return { id: date, date, ross: v.ross, tetra: v.tetra, fromBatch: true, closed: prev?.closed, by: prev?.by ?? by, on };
}

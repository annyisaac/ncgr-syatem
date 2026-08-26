/**
 * Parent Stock — feed consumption analytics. Reads the existing data (daily
 * `feedKg` logs + the Feed inventory items) — nothing is re-entered here:
 *  - per-flock consumption with actual vs breeder-standard intake,
 *  - a weekly consumption trend,
 *  - days-of-stock-remaining forecast from the current consumption rate.
 */

import { ageWeeks, type BreederFlock, type Sex } from "./parentStock";
import type { DailyLog } from "./psDaily";
import type { InventoryItem } from "./psInventory";

const num = (n: number | undefined) => Number(n) || 0;
const round1 = (n: number) => Math.round(n * 10) / 10;
const inRange = (d: string, from: string, to: string) => (!from || d >= from) && (!to || d <= to);

// Target feed intake (g/bird/day) by flock age (weeks) — a broiler-breeder
// standard, anchor points linearly interpolated. Males eat less than females.
const FEMALE_TARGET: [number, number][] = [[1, 18], [4, 35], [8, 55], [12, 78], [16, 95], [20, 112], [23, 128], [26, 150], [30, 165], [40, 162], [65, 155]];
const MALE_TARGET: [number, number][] = [[1, 16], [4, 32], [8, 48], [12, 66], [16, 80], [20, 95], [24, 108], [30, 120], [40, 122], [65, 118]];
function interp(anchors: [number, number][], w: number): number {
  if (w <= anchors[0][0]) return anchors[0][1];
  const last = anchors[anchors.length - 1];
  if (w >= last[0]) return last[1];
  for (let i = 1; i < anchors.length; i++) {
    const [x1, y1] = anchors[i - 1], [x2, y2] = anchors[i];
    if (w <= x2) return y1 + ((y2 - y1) * (w - x1)) / (x2 - x1);
  }
  return last[1];
}
/** Standard target feed intake for a flock's age (g/bird/day). */
export function feedTargetG(weeks: number | null, sex: Sex): number {
  if (weeks == null) return 0;
  return Math.round(interp(sex === "Male" ? MALE_TARGET : FEMALE_TARGET, weeks));
}

export interface FlockFeed {
  flock: BreederFlock;
  loggedDays: number;
  feedKg: number;
  birds: number;
  gPerBirdDay: number;   // actual average intake
  targetG: number;       // breeder-standard target for the flock's age
  variancePct: number;   // (actual − target) / target
  cost: number;
}

/** Per-flock feed consumption over [from,to], with actual vs target intake. */
export function feedByFlock(
  logs: DailyLog[], flocks: BreederFlock[], today: string, from: string, to: string, feedUnitCost: number
): FlockFeed[] {
  return flocks
    .filter((f) => f.active)
    .map((f) => {
      const fl = logs.filter((l) => l.flockId === f.id && num(l.feedKg) > 0 && inRange(l.date, from, to));
      const feedKg = fl.reduce((s, l) => s + num(l.feedKg), 0);
      const loggedDays = new Set(fl.map((l) => l.date)).size;
      const birds = num(f.currentPopulation);
      const gPerBirdDay = loggedDays > 0 && birds > 0 ? round1((feedKg * 1000) / (loggedDays * birds)) : 0;
      const targetG = feedTargetG(ageWeeks(f, today), f.sex);
      const variancePct = targetG > 0 ? Math.round(((gPerBirdDay - targetG) / targetG) * 100) : 0;
      return { flock: f, loggedDays, feedKg: round1(feedKg), birds, gPerBirdDay, targetG, variancePct, cost: Math.round(feedKg * feedUnitCost) };
    })
    .filter((x) => x.feedKg > 0)
    .sort((a, b) => b.feedKg - a.feedKg);
}

export interface FeedWeek { week: string; feedKg: number; }
/** Feed kg consumed per ISO week (Mon-start) over [from,to], oldest first. */
export function feedTrend(logs: DailyLog[], from: string, to: string): FeedWeek[] {
  const byWeek = new Map<string, number>();
  for (const l of logs) {
    if (num(l.feedKg) <= 0 || !inRange(l.date, from, to)) continue;
    const d = new Date(`${l.date}T00:00:00`);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // back to Monday
    const wk = d.toISOString().slice(0, 10);
    byWeek.set(wk, (byWeek.get(wk) ?? 0) + num(l.feedKg));
  }
  return [...byWeek.entries()].map(([week, feedKg]) => ({ week, feedKg: Math.round(feedKg) })).sort((a, b) => (a.week < b.week ? -1 : 1));
}

/** Average feed unit cost (per kg) across the Feed inventory items that carry one. */
export function feedUnitCost(items: InventoryItem[]): number {
  const feed = items.filter((i) => i.active && i.category === "Feed" && i.unitCost);
  return feed.length ? feed.reduce((s, i) => s + (i.unitCost || 0), 0) / feed.length : 0;
}

export interface FeedForecast {
  stockKg: number;       // feed stock on hand (kg-unit items)
  dailyKg: number;       // average daily consumption over the range
  daysRemaining: number | null;
  feedItems: InventoryItem[];
}
/** Days of feed left at the current consumption rate. */
export function feedForecast(items: InventoryItem[], logs: DailyLog[], from: string, to: string): FeedForecast {
  const feedItems = items.filter((i) => i.active && i.category === "Feed");
  const stockKg = feedItems.filter((i) => /kg/i.test(i.unit)).reduce((s, i) => s + num(i.currentStock), 0);
  const ranged = logs.filter((l) => num(l.feedKg) > 0 && inRange(l.date, from, to));
  const consumed = ranged.reduce((s, l) => s + num(l.feedKg), 0);
  const dayCount = new Set(ranged.map((l) => l.date)).size || 1;
  const dailyKg = round1(consumed / dayCount);
  return { stockKg: round1(stockKg), dailyKg, daysRemaining: dailyKg > 0 ? Math.round(stockKg / dailyKg) : null, feedItems };
}

/**
 * Parent Stock — daily records. One log per flock per day: mortality, culls,
 * feed, water, body weight, and (for laying females) the egg breakdown.
 *
 * The daily logs are the source of truth for a flock's live population and its
 * latest weight/uniformity — saving a log recomputes the flock so nothing is
 * entered twice.
 */

import { getSupabase } from "./supabase";
import type { BreederFlock, Sex } from "./parentStock";

const inBrowser = () => typeof window !== "undefined";
const round1 = (n: number) => Math.round(n * 10) / 10;

export interface DailyLog {
  id: string;            // `${flockId}__${date}` — one per flock per day
  flockId: string;
  flockCode: string;
  sex: Sex;
  date: string;          // ISO date
  mortality?: number;
  culls?: number;
  bodyWeightG?: number;
  uniformityPct?: number;
  feedKg?: number;
  waterL?: number;
  // Egg production (laying females)
  eggsProduced?: number;
  hatchableEggs?: number;
  floorEggs?: number;
  dirtyEggs?: number;
  crackedEggs?: number;
  misshapedEggs?: number;
  rejectEggs?: number;
  notes?: string;
  by: string;
  on: string;
}

export const dailyLogId = (flockId: string, date: string) => `${flockId}__${date}`;

// ---- Derived metrics ------------------------------------------------------

const num = (n: number | undefined) => Number(n) || 0;
export const birdsLost = (l: Pick<DailyLog, "mortality" | "culls">) => num(l.mortality) + num(l.culls);

/** Non-hatchable eggs on a log (floor, dirty, cracked, misshaped, reject). */
export const rejectEggsTotal = (l: DailyLog) =>
  num(l.floorEggs) + num(l.dirtyEggs) + num(l.crackedEggs) + num(l.misshapedEggs) + num(l.rejectEggs);

/** Hen-day egg production %: eggs today ÷ current female population. */
export const eggProductionPct = (l: DailyLog, femalePopulation: number) =>
  femalePopulation > 0 ? round1((num(l.eggsProduced) / femalePopulation) * 100) : 0;
export const hatchablePct = (l: DailyLog) =>
  num(l.eggsProduced) > 0 ? round1((num(l.hatchableEggs) / num(l.eggsProduced)) * 100) : 0;
export const rejectPct = (l: DailyLog) =>
  num(l.eggsProduced) > 0 ? round1((rejectEggsTotal(l) / num(l.eggsProduced)) * 100) : 0;

export const logsForFlock = (logs: DailyLog[], flockId: string) =>
  logs.filter((l) => l.flockId === flockId).sort((a, b) => (a.date < b.date ? -1 : 1));

/** Total birds lost (mortality + culls) across a flock's logs. */
export const cumulativeLost = (logs: DailyLog[], flockId: string) =>
  logsForFlock(logs, flockId).reduce((s, l) => s + birdsLost(l), 0);

/** Mortality within the last `days` for a flock. */
export function recentMortality(logs: DailyLog[], flockId: string, days: number, todayISO: string): number {
  const cutoff = new Date(Date.parse(todayISO) - days * 86_400_000).toISOString().slice(0, 10);
  return logsForFlock(logs, flockId).filter((l) => l.date >= cutoff).reduce((s, l) => s + num(l.mortality), 0);
}

/** A flock brought into sync with its logs: current population = placed −
 *  cumulative losses; latest weight/uniformity/laying from the newest log. */
export function recomputeFlock(flock: BreederFlock, allLogs: DailyLog[]): BreederFlock {
  const logs = logsForFlock(allLogs, flock.id);
  const lost = logs.reduce((s, l) => s + birdsLost(l), 0);
  const newest = logs[logs.length - 1];
  const laying = flock.laying || (flock.sex === "Female" && logs.some((l) => num(l.eggsProduced) > 0));
  return {
    ...flock,
    currentPopulation: Math.max(0, (flock.initialPopulation || 0) - lost - (flock.transferredOut || 0)),
    bodyWeightG: newest?.bodyWeightG ?? flock.bodyWeightG,
    uniformityPct: newest?.uniformityPct ?? flock.uniformityPct,
    laying,
  };
}

// ---- Storage --------------------------------------------------------------

export async function listDailyLogs(): Promise<DailyLog[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from("ps_daily").select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load daily logs: ${error.message}`);
  return (data ?? []).map((r) => r.data as DailyLog);
}
export async function upsertDailyLog(l: DailyLog): Promise<void> {
  const { error } = await getSupabase().from("ps_daily").upsert({ id: l.id, data: l, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save daily log: ${error.message}`);
}

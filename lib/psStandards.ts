/**
 * Parent Stock — Ross breeder management standards (Aviagen Ross PS Handbook 2023).
 * Turns the daily records into guidance: target body weight by age, uniformity
 * (CV%) from a weighed sample, and feed advice from a flock's body-weight status.
 *
 * The target body-weight curves are the Ross 308 PS standard (anchor points,
 * linearly interpolated). They are adjustable — drop in the exact figures from
 * your Ross Performance Objectives sheet for a precise match.
 */

import type { Sex } from "./parentStock";

// Uniformity goals (Handbook): a flock is "even" at ~CV ≤ 8% / uniformity ≥ 80%.
export const CV_TARGET = 8;          // CV% at or below this = good uniformity
export const UNIFORMITY_TARGET = 80; // % of birds within ±10% of the mean
// Body weight within ±3% of target reads as on-profile.
export const BW_ON_TARGET_PCT = 3;

// Ross 308 PS target body weight (g) by age in weeks — anchor points.
const BW_FEMALE: [number, number][] = [
  [1, 120], [2, 250], [3, 390], [4, 530], [6, 760], [8, 980], [10, 1200], [12, 1420],
  [14, 1650], [16, 1920], [18, 2210], [20, 2510], [22, 2810], [24, 3110], [26, 3350],
  [30, 3600], [35, 3800], [40, 3950], [50, 4150], [64, 4300],
];
const BW_MALE: [number, number][] = [
  [1, 140], [2, 320], [4, 700], [6, 1020], [8, 1350], [10, 1650], [12, 1950], [14, 2250],
  [16, 2550], [18, 2850], [20, 3150], [22, 3430], [24, 3700], [26, 3950], [30, 4300],
  [35, 4650], [40, 4900], [50, 5250], [64, 5500],
];

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

/** Ross standard target body weight (g) for a flock's age & sex. */
export function targetBodyWeightG(weeks: number | null, sex: Sex): number {
  if (weeks == null || weeks < 0) return 0;
  return Math.round(interp(sex === "Male" ? BW_MALE : BW_FEMALE, weeks));
}

/** Minimum weighing sample: 2% of the population, or 50 birds — whichever is greater. */
export function sampleSize(population: number): number {
  return Math.max(50, Math.ceil((Number(population) || 0) * 0.02));
}

export interface SampleStats {
  n: number;
  meanG: number;
  sdG: number;
  cvPct: number;         // SD / mean × 100
  uniformityPct: number; // % within ±10% of the mean
}

/** Mean body weight, CV% and uniformity% from a weighed sample (grams). */
export function sampleStats(weights: number[]): SampleStats | null {
  const w = weights.filter((x) => Number.isFinite(x) && x > 0);
  const n = w.length;
  if (n === 0) return null;
  const mean = w.reduce((s, x) => s + x, 0) / n;
  const variance = n > 1 ? w.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  const sd = Math.sqrt(variance);
  const within = w.filter((x) => Math.abs(x - mean) <= mean * 0.1).length;
  return {
    n,
    meanG: Math.round(mean),
    sdG: Math.round(sd),
    cvPct: mean > 0 ? Math.round((sd / mean) * 1000) / 10 : 0,
    uniformityPct: Math.round((within / n) * 100),
  };
}

export type BwStatus = "under" | "on" | "over";
export interface BwAssessment { target: number; deltaG: number; deltaPct: number; status: BwStatus; }

/** How a measured body weight compares to the Ross target. */
export function assessBodyWeight(actualG: number, weeks: number | null, sex: Sex): BwAssessment {
  const target = targetBodyWeightG(weeks, sex);
  const deltaG = Math.round(actualG - target);
  const deltaPct = target > 0 ? Math.round(((actualG - target) / target) * 1000) / 10 : 0;
  const status: BwStatus = target === 0 || Math.abs(deltaPct) <= BW_ON_TARGET_PCT ? "on" : deltaPct < 0 ? "under" : "over";
  return { target, deltaG, deltaPct, status };
}

/** Plain-language feed guidance from body-weight status (Handbook principles). */
export function feedAdvice(status: BwStatus): string {
  switch (status) {
    case "under": return "Below target — apply the next feed increment (or hold), and recover gradually; never a sharp jump.";
    case "over": return "Above target — hold feed, don't add the next increment until the profile comes back in line.";
    case "on": return "On target — continue the planned feed increments.";
  }
}

// ---------------------------------------------------------------------------
// Grading (Handbook §Grading + Appendix 4): split a poor-uniformity flock into
// weight classes at ±10% of the sample mean, then feed each to its own target.
// ---------------------------------------------------------------------------

export interface GradeClass { pct: number; count: number; avgG: number; }
export interface GradeResult {
  meanG: number;
  light: GradeClass;   // ≤ mean − 10%
  normal: GradeClass;  // within ±10%
  heavy: GradeClass;   // ≥ mean + 10%
  recommend: "none" | "2-way" | "3-way";
  note: string;
}

/** Classify a weighed sample into Light / Normal / Heavy and recommend a grade,
 *  scaling the class %s to the flock population for bird counts. */
export function gradeSample(weights: number[], population: number): GradeResult | null {
  const w = weights.filter((x) => Number.isFinite(x) && x > 0);
  const n = w.length;
  if (n === 0) return null;
  const mean = w.reduce((s, x) => s + x, 0) / n;
  const lo = mean * 0.9, hi = mean * 1.1;
  const cls = (pred: (x: number) => boolean): GradeClass => {
    const g = w.filter(pred);
    return { pct: Math.round((g.length / n) * 100), count: Math.round((g.length / n) * (Number(population) || 0)), avgG: g.length ? Math.round(g.reduce((s, x) => s + x, 0) / g.length) : 0 };
  };
  const light = cls((x) => x < lo);
  const normal = cls((x) => x >= lo && x <= hi);
  const heavy = cls((x) => x > hi);
  const outside = light.pct + heavy.pct;
  let recommend: GradeResult["recommend"] = "none";
  let note = "";
  if (normal.pct >= UNIFORMITY_TARGET || outside < 15) {
    note = "Flock is even enough — no grading needed; manage to one target line.";
  } else if (light.pct >= 10 && heavy.pct >= 10) {
    recommend = "3-way";
    note = "Grade 3-way — separate Light, Normal and Heavy into their own pens and feed each to its own target.";
  } else {
    recommend = "2-way";
    note = light.pct > heavy.pct
      ? "Grade 2-way — pull out the Light birds and feed them up toward target to catch back the flock."
      : "Grade 2-way — pull out the Heavy birds and hold their feed so the flock re-levels.";
  }
  return { meanG: Math.round(mean), light, normal, heavy, recommend, note };
}

/** Uniformity guidance — grading is the tool to fix a poor CV%. */
export function uniformityAdvice(cvPct: number, uniformityPct: number, weeks: number | null): string {
  const even = cvPct <= CV_TARGET || uniformityPct >= UNIFORMITY_TARGET;
  if (even) return "Even flock — keep managing to one target line.";
  if (weeks != null && weeks <= 4) return "High spread — grade the flock now (recommended at 4 weeks) into weight classes and feed each to its own target.";
  return "High spread (CV above 8%) — consider grading into weight classes so light birds catch up before light stimulation.";
}

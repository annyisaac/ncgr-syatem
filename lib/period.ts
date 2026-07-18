/**
 * Period presets shared by the dashboards and any page with a "search + time
 * filter" bar, so they all offer the same Today / This week / This month / …
 * options and resolve them the same way.
 */

import { ALL_TIME, type DateRangeValue } from "@/components/ui/DateRange";

export type PeriodPreset = "today" | "week" | "month" | "year" | "all" | "custom";

export const PERIODS: { value: PeriodPreset; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "year", label: "This year" },
  { value: "all", label: "All time" },
  { value: "custom", label: "Custom range" },
];

const isoDay = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * Presets span the WHOLE calendar period (month = 1st..last day), not
 * "start..today": orders are placed for future delivery dates, and cutting at
 * today would hide everything still coming.
 */
export function presetToRange(p: PeriodPreset, custom: DateRangeValue, today: string): DateRangeValue {
  const d = new Date(`${today}T00:00:00`);
  switch (p) {
    case "custom": return custom;
    case "all": return ALL_TIME;
    case "today": return { from: today, to: today };
    case "week": {
      const monday = new Date(d);
      monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      return { from: isoDay(monday), to: isoDay(sunday) };
    }
    case "month":
      return { from: `${today.slice(0, 8)}01`, to: isoDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)) };
    case "year":
      return { from: `${d.getFullYear()}-01-01`, to: `${d.getFullYear()}-12-31` };
  }
}

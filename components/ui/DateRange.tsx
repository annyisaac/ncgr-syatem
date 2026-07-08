"use client";

import { Button } from "./Button";
import { Input } from "./Select";

export interface DateRangeValue {
  from: string; // ISO date (yyyy-mm-dd) or ""
  to: string; // ISO date (yyyy-mm-dd) or ""
}

export const ALL_TIME: DateRangeValue = { from: "", to: "" };

/**
 * A delivery-date range filter with an "All time" reset.
 * Uses native date inputs so it works offline and on mobile.
 */
export function DateRange({
  value,
  onChange,
  label = "Delivery date range",
}: {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  label?: string;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <label className="block text-xs font-medium text-ink/70">
          {label} — from
        </label>
        <Input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="w-auto"
        />
      </div>
      <div className="space-y-1">
        <label className="block text-xs font-medium text-ink/70">to</label>
        <Input
          type="date"
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="w-auto"
        />
      </div>
      <Button variant="ghost" size="sm" onClick={() => onChange(ALL_TIME)}>
        All time
      </Button>
    </div>
  );
}

/** True when the given ISO date falls within the (inclusive) range. */
export function inRange(dateIso: string, range: DateRangeValue): boolean {
  if (!dateIso) return false;
  const d = dateIso.slice(0, 10);
  if (range.from && d < range.from) return false;
  if (range.to && d > range.to) return false;
  return true;
}

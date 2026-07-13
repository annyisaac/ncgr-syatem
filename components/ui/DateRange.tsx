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
  const active = !!value.from || !!value.to;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="flex items-center gap-2 text-[0.68rem] font-semibold uppercase tracking-[0.08em] text-muted">
        <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3.5" y="4.5" width="13" height="12" rx="2" />
          <path d="M3.5 8h13M7 3v3M13 3v3" />
        </svg>
        {label}
      </span>
      <div className="flex items-center gap-2">
        <Input
          type="date"
          aria-label={`${label} from`}
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          className="w-auto py-1.5"
        />
        <span className="text-muted">–</span>
        <Input
          type="date"
          aria-label={`${label} to`}
          value={value.to}
          onChange={(e) => onChange({ ...value, to: e.target.value })}
          className="w-auto py-1.5"
        />
      </div>
      <Button
        variant={active ? "ghost" : "primary"}
        size="sm"
        onClick={() => onChange(ALL_TIME)}
      >
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

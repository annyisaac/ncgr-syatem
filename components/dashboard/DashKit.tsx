"use client";

/**
 * Shared dashboard building blocks, so every role's dashboard reads the same:
 * the "Hey {name} — …" greeting header, the slim stat tiles, and the little
 * colour-chip section headings. The sales/finance/admin dashboards compose
 * these in app/(app)/dashboard/page.tsx; the DSR and Hatchery dashboards import
 * them here.
 */

import type { ReactNode } from "react";
import { PERIODS, type PeriodPreset } from "@/lib/period";
import type { DateRangeValue } from "@/components/ui/DateRange";

const CTRL = "h-10 rounded-lg border border-line bg-paper px-3 text-sm text-ink outline-none focus:border-gold";

/**
 * The standard "search + time filter" bar — a rounded search pill on the left
 * and a period dropdown (This month / …) on the right — used on every page that
 * has both, so they read identically.
 */
export function SearchTimeBar({
  q,
  setQ,
  placeholder,
  preset,
  setPreset,
  custom,
  setCustom,
}: {
  q: string;
  setQ: (v: string) => void;
  placeholder: string;
  preset: PeriodPreset;
  setPreset: (p: PeriodPreset) => void;
  custom: DateRangeValue;
  setCustom: (v: DateRangeValue) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-0 flex-1 sm:max-w-md">
        <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" aria-hidden>
          <circle cx="9" cy="9" r="5.5" />
          <path d="m13.5 13.5 3.5 3.5" />
        </svg>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={placeholder}
          className="h-10 w-full rounded-full border border-line bg-paper pl-10 pr-4 text-sm text-ink outline-none transition focus:border-gold"
        />
      </div>
      <select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} className={`${CTRL} w-auto`}>
        {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
      </select>
      {preset === "custom" && (
        <div className="flex items-center gap-1.5">
          <input type="date" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className={`${CTRL} w-auto`} />
          <span className="text-muted">–</span>
          <input type="date" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className={`${CTRL} w-auto`} />
        </div>
      )}
    </div>
  );
}

/** "Hey {first name} — {subtitle}", with an optional right-hand slot. */
export function GreetingHeader({
  name,
  subtitle,
  right,
}: {
  name: string;
  subtitle: string;
  right?: ReactNode;
}) {
  const firstName = name.split(" ")[0] || name;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-lg font-bold text-ink">
        Hey {firstName} — <span className="font-normal text-muted">{subtitle}</span>
      </h1>
      {right}
    </div>
  );
}

/** Slim stat tile: tiny uppercase label over a big number; clickable if onClick. */
export function StatTile({
  label,
  value,
  tone,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "green" | "gold" | "red" | "default";
  onClick?: () => void;
}) {
  const valueColor =
    tone === "green" ? "text-green" : tone === "gold" ? "text-gold-dark" : tone === "red" ? "text-red" : "text-ink";
  const cls = "rounded-xl border border-line bg-paper px-4 py-3 shadow-card";
  const body = (
    <>
      <p className="text-[0.6rem] font-bold uppercase tracking-[0.09em] text-muted">{label}</p>
      <p className={`mt-1 truncate text-[1.3rem] font-bold leading-tight tabular-nums ${valueColor}`}>{value}</p>
    </>
  );
  if (onClick) {
    return <button type="button" onClick={onClick} className={`${cls} text-left transition hover:border-gold`}>{body}</button>;
  }
  return <div className={cls}>{body}</div>;
}

/** Small colour-chip section heading, with an optional right-side action. */
export function SectionTitle({ label, action }: { label: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="h-2.5 w-2.5 rounded-[3px] bg-gold" />
        <h3 className="text-[0.72rem] font-bold uppercase tracking-[0.08em] text-ink">{label}</h3>
      </div>
      {action}
    </div>
  );
}

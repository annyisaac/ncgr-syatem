"use client";

/**
 * Shared dashboard building blocks, so every role's dashboard reads the same:
 * the "Hey {name} — …" greeting header, the slim stat tiles, and the little
 * colour-chip section headings. The sales/finance/admin dashboards compose
 * these in app/(app)/dashboard/page.tsx; the DSR and Hatchery dashboards import
 * them here.
 */

import type { ReactNode } from "react";

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

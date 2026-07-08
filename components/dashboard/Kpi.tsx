"use client";

import { cn } from "@/lib/cn";

type Tone = "default" | "gold" | "green" | "red";

const valueTone: Record<Tone, string> = {
  default: "text-ink",
  gold: "text-gold-dark",
  green: "text-green",
  red: "text-red",
};

/** A KPI tile. When `onClick` is set it becomes clickable (Admin tiles). */
export function Kpi({
  label,
  value,
  sub,
  tone = "default",
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "rounded-2xl border border-line bg-paper p-4 text-left shadow-card transition",
        onClick
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-gold hover:shadow-pop"
          : "cursor-default"
      )}
    >
      <p className="text-[0.62rem] font-semibold uppercase tracking-widest text-muted">
        {label}
      </p>
      <p className={cn("mt-1.5 text-[1.42rem] font-bold leading-tight", valueTone[tone])}>
        {value}
      </p>
      {sub && <p className="text-[0.7rem] text-muted">{sub}</p>}
      {onClick && <p className="mt-1 text-[0.62rem] font-semibold text-gold-dark">View orders →</p>}
    </button>
  );
}

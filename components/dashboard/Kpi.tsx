"use client";

import { cn } from "@/lib/cn";

type Tone = "default" | "gold" | "green" | "red" | "blue" | "purple";

/** Icon chip colours per tone (icon + tinted background). */
const chipTone: Record<Tone, string> = {
  default: "bg-grey-bg text-ink",
  gold: "bg-gold-bg text-gold-dark",
  green: "bg-green-bg text-green",
  red: "bg-red-bg text-red",
  blue: "bg-blue-bg text-blue",
  purple: "bg-[#efe7fb] text-[#7c3aed]",
};

/** Compact inline-SVG icon set (no icon library — keeps the bundle lean). */
const ICONS: Record<string, React.ReactNode> = {
  orders: <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h9A1.5 1.5 0 0 1 16 5.5v9a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 4 14.5v-9Z M7 8h6 M7 11h4" />,
  pending: <><circle cx="10" cy="10" r="6.5" /><path d="M10 6.5V10l2.5 1.5" /></>,
  check: <><circle cx="10" cy="10" r="6.5" /><path d="M7 10l2 2 4-4" /></>,
  chicks: <><ellipse cx="10" cy="11" rx="5" ry="6" /><path d="M10 5V3.5" /></>,
  money: <><rect x="3.5" y="6" width="13" height="8" rx="1.5" /><circle cx="10" cy="10" r="2" /></>,
  alert: <><path d="M10 4l6.5 11.5h-13L10 4Z" /><path d="M10 9v3M10 14h.01" /></>,
  chart: <path d="M4 15V9 M9 15V5 M14 15v-4" />,
};

/**
 * A modern stat card: a tinted icon chip, a bold value and an uppercase label.
 * When `onClick` is set it becomes a clickable, lifting card (Admin tiles).
 */
export function Kpi({
  label,
  value,
  sub,
  tone = "default",
  icon = "chart",
  onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: Tone;
  icon?: keyof typeof ICONS;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn(
        "group flex flex-col rounded-2xl border border-line bg-paper p-4 text-left shadow-card transition",
        onClick
          ? "cursor-pointer hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-pop"
          : "cursor-default"
      )}
    >
      <div className="flex items-center justify-between">
        <span
          className={cn(
            "flex h-9 w-9 items-center justify-center rounded-xl",
            chipTone[tone]
          )}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            {ICONS[icon] ?? ICONS.chart}
          </svg>
        </span>
        {onClick && (
          <span className="text-muted opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 10h10M11 6l4 4-4 4" />
            </svg>
          </span>
        )}
      </div>

      <p className="mt-3 text-[1.5rem] font-bold leading-none tracking-tight text-ink tabular-nums">
        {value}
      </p>
      <p className="mt-1.5 text-[0.64rem] font-semibold uppercase tracking-[0.09em] text-muted">
        {label}
      </p>
      {sub && <p className="mt-0.5 text-[0.7rem] text-muted">{sub}</p>}
    </button>
  );
}

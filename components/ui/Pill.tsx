import { cn } from "@/lib/cn";
import type { ReactNode } from "react";

type Tone =
  | "neutral"
  | "pending"
  | "fulfilled"
  | "refunded"
  | "gold"
  | "info"
  | "green"
  | "red"
  | "amber"
  | "purple"
  | "tetra"
  | "ross";

const tones: Record<Tone, string> = {
  neutral: "bg-grey-bg text-muted",
  pending: "bg-amber-bg text-amber",
  fulfilled: "bg-green-bg text-green",
  refunded: "bg-grey-bg text-muted",
  gold: "bg-gold-bg text-gold-dark",
  info: "bg-blue-bg text-blue",
  green: "bg-green-bg text-green",
  red: "bg-red-bg text-red",
  amber: "bg-amber-bg text-amber",
  purple: "bg-purple-bg text-purple",
  tetra: "bg-purple-bg text-purple",
  ross: "bg-blue-bg text-blue",
};

interface PillProps {
  children: ReactNode;
  tone?: Tone;
  className?: string;
}

export function Pill({ children, tone = "neutral", className }: PillProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[0.65rem] font-bold whitespace-nowrap",
        tones[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

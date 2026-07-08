"use client";

import { cn } from "@/lib/cn";
import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  // btn-gold
  primary:
    "bg-gold text-[#231b04] hover:brightness-[1.05] focus-visible:ring-gold disabled:opacity-50",
  // btn-dark
  secondary:
    "bg-onyx text-white hover:brightness-[1.12] focus-visible:ring-onyx disabled:opacity-50",
  // btn-line
  ghost:
    "bg-paper text-ink border border-line hover:border-ink focus-visible:ring-ink/30 disabled:opacity-50",
  // danger
  danger:
    "bg-red text-white hover:brightness-[1.05] focus-visible:ring-red disabled:opacity-50",
};

const sizes: Record<Size, string> = {
  sm: "text-[0.78rem] px-3 py-1.5",
  md: "text-[0.82rem] px-4 py-2.5",
};

/** Word-labelled button (no icon-only buttons anywhere in this app). */
export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center rounded-[10px] font-bold transition",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-offset-cream",
        "disabled:cursor-not-allowed",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    />
  );
}

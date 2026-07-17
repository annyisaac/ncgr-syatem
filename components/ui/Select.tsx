"use client";

import { cn } from "@/lib/cn";
import type { SelectHTMLAttributes } from "react";

const fieldBase =
  "w-full rounded-[9px] border border-line bg-field px-3.5 py-2.5 text-[0.9rem] text-ink " +
  "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold focus-visible:border-gold " +
  "disabled:opacity-50 disabled:bg-grey-bg";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
}

export function Select({
  options,
  placeholder,
  className,
  ...props
}: SelectProps) {
  return (
    <select className={cn(fieldBase, className)} {...props}>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Text/number input sharing the same look as Select. */
export function Input({
  className,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, className)} {...props} />;
}

export function Field({
  label,
  htmlFor,
  hint,
  error,
  required,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  /** Show a red asterisk after the label to mark the field as required. */
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-[0.66rem] font-semibold uppercase tracking-wide text-muted"
      >
        {label}
        {required && <span className="ml-0.5 text-red" aria-hidden>*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-[0.73rem] text-muted">{hint}</p>}
      {error && <p className="text-[0.73rem] font-semibold text-red">{error}</p>}
    </div>
  );
}

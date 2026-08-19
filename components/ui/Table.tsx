"use client";

import { cn } from "@/lib/cn";
import { useEffect, useRef, type ReactNode } from "react";

/**
 * Responsive table wrapper. On desktop it's a normal table (scrolls
 * horizontally if very wide). On phones (see globals.css `@media`) every
 * `.data-table` collapses into a stack of labelled cards — each cell shows its
 * column header as a label. The header text is copied onto each body cell as a
 * `data-label` here (kept in sync as rows re-render), so no per-table work is
 * needed. Pages with bespoke mobile cards hide their table on phones, so this
 * never doubles up.
 */
export function TableWrap({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLTableElement>(null);
  useEffect(() => {
    const table = ref.current;
    if (!table) return;
    const apply = () => {
      const ths = table.querySelectorAll("thead tr:first-child th");
      const labels = Array.from(ths).map((th) => (th.textContent || "").trim());
      table.querySelectorAll("tbody tr").forEach((tr) => {
        const cells = tr.children;
        // Full-width rows (a single colspan cell, e.g. the empty state) get no label.
        if (cells.length === 1 && (cells[0] as HTMLTableCellElement).colSpan > 1) return;
        for (let j = 0; j < cells.length; j++) {
          const td = cells[j] as HTMLElement;
          const label = labels[j] ?? "";
          if (label) td.setAttribute("data-label", label);
          else td.removeAttribute("data-label");
        }
      });
    };
    apply();
    const obs = new MutationObserver(apply);
    obs.observe(table, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);
  return (
    <div className={cn("w-full overflow-x-auto max-sm:overflow-x-visible", className)}>
      <table ref={ref} className="data-table w-full min-w-full border-collapse text-[0.8rem]">
        {children}
      </table>
    </div>
  );
}

export function Th({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <th
      className={cn(
        "bg-onyx px-2.5 py-2.5 text-left text-[0.64rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap first:rounded-tl-lg last:rounded-tr-lg",
        className
      )}
    >
      {children}
    </th>
  );
}

export function Td({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("border-b border-line px-2.5 py-2.5 align-middle", className)}>
      {children}
    </td>
  );
}

/** Emphasised footer cell (ink background, gold-cream text). */
export function Tf({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) {
  return (
    <td className={cn("bg-onyx px-2.5 py-2.5 font-bold text-[#f3e9c9]", className)}>
      {children}
    </td>
  );
}

export function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-muted">
        {text}
      </td>
    </tr>
  );
}

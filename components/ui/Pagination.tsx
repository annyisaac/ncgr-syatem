"use client";

import { cn } from "@/lib/cn";

/** Page numbers to show, collapsing long runs to a single ellipsis. */
function pageItems(current: number, total: number): (number | "…")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const items: (number | "…")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) items.push("…");
  for (let i = start; i <= end; i++) items.push(i);
  if (end < total - 1) items.push("…");
  items.push(total);
  return items;
}

/**
 * Table pagination footer: "Showing X to Y of Z", numbered page buttons, and an
 * optional rows-per-page selector. Purely presentational — the parent owns the
 * page/pageSize state and slices its own rows.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = [10, 25, 50, 100],
  noun = "items",
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (p: number) => void;
  onPageSizeChange?: (s: number) => void;
  pageSizeOptions?: number[];
  noun?: string;
}) {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1;
  const to = Math.min(total, current * pageSize);
  const btn =
    "flex h-8 min-w-[2rem] items-center justify-center rounded-lg border px-2 text-sm transition disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
      <span>
        Showing {from} to {to} of {total} {noun}
      </span>

      <div className="flex items-center gap-1">
        <button
          type="button"
          className={cn(btn, "border-line hover:border-ink")}
          onClick={() => onPageChange(current - 1)}
          disabled={current <= 1}
          aria-label="Previous page"
        >
          ‹
        </button>
        {pageItems(current, pageCount).map((it, i) =>
          it === "…" ? (
            <span key={`e${i}`} className="px-1.5 text-muted">
              …
            </span>
          ) : (
            <button
              key={it}
              type="button"
              onClick={() => onPageChange(it)}
              aria-current={it === current ? "page" : undefined}
              className={cn(
                btn,
                it === current
                  ? "border-gold bg-gold font-bold text-[#231b04]"
                  : "border-line hover:border-ink"
              )}
            >
              {it}
            </button>
          )
        )}
        <button
          type="button"
          className={cn(btn, "border-line hover:border-ink")}
          onClick={() => onPageChange(current + 1)}
          disabled={current >= pageCount}
          aria-label="Next page"
        >
          ›
        </button>
      </div>

      {onPageSizeChange && (
        <label className="flex items-center gap-2">
          Rows per page:
          <select
            value={pageSize}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="h-8 rounded-lg border border-line bg-paper px-2 text-sm text-ink outline-none focus:border-gold"
          >
            {pageSizeOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

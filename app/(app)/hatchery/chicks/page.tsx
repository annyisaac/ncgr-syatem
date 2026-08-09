"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Td, EmptyRow } from "@/components/ui/Table";
import { PRODUCTS, type Product } from "@/lib/types";
import { nowISO, todayISO, formatDate, formatDateTime } from "@/lib/format";
import type { ChickInventory } from "@/lib/hatchery/types";

const CAN_ADJUST = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

const daysBetween = (fromIso: string, toIso: string) =>
  Math.round((Date.parse(toIso) - Date.parse(fromIso)) / 86_400_000);

/** Freshness tone for day-old chicks, by age since hatch. */
function ageTone(days: number): "green" | "gold" | "neutral" {
  if (days <= 3) return "green";
  if (days <= 7) return "gold";
  return "neutral";
}

export default function ChickInventoryPage() {
  const { user } = useAuth();
  const { inventory, batches, upsertInventory } = useHatchery();
  const { toast } = useToast();

  const [product, setProduct] = useState<"all" | Product>("all");
  const [q, setQ] = useState("");
  const [includeDepleted, setIncludeDepleted] = useState(false);
  const [adjust, setAdjust] = useState<Record<string, string>>({});
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const today = todayISO();
  const canAdjust = !!user && CAN_ADJUST.includes(user.role);
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;
  const saleableOf = (id: string) => batches.find((b) => b.id === id)?.saleableCount ?? 0;

  const rows = useMemo(() => {
    return inventory
      .map((i) => {
        const saleable = saleableOf(i.batchId);
        return {
          inv: i,
          batchNo: batchNo(i.batchId),
          ageDays: daysBetween(i.hatchDate, today),
          allocated: Math.max(0, saleable - i.availableCount),
          saleable,
        };
      })
      .filter((r) => (includeDepleted ? true : r.inv.availableCount > 0))
      .filter((r) => product === "all" || r.inv.productType === product)
      .filter((r) => !q.trim() || r.batchNo.toLowerCase().includes(q.trim().toLowerCase()))
      .sort((a, b) => (a.inv.hatchDate < b.inv.hatchDate ? 1 : -1));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inventory, batches, product, q, includeDepleted, today]);

  const totals = useMemo(() => {
    const live = inventory.filter((i) => i.availableCount > 0);
    const byProduct = (p: Product) => live.filter((i) => i.productType === p).reduce((s, i) => s + i.availableCount, 0);
    const total = live.reduce((s, i) => s + i.availableCount, 0);
    const oldest = live.reduce((m, i) => Math.max(m, daysBetween(i.hatchDate, today)), 0);
    return { total, lots: live.length, oldest, byProduct };
  }, [inventory, today]);

  // Paginated rows.
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = rows.slice(start, start + perPage);

  if (!user) return null;

  function applyAdjust(inv: ChickInventory) {
    const delta = Number(adjust[inv.id]) || 0;
    if (delta === 0) return;
    const next = Math.max(0, inv.availableCount + delta);
    upsertInventory({ ...inv, availableCount: next, updatedBy: user!.email, on: nowISO() });
    toast(`${batchNo(inv.batchId)} available ${delta > 0 ? "+" : ""}${delta.toLocaleString()} → ${next.toLocaleString()}.`);
    setAdjust({ ...adjust, [inv.id]: "" });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Chick Inventory</h1>
          <p className="text-sm text-muted">On-hand day-old chicks by batch, ready to allocate</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoChick />} tone="gold" value={totals.total.toLocaleString()} label="Available chicks" />
        <StatCard icon={<IcoDot color="#1565c0" />} tone="blue" value={totals.byProduct("Ross 308").toLocaleString()} label="Ross 308" />
        <StatCard icon={<IcoDot color="#b8860b" />} tone="green" value={totals.byProduct("Tetra Super Harco").toLocaleString()} label="Tetra Super Harco" />
        <StatCard icon={<IcoBox />} tone="default" value={totals.lots.toLocaleString()} label="Lots in stock" />
        <StatCard icon={<IcoClock />} tone={totals.oldest > 7 ? "gold" : "green"} value={`${totals.oldest} d`} label="Oldest lot" />
      </div>

      <Card>
        <div className="sticky top-16 z-20 -mx-5 -mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border-b border-line bg-paper/95 px-5 pb-3 pt-5 backdrop-blur">
          <h2 className="text-[0.95rem] font-bold text-ink">Available lots</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search batch code…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <Field label="Product">
            <Select value={product} onChange={(e) => { setProduct(e.target.value as "all" | Product); setPage(1); }}
              options={[{ value: "all", label: "All products" }, ...PRODUCTS.map((p) => ({ value: p, label: p }))]} />
          </Field>
          <label className="flex items-center gap-2 pb-2.5 text-sm text-muted">
            <input type="checkbox" checked={includeDepleted} onChange={(e) => { setIncludeDepleted(e.target.checked); setPage(1); }} />
            Show depleted (0 left)
          </label>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Batch</th>
              <th className={HG}>Product</th>
              <th className={HG}>Hatch date</th>
              <th className={`${HG} text-right`}>Age</th>
              <th className={`${HG} text-right`}>Available</th>
              <th className={`${HG} text-right`}>Allocated</th>
              {canAdjust && <th className={HG}>Adjust (+/−)</th>}
              <th className={`${HG} last:rounded-tr-lg`}>Updated</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={canAdjust ? 8 : 7} text="No chick inventory matches." />
            ) : (
              pageRows.map((r) => (
                <tr key={r.inv.id}>
                  <Td>
                    <Link href={`/hatchery/batches/${r.inv.batchId}`} className="font-medium text-gold-dark">
                      {r.batchNo}
                    </Link>
                  </Td>
                  <Td>
                    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
                      <span className="h-2 w-2 rounded-full" style={{ background: r.inv.productType === "Ross 308" ? "#1565c0" : "#b8860b" }} />
                      {r.inv.productType}
                    </span>
                  </Td>
                  <Td className="whitespace-nowrap">{formatDate(r.inv.hatchDate)}</Td>
                  <Td className="text-right"><Pill tone={ageTone(r.ageDays)}>{r.ageDays} d</Pill></Td>
                  <Td className="text-right font-semibold tabular-nums">{r.inv.availableCount.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums text-muted">{r.allocated.toLocaleString()}</Td>
                  {canAdjust && (
                    <Td>
                      <div className="flex items-center gap-2">
                        <input type="number" value={adjust[r.inv.id] ?? ""} onChange={(e) => setAdjust({ ...adjust, [r.inv.id]: e.target.value })}
                          className="w-20 rounded-md border border-line bg-transparent px-2 py-1 text-sm" placeholder="±" />
                        <Button variant="secondary" size="sm" onClick={() => applyAdjust(r.inv)}>Apply</Button>
                      </div>
                    </Td>
                  )}
                  <Td className="whitespace-nowrap text-xs text-muted">{formatDateTime(r.inv.on)}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No lots" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} lots`}</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>‹</Button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, curPage - 3), Math.max(0, curPage - 3) + 5).map((p) => (
                <Button key={p} size="sm" variant={p === curPage ? "primary" : "ghost"} onClick={() => setPage(p)}>{p}</Button>
              ))}
              <Button size="sm" variant="ghost" disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>›</Button>
            </div>
            <label className="flex items-center gap-2">Rows per page:
              <span className="w-20"><Select value={String(perPage)} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))} /></span>
            </label>
          </div>
        </div>
        {canAdjust && (
          <p className="mt-2 text-xs text-muted">
            Adjust corrects on-hand chicks (e.g. mortality or a recount). Allocations to orders update this automatically — use adjust only for corrections.
          </p>
        )}
      </Card>
    </div>
  );
}

// ---- stat card + icons ----------------------------------------------------

type Tone = "green" | "gold" | "blue" | "red" | "default";
const CHIP: Record<Tone, string> = {
  green: "bg-green-bg text-green", gold: "bg-gold-bg text-gold-dark", blue: "bg-blue-bg text-blue", red: "bg-red-bg text-red", default: "bg-grey-bg text-ink",
};
function StatCard({ icon, value, label, tone = "default" }: { icon: ReactNode; value: string; label: string; tone?: Tone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 shadow-card">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${CHIP[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[1.3rem] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</p>
        <p className="mt-1 truncate text-[0.62rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      </div>
    </div>
  );
}

const fsvg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoChick = () => fsvg(<><circle cx="12" cy="13" r="6" /><path d="M12 7V5M9 4l1 2M15 4l-1 2M10.5 13h.01M13.5 13h.01M11 16h2" /></>);
const IcoBox = () => fsvg(<><path d="M3 8l9-4 9 4v8l-9 4-9-4V8Z" /><path d="M3 8l9 4 9-4M12 12v8" /></>);
const IcoClock = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoDot = ({ color }: { color: string }) => (
  <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="5" fill={color} /></svg>
);

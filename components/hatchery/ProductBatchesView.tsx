"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Select } from "@/components/ui/Select";
import { TableWrap, Th, Td } from "@/components/ui/Table";
import { fetchTable } from "@/lib/hatchery/db";
import { getSupabase } from "@/lib/supabase";
import { CANDLING_1_CATEGORIES, CANDLING_2_CATEGORIES, LIFECYCLE_STEPS, type Batch, type ChickInventory } from "@/lib/hatchery/types";
import { flockRemoved, flockTransferred, removedInStage, stepLabel } from "@/lib/hatchery/lifecycle";
import { deliveryDateOf, projectedChicksOf } from "@/lib/projection";
import { formatDate } from "@/lib/format";
import { COMPANY } from "@/lib/config";
import type { Product } from "@/lib/types";

/**
 * Cache shared across every ProductBatchesView (Ross + Tetra) and across page
 * visits, so the DB round trip only blocks the very first open. Later visits
 * render instantly from cache while a fresh copy loads in the background.
 */
let cache: { batches: Batch[]; inventory: ChickInventory[] } | null = null;

async function loadHatcheryView() {
  const [batches, inventory] = await Promise.all([
    fetchTable<Batch>("batches"),
    fetchTable<ChickInventory>("chick_inventory"),
  ]);
  cache = { batches, inventory };
  return cache;
}

const statusTone = (s: Batch["status"]) => (s === "delivered" ? "fulfilled" : s === "dispatched" ? "gold" : s === "inactive" ? "neutral" : "info");
const setKey = (b: Batch) => b.setDate ?? b.createdAt?.slice(0, 10) ?? "";
const marksOf = (b: Batch) => LIFECYCLE_STEPS.filter((s) => b.steps?.[s.key]).length;

/**
 * Read-only "live view of production from the hatchery" for one product. The
 * Ross Order Receiver (Ross 308), the Tetra zone managers and the payment
 * checkers (Tetra Super Harco) each get their own product's batches.
 */
export function ProductBatchesView({ product }: { product: Product }) {
  const [batches, setBatches] = useState<Batch[]>(cache?.batches ?? []);
  const [inventory, setInventory] = useState<ChickInventory[]>(cache?.inventory ?? []);
  const [loading, setLoading] = useState(!cache);
  const [selected, setSelected] = useState<string | null>(null);
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [view, setView] = useState<"grid" | "list">("grid");

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const data = await loadHatcheryView();
        if (!active) return;
        setBatches(data.batches);
        setInventory(data.inventory);
      } catch {
        /* RLS or network — keep whatever we have */
      } finally {
        if (active) setLoading(false);
      }
    };
    void refresh();

    // Live: reflect hatchery production the moment it changes (debounced).
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void refresh(), 350);
    };
    const sb = getSupabase();
    const channel = sb
      .channel("product-batches-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: { table?: string }) => {
        if (payload.table === "batches" || payload.table === "chick_inventory") bump();
      })
      .subscribe();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, []);

  const mine = useMemo(() => {
    const list = batches.filter((b) => b.productType === product);
    return list.sort((a, b) => {
      const c = setKey(a) < setKey(b) ? -1 : setKey(a) > setKey(b) ? 1 : (a.createdAt < b.createdAt ? -1 : 1);
      return sort === "newest" ? -c : c;
    });
  }, [batches, product, sort]);

  const availByBatch = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inventory) if (i.productType === product) m.set(i.batchId, (m.get(i.batchId) ?? 0) + i.availableCount);
    return m;
  }, [inventory, product]);

  const totalEggs = mine.reduce((s, b) => s + b.eggsSet, 0);
  const totalHatched = mine.reduce((s, b) => s + b.hatchedCount, 0);
  const totalAvail = useMemo(() => inventory.filter((i) => i.productType === product).reduce((s, i) => s + i.availableCount, 0), [inventory, product]);
  const activeCount = mine.filter((b) => b.status === "active").length;

  const batch = mine.find((b) => b.id === selected) ?? null;

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted">
        Live view of {product} production from the hatchery — set date, delivery date, expected chicks and the stage each batch is at.
      </p>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<IcoStack />} tone="gold" value={String(activeCount)} label="Active batches" sub="Batches in progress" />
        <StatCard icon={<IcoEgg />} tone="blue" value={totalEggs.toLocaleString()} label="Eggs set" sub="Total eggs set" />
        <StatCard icon={<IcoChick />} tone="green" value={totalHatched.toLocaleString()} label="Chicks hatched" sub="Total chicks hatched" />
        <StatCard icon={<IcoBox />} tone="green" value={totalAvail.toLocaleString()} label="Chicks available" sub="Chicks ready to sell" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-[0.78rem] font-bold uppercase tracking-wide text-ink"><span className="inline-block h-3 w-3 rounded-sm bg-gold" />Batches ({mine.length})</h2>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-muted">Sort by
            <span className="w-44"><Select value={sort} onChange={(e) => setSort(e.target.value as "newest" | "oldest")} options={[{ value: "newest", label: "Set date (Newest)" }, { value: "oldest", label: "Set date (Oldest)" }]} /></span>
          </label>
          <div className="inline-flex overflow-hidden rounded-lg border border-line">
            <button type="button" onClick={() => setView("grid")} aria-label="Card view" className={`px-2.5 py-2 transition ${view === "grid" ? "bg-gold text-[#231b04]" : "text-muted hover:text-ink"}`}><IcoGrid /></button>
            <button type="button" onClick={() => setView("list")} aria-label="Table view" className={`px-2.5 py-2 transition ${view === "list" ? "bg-gold text-[#231b04]" : "text-muted hover:text-ink"}`}><IcoList /></button>
          </div>
        </div>
      </div>

      {/* Batches */}
      {mine.length === 0 ? (
        <Card><p className="py-6 text-center text-sm text-muted">{loading ? "Loading…" : `No ${product} batches yet.`}</p></Card>
      ) : view === "grid" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {mine.map((b) => (
            <BatchCard key={b.id} b={b} available={availByBatch.get(b.id) ?? 0} selected={b.id === selected} onDetails={() => setSelected(b.id === selected ? null : b.id)} />
          ))}
        </div>
      ) : (
        <Card>
          <TableWrap>
            <thead>
              <tr>
                <Th>Batch</Th><Th>Set date</Th><Th>Delivery date</Th><Th>Stage</Th>
                <Th className="text-right">Eggs set</Th><Th className="text-right">Expected chicks</Th><Th className="text-right">Hatched</Th>
                <Th className="text-right">Saleable</Th><Th className="text-right">Available</Th><Th>Status</Th><Th></Th>
              </tr>
            </thead>
            <tbody>
              {mine.map((b) => (
                <tr key={b.id}>
                  <Td className="font-medium">{b.batchNo}</Td>
                  <Td className="whitespace-nowrap">{b.setDate ? formatDate(b.setDate) : "—"}</Td>
                  <Td className="whitespace-nowrap font-medium text-gold-dark">{b.setDate ? formatDate(deliveryDateOf(b.setDate)) : "—"}</Td>
                  <Td>{stepLabel(b.currentStep)} <span className="text-xs text-muted">({marksOf(b)}/{LIFECYCLE_STEPS.length})</span></Td>
                  <Td className="text-right">{b.eggsSet.toLocaleString()}</Td>
                  <Td className="text-right font-semibold">{projectedChicksOf(b).toLocaleString()}</Td>
                  <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
                  <Td className="text-right">{b.saleableCount.toLocaleString()}</Td>
                  <Td className="text-right font-semibold text-green">{(availByBatch.get(b.id) ?? 0).toLocaleString()}</Td>
                  <Td><Pill tone={statusTone(b.status)}>{b.status}</Pill></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setSelected(b.id === selected ? null : b.id)}>{b.id === selected ? "Hide" : "Details"}</Button></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {/* Lifecycle legend */}
      <Card>
        <p className="mb-3 text-[0.64rem] font-semibold uppercase tracking-wide text-muted">Lifecycle stages</p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
          {LEGEND.map((l) => (
            <div key={l.label} className="flex items-start gap-2">
              <span className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-grey-bg text-ink">{l.icon}</span>
              <div className="min-w-0"><p className="text-xs font-semibold text-ink">{l.label}</p><p className="text-[0.64rem] leading-tight text-muted">{l.desc}</p></div>
            </div>
          ))}
        </div>
      </Card>

      {/* Details — opens over the cards */}
      {batch && (
        <BatchDetailsModal
          batch={batch}
          available={availByBatch.get(batch.id) ?? 0}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

// ---- batch details (full lifecycle) ---------------------------------------

const CAND_LABELS: Record<string, string> = Object.fromEntries(
  [...CANDLING_1_CATEGORIES, ...CANDLING_2_CATEGORIES].map((c) => [c.key, c.label])
);
const candLabel = (key: string) => CAND_LABELS[key] ?? key;
const num = (n: number | undefined) => (n ?? 0).toLocaleString();

/**
 * Full "everything on this batch" overlay, styled to the batch-lifecycle
 * design: a branded header, an icon-tiled stat grid (eggs set → candling
 * removals & remaining → transfer → chicks → counting), the candling category
 * breakdown, a per-flock row and a connected progress timeline. A number reads
 * "—" until its stage is reached, so a not-yet-candled batch never looks like
 * "0 removed"; the two "remaining after candling" figures always show.
 */
function BatchDetailsModal({ batch, available, onClose }: { batch: Batch; available: number; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const doneC1 = !!batch.steps?.["candling-1"];
  const doneC2 = !!batch.steps?.["candling-2"];
  const doneTransfer = !!batch.steps?.["transfer"];
  const doneHatch = !!batch.steps?.["hatching"];
  const doneCount = !!batch.steps?.["counting"];
  const c1 = removedInStage(batch, 1);
  const c2 = removedInStage(batch, 2);
  // Fertile eggs still in the batch after each candling — always shown, so the
  // count carried forward is visible even before a stage is reached (removals
  // are 0 until then, so remaining simply equals eggs set).
  const remainingAfterC1 = Math.max(0, batch.eggsSet - c1);
  const remainingAfterC2 = Math.max(0, batch.eggsSet - c1 - c2);
  const transferred = (batch.transfers ?? []).reduce((s, t) => s + (t.eggs || 0), 0);

  const tiles: { label: string; value: ReactNode; icon: ReactNode }[] = [
    { label: "Set date", icon: <IcoCal2 />, value: batch.setDate ? formatDate(batch.setDate) : "—" },
    { label: "Delivery date", icon: <IcoCal2 />, value: batch.setDate ? formatDate(deliveryDateOf(batch.setDate)) : "—" },
    { label: "Expected chicks", icon: <IcoChick />, value: num(projectedChicksOf(batch)) },
    { label: "Status", icon: <IcoShield />, value: <Pill tone={statusTone(batch.status)}>{batch.status}</Pill> },
    { label: "Eggs through the stages", icon: <IcoEgg />, value: num(batch.eggsSet) },
    { label: "Removed · Candling I", icon: <IcoTrash />, value: doneC1 ? `−${num(c1)}` : "—" },
    { label: "Remaining after Candling I", icon: <IcoTrend />, value: num(remainingAfterC1) },
    { label: "Transferred to hatcher", icon: <IcoTruck />, value: doneTransfer ? num(transferred) : "—" },
    { label: "Removed · Candling II", icon: <IcoTrash />, value: doneC2 ? `−${num(c2)}` : "—" },
    { label: "Remaining after Candling II", icon: <IcoTrend />, value: num(remainingAfterC2) },
    { label: "Hatched", icon: <IcoChick />, value: doneHatch ? num(batch.hatchedCount) : "—" },
    { label: "Unhatched", icon: <IcoEgg />, value: doneHatch ? num(batch.unhatchedCount) : "—" },
    { label: "Counted", icon: <IcoBox />, value: doneCount ? num(batch.countedTotal) : "—" },
    { label: "Saleable", icon: <IcoEgg />, value: num(batch.saleableCount) },
    { label: "Available now", icon: <IcoCheck />, value: num(available) },
  ];
  // Pad to a multiple of 4 (also a multiple of 2) so the cell dividers stay
  // square at both the 2- and 4-column breakpoints.
  const fillers = (4 - (tiles.length % 4)) % 4;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6" role="dialog" aria-modal="true" aria-label={`${batch.batchNo} details`}>
      <div className="absolute inset-0 bg-ink/50" onClick={onClose} aria-hidden="true" />
      <div className="relative z-10 flex max-h-[94vh] w-full max-w-4xl flex-col overflow-hidden rounded-3xl border border-line bg-paper shadow-pop">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3.5 sm:px-6">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <Image src={COMPANY.logoPath} alt={`${COMPANY.name} logo`} width={132} height={44} className="brand-logo hidden h-10 w-auto shrink-0 object-contain sm:block" unoptimized />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-lg font-extrabold tracking-tight text-ink sm:text-xl">{batch.batchNo}</h3>
                <Pill tone={statusTone(batch.status)}>{batch.status}</Pill>
              </div>
              <p className="text-xs text-muted">Everything on this batch</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>✕ Close</Button>
        </div>

        {/* Body */}
        <div className="grow space-y-6 overflow-y-auto bg-cream px-4 py-5 sm:px-6">
          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line sm:grid-cols-4">
            {tiles.map((t) => (
              <div key={t.label} className="flex items-start gap-3 bg-paper p-3.5">
                <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-green-bg text-green">{t.icon}</span>
                <div className="min-w-0">
                  <p className="text-[0.58rem] font-semibold uppercase tracking-wide text-muted">{t.label}</p>
                  <div className="mt-0.5 text-lg font-bold leading-tight text-ink">{t.value}</div>
                </div>
              </div>
            ))}
            {Array.from({ length: fillers }).map((_, i) => <div key={`f${i}`} className="bg-paper" />)}
          </div>

          {/* Candling breakdown */}
          {batch.candlings && batch.candlings.length > 0 && (
            <div>
              <SectionTitle>What was removed at candling</SectionTitle>
              <div className="grid gap-3 sm:grid-cols-2">
                {([1, 2] as const).map((stage) => {
                  const recs = batch.candlings.filter((c) => c.stage === stage);
                  if (recs.length === 0) return null;
                  const cats: Record<string, number> = {};
                  let total = 0;
                  for (const rec of recs) {
                    total += rec.totalRemoved || 0;
                    for (const [k, v] of Object.entries(rec.categories ?? {})) cats[k] = (cats[k] ?? 0) + (v || 0);
                  }
                  const entries = Object.entries(cats).filter(([, v]) => v > 0);
                  return (
                    <div key={stage} className="rounded-2xl border border-line bg-paper p-4">
                      <div className="mb-2.5 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                          <span className="grid h-9 w-9 place-items-center rounded-xl bg-green-bg text-green"><IcoSearch /></span>
                          <p className="text-base font-bold text-ink">Candling {stage === 1 ? "I" : "II"}</p>
                        </div>
                        <p className="text-lg font-bold text-red">−{num(total)}</p>
                      </div>
                      {entries.length === 0 ? (
                        <p className="text-xs text-muted">No eggs removed.</p>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {entries.map(([k, v]) => (
                            <span key={k} className="rounded-full bg-grey-bg px-2.5 py-1 text-xs font-medium text-ink">{candLabel(k)} {num(v)}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Flocks */}
          {batch.flocks && batch.flocks.length > 0 && (
            <div>
              <SectionTitle>Flocks in this batch</SectionTitle>
              <div className="space-y-2.5">
                {batch.flocks.map((f) => (
                  <div key={f.flockId + f.farm} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-paper p-3.5">
                    <div className="flex items-center gap-2.5">
                      <span className="grid h-9 w-9 place-items-center rounded-xl bg-green-bg text-green"><IcoHen /></span>
                      <p className="font-bold text-ink">{f.farm ? `${f.farm} · ` : ""}flock {f.flockId}</p>
                    </div>
                    <div className="flex gap-5 sm:gap-8">
                      <FlockNum label="Set" value={num(f.eggsSet)} />
                      <FlockNum label="C1" value={`−${num(flockRemoved(f, 1))}`} />
                      <FlockNum label="C2" value={`−${num(flockRemoved(f, 2))}`} />
                      <FlockNum label="Transferred" value={num(flockTransferred(f))} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <p className="mb-2.5 text-[0.72rem] font-bold uppercase tracking-wide text-green">{children}</p>;
}

function FlockNum({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="text-sm font-bold tabular-nums text-ink">{value}</p>
    </div>
  );
}

// ---- batch card -----------------------------------------------------------

function BatchCard({ b, available, selected, onDetails }: { b: Batch; available: number; selected: boolean; onDetails: () => void }) {
  const marked = marksOf(b);
  const pct = Math.round((marked / LIFECYCLE_STEPS.length) * 100);
  const setters = (b.setters ?? []).map((s) => s.machineCode).filter(Boolean).join(", ");
  return (
    <div className={`flex flex-col rounded-2xl border bg-paper p-4 shadow-card ${selected ? "border-gold" : "border-line"}`}>
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-ink">{b.batchNo}</p>
        <Pill tone={statusTone(b.status)}>{b.status}</Pill>
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="inline-flex items-center gap-1"><IcoCal />{b.setDate ? formatDate(b.setDate) : "—"}</span>
        {setters && <span className="truncate">Setter: {setters}</span>}
      </div>
      <p className="mt-1 text-xs font-semibold text-gold-dark">Delivery {b.setDate ? formatDate(deliveryDateOf(b.setDate)) : "—"} · Expected {projectedChicksOf(b).toLocaleString()}</p>

      <div className="mt-3 flex items-center gap-2">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gold-bg text-gold-dark">{stageIcon(b.currentStep)}</span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2 text-sm"><span className="truncate font-semibold text-ink">{stepLabel(b.currentStep)}</span><span className="shrink-0 text-xs text-muted">{marked} / {LIFECYCLE_STEPS.length}</span></div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-grey-bg"><div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} /></div>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-1 border-t border-line pt-3">
        <CardStat label="Eggs set" value={b.eggsSet.toLocaleString()} />
        <CardStat label="Hatched" value={b.hatchedCount.toLocaleString()} />
        <CardStat label="Saleable" value={b.saleableCount.toLocaleString()} />
        <CardStat label="Available" value={available.toLocaleString()} green />
      </div>

      <div className="mt-3 flex justify-end">
        <Button size="sm" variant="ghost" onClick={onDetails}>{selected ? "Hide" : "Details"}</Button>
      </div>
    </div>
  );
}

function CardStat({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[0.56rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className={`truncate text-sm font-bold tabular-nums ${green ? "text-green" : "text-ink"}`}>{value}</p>
    </div>
  );
}

// ---- stat card ------------------------------------------------------------

type Tone = "green" | "gold" | "blue";
const CHIP: Record<Tone, string> = { green: "bg-green-bg text-green", gold: "bg-gold-bg text-gold-dark", blue: "bg-blue-bg text-blue" };
function StatCard({ icon, value, label, sub, tone }: { icon: ReactNode; value: string; label: string; sub: string; tone: Tone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 shadow-card">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${CHIP[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.56rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className="truncate text-[1.25rem] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</p>
        <p className="mt-0.5 truncate text-[0.62rem] text-muted">{sub}</p>
      </div>
    </div>
  );
}

// ---- lifecycle legend + icons ---------------------------------------------

const hsvg = (children: ReactNode, size = 16) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoStack = () => hsvg(<><path d="M12 3l9 5-9 5-9-5 9-5Z" /><path d="M3 12l9 5 9-5M3 16l9 5 9-5" /></>, 18);
const IcoEgg = () => hsvg(<ellipse cx="12" cy="13" rx="6" ry="8" />, 18);
const IcoChick = () => hsvg(<><circle cx="12" cy="10" r="5" /><path d="M12 15v4M9 19h6M10 9h.01M14 9h.01M12 11l1.5 1" /></>, 18);
const IcoBox = () => hsvg(<><path d="M4 8l8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /></>, 18);
const IcoCal = () => hsvg(<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M9 3v4M15 3v4" /></>, 13);
const IcoSearch = () => hsvg(<><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>);
const IcoSyringe = () => hsvg(<><path d="M18 2l4 4M17 5l2 2M15 7l2 2M12 10l-8 8-2 4 4-2 8-8M8 8l8 8" /></>);
const IcoCheck = () => hsvg(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>);
const IcoGrid = () => hsvg(<><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>, 15);
const IcoList = () => hsvg(<><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></>, 15);
// Batch-details tile / timeline icons
const IcoCal2 = () => hsvg(<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M9 3v4M15 3v4" /></>, 14);
const IcoShield = () => hsvg(<><path d="M12 3l7 3v5c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-3Z" /><path d="M9 12l2 2 4-4" /></>, 17);
const IcoTrash = () => hsvg(<><path d="M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M6 7l1 13h10l1-13" /></>, 17);
const IcoTrend = () => hsvg(<><path d="M4 15l5-5 4 4 7-7" /><path d="M17 7h4v4" /></>, 17);
const IcoTruck = () => hsvg(<><rect x="1" y="6" width="13" height="10" rx="1" /><path d="M14 9h4l3 3v4h-7" /><circle cx="6" cy="18" r="1.6" /><circle cx="18" cy="18" r="1.6" /></>, 17);
const IcoHen = () => hsvg(<><path d="M6 20c0-4 2-7 5-8 0-3 2-5 4-4 0 2-1 3-2 3 2 1 3 3 3 6 0 4-3 7-7 7H6v-4Z" /><path d="M9.5 9L7 7" /></>, 18);

function stageIcon(step: string) {
  if (step.startsWith("candling")) return <IcoSearch />;
  if (step === "transfer" || step === "counting" || step === "dispatch" || step === "delivery") return <IcoBox />;
  if (step === "hatching") return <IcoChick />;
  if (step === "vaccination") return <IcoSyringe />;
  return <IcoEgg />;
}

const LEGEND: { label: string; desc: string; icon: ReactNode }[] = [
  { label: "Setting", desc: "Eggs are in setter machines", icon: <IcoEgg /> },
  { label: "Candling I", desc: "First candling (day 10)", icon: <IcoSearch /> },
  { label: "Candling II", desc: "Second candling (day 18)", icon: <IcoSearch /> },
  { label: "Transfer", desc: "Eggs moved to hatchers", icon: <IcoBox /> },
  { label: "Hatching", desc: "Chicks are hatching", icon: <IcoChick /> },
  { label: "Counting & boxing", desc: "Chicks counted & boxed", icon: <IcoBox /> },
  { label: "Vaccination", desc: "Chicks are vaccinated", icon: <IcoSyringe /> },
  { label: "Ready / Available", desc: "Chicks available to sell", icon: <IcoCheck /> },
];

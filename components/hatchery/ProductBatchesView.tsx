"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { Select } from "@/components/ui/Select";
import { TableWrap, Th, Td } from "@/components/ui/Table";
import { fetchTable } from "@/lib/hatchery/db";
import { getSupabase } from "@/lib/supabase";
import { CANDLING_1_CATEGORIES, CANDLING_2_CATEGORIES, LIFECYCLE_STEPS, type Batch, type ChickInventory } from "@/lib/hatchery/types";
import { flockRemoved, flockTransferred, removedInStage, stepLabel } from "@/lib/hatchery/lifecycle";
import { deliveryDateOf, projectedChicksOf } from "@/lib/projection";
import { formatDate, formatDateTime } from "@/lib/format";
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
      <Modal
        open={!!batch}
        onClose={() => setSelected(null)}
        title={batch ? `${batch.batchNo} — everything on this batch` : ""}
        className="max-w-3xl"
      >
        {batch && <BatchDetails batch={batch} available={availByBatch.get(batch.id) ?? 0} />}
      </Modal>
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
 * Everything recorded on a batch, stage by stage: eggs set, eggs removed at
 * Candling I and II (with the category breakdown), eggs transferred to the
 * hatcher, then the chick numbers — hatched, culls, unhatched, counted,
 * saleable and available. A number reads "—" until its stage is reached, so a
 * not-yet-candled batch never looks like "0 removed".
 */
function BatchDetails({ batch, available }: { batch: Batch; available: number }) {
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

  return (
    <div>
      {/* Overview */}
      <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <Info label="Set date" value={batch.setDate ? formatDate(batch.setDate) : "—"} />
        <Info label="Delivery date" value={batch.setDate ? formatDate(deliveryDateOf(batch.setDate)) : "—"} />
        <Info label="Expected chicks" value={num(projectedChicksOf(batch))} />
        <Info label="Status" value={batch.status} />
      </div>

      {/* Eggs through the stages */}
      <div className="mt-4">
        <p className="mb-2 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Eggs through the stages</p>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <Info label="Eggs set" value={num(batch.eggsSet)} />
          <Info label="Removed · Candling I" value={doneC1 ? `−${num(c1)}` : "—"} />
          <Info label="Remaining after Candling I" value={num(remainingAfterC1)} />
          <Info label="Removed · Candling II" value={doneC2 ? `−${num(c2)}` : "—"} />
          <Info label="Remaining after Candling II" value={num(remainingAfterC2)} />
          <Info label="Transferred to hatcher" value={doneTransfer ? num(transferred) : "—"} />
        </div>
      </div>

      {/* Chicks & counting */}
      <div className="mt-4">
        <p className="mb-2 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Chicks &amp; counting</p>
        <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Info label="Hatched" value={doneHatch ? num(batch.hatchedCount) : "—"} />
          <Info label="Culls (dead / weak)" value={doneHatch ? num(batch.culls) : "—"} />
          <Info label="Unhatched" value={doneHatch ? num(batch.unhatchedCount) : "—"} />
          <Info label="Counted" value={doneCount ? num(batch.countedTotal) : "—"} />
          <Info label="Saleable" value={num(batch.saleableCount)} />
          <Info label="Available now" value={num(available)} />
        </div>
      </div>

      {/* Candling breakdown by category */}
      {batch.candlings && batch.candlings.length > 0 && (
        <div className="mt-4">
          <p className="mb-2 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">What was removed at candling</p>
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
                <div key={stage} className="rounded-lg border border-line p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-sm font-semibold text-ink">Candling {stage === 1 ? "I" : "II"}</p>
                    <p className="text-sm font-bold text-ink">−{num(total)}</p>
                  </div>
                  {entries.length === 0 ? (
                    <p className="text-xs text-muted">No eggs removed.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {entries.map(([k, v]) => (
                        <span key={k} className="rounded-full bg-grey-bg px-2 py-0.5 text-xs text-ink">{candLabel(k)} {num(v)}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Per-flock breakdown */}
      {batch.flocks && batch.flocks.length > 0 && (
        <div className="mt-4">
          <p className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Flocks in this batch</p>
          <div className="space-y-1.5 text-sm">
            {batch.flocks.map((f) => (
              <div key={f.flockId + f.farm} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-md border border-line px-3 py-2">
                <span className="font-medium text-ink">{f.farm ? `${f.farm} · ` : ""}flock {f.flockId}</span>
                <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                  <span>set {num(f.eggsSet)}</span>
                  <span>C1 −{num(flockRemoved(f, 1))}</span>
                  <span>C2 −{num(flockRemoved(f, 2))}</span>
                  <span>transferred {num(flockTransferred(f))}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Progress timeline */}
      <div className="mt-4">
        <p className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Progress</p>
        <ol className="space-y-1.5">
          {LIFECYCLE_STEPS.map((s) => {
            const mark = batch.steps?.[s.key];
            const isNext = !mark && LIFECYCLE_STEPS.find((x) => !batch.steps?.[x.key])?.key === s.key;
            return (
              <li key={s.key} className={`flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm ${mark ? "border-green/30 bg-green-bg" : isNext ? "border-gold bg-gold-bg" : "border-line"}`}>
                <span className="font-medium">{mark ? "✓ " : isNext ? "→ " : ""}{s.label}</span>
                {mark && <span className="text-xs text-muted">{formatDateTime(mark.on)}</span>}
              </li>
            );
          })}
        </ol>
      </div>
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

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="font-medium text-ink">{value}</p>
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

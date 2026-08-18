"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { todayISO, nowISO, formatDate } from "@/lib/format";
import { PRODUCTS } from "@/lib/types";
import {
  CANDLING_1_CATEGORIES, CANDLING_2_CATEGORIES,
  type Batch, type BatchFlock, type Candling, type MachineAssignment,
} from "@/lib/hatchery/types";
import {
  candlingTotal, markStep, machineFreeCapacity, machinesToSync,
  batchFlocks, flockHasCandling, flockFertileAfterC1, flockFertileAfterC2,
  flockTransferDone, recomputeBatchAggregates,
} from "@/lib/hatchery/lifecycle";

const CAN_ACT = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];
const CAN_EDIT = ["Admin", "Hatchery Manager"];
// Candling I is done on day 10 of incubation, Candling II on day 18.
const CANDLE_DAY: Record<"c1" | "c2", number> = { c1: 10, c2: 18 };

const CAT_COLOR: Record<string, string> = {
  infertile: "#6b7280", earlyDead: "#d6a020", midDead: "#d6a020", bloodring: "#d9534f",
  contaminated: "#7c3aed", cracked: "#e8843a", others: "#3b82f6",
};
const CAT_DESC: Record<string, string> = {
  infertile: "No embryo present", earlyDead: "Dead embryo (early stage)", midDead: "Dead embryo (mid stage)",
  bloodring: "Blood ring detected", contaminated: "Bacterial / fungal growth", cracked: "Cracked egg inside", others: "Other defects",
};

interface FlockRow { batch: Batch; flock: BatchFlock; idx: number; }

function catCounts(f: BatchFlock, stage: 1 | 2): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of f.candlings) if (c.stage === stage) {
    for (const [k, v] of Object.entries(c.categories)) out[k] = (out[k] ?? 0) + (Number(v) || 0);
  }
  return out;
}
const setDateOf = (b: Batch) => b.setDate ?? b.createdAt.slice(0, 10);
function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10);
}
function daysUntil(iso: string): number {
  return Math.round((new Date(iso + "T00:00:00").getTime() - new Date(todayISO() + "T00:00:00").getTime()) / 86_400_000);
}
const candledOn = (f: BatchFlock, stage: 1 | 2) => [...f.candlings].reverse().find((c) => c.stage === stage)?.date;

export default function CandlingPage() {
  const { user } = useAuth();
  const { batches, machines, upsertBatch, upsertMachine } = useHatchery();
  const { toast } = useToast();
  const router = useRouter();
  const search = useSearchParams();

  const [mode, setMode] = useState<"c1" | "c2">("c1");
  const [sel, setSel] = useState<{ batchId: string; idx: number } | null>(null);
  const [editStage, setEditStage] = useState<1 | 2 | null>(null);
  const [cats, setCats] = useState<Record<string, string>>({});
  const [tRows, setTRows] = useState<{ machineCode: string; eggs: string }[]>([{ machineCode: "", eggs: "" }]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [productF, setProductF] = useState("all");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const canAct = !!user && CAN_ACT.includes(user.role);
  const canEdit = !!user && CAN_EDIT.includes(user.role);
  const hatchers = machines.filter((m) => m.type === "hatcher");

  const { rowsC1, rowsC2 } = useMemo(() => {
    const c1: FlockRow[] = [];
    const c2: FlockRow[] = [];
    const ordered = batches.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    for (const b of ordered) {
      if (!(b.steps["setting"] && !b.steps["hatching"] && b.status === "active")) continue;
      batchFlocks(b).forEach((f, idx) => {
        c1.push({ batch: b, flock: f, idx });
        if (flockHasCandling(f, 1)) c2.push({ batch: b, flock: f, idx });
      });
    }
    return { rowsC1: c1, rowsC2: c2 };
  }, [batches]);
  const rows = useMemo(() => {
    const base = mode === "c1" ? rowsC1 : rowsC2;
    const needs = (r: FlockRow) => (mode === "c1" ? !flockHasCandling(r.flock, 1) : !flockTransferDone(r.flock));
    return base.slice().sort((a, b) => Number(needs(b)) - Number(needs(a)));
  }, [mode, rowsC1, rowsC2]);
  const pendingC1 = rowsC1.filter((r) => !flockHasCandling(r.flock, 1)).length;
  const pendingC2 = rowsC2.filter((r) => !flockHasCandling(r.flock, 2)).length;
  const catCols = mode === "c1" ? CANDLING_1_CATEGORIES : CANDLING_2_CATEGORIES;

  const selected = useMemo(() => {
    if (!sel) return null;
    const b = batches.find((x) => x.id === sel.batchId);
    if (!b) return null;
    const flock = batchFlocks(b)[sel.idx];
    return flock ? { batch: b, flock } : null;
  }, [sel, batches]);

  const phase: "c1" | "c2" | "transfer" | null = !selected
    ? null
    : editStage === 1 ? "c1"
    : editStage === 2 ? "c2"
    : !flockHasCandling(selected.flock, 1) ? "c1"
    : !flockHasCandling(selected.flock, 2) ? "c2"
    : "transfer";

  const catDefs = phase === "c1" ? CANDLING_1_CATEGORIES : CANDLING_2_CATEGORIES;
  const catTotal = candlingTotal(Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Number(v) || 0])));
  const fertileC2 = selected ? flockFertileAfterC2(selected.flock) : 0;
  const assignedTotal = tRows.reduce((s, r) => s + (Number(r.eggs) || 0), 0);
  const hatcherFree = (machineCode: string, selfIndex: number) => {
    const m = hatchers.find((x) => x.code === machineCode);
    if (!m) return 0;
    const other = tRows.reduce((s, r, i) => (i !== selfIndex && r.machineCode === machineCode ? s + (Number(r.eggs) || 0) : s), 0);
    return machineFreeCapacity(m, batches, "transfers") - other;
  };

  // Summary for the active tab.
  const stageNum: 1 | 2 = mode === "c1" ? 1 : 2;
  const modeRows = mode === "c1" ? rowsC1 : rowsC2;
  const eggsSetTotal = modeRows.reduce((s, r) => s + r.flock.eggsSet, 0);
  const candledRows = modeRows.filter((r) => flockHasCandling(r.flock, stageNum));
  const candledEggs = candledRows.reduce((s, r) => s + r.flock.eggsSet, 0);
  const removedTotal = candledRows.reduce((s, r) => s + Object.values(catCounts(r.flock, stageNum)).reduce((a, b) => a + b, 0), 0);
  const candledPct = eggsSetTotal > 0 ? (candledEggs / eggsSetTotal) * 100 : 0;
  const removedPct = eggsSetTotal > 0 ? (removedTotal / eggsSetTotal) * 100 : 0;

  // Filter + paginate.
  const s = q.trim().toLowerCase();
  const filtered = rows.filter((r) => (productF === "all" || r.batch.productType === productF) && (!s || r.batch.batchNo.toLowerCase().includes(s) || r.flock.flockId.toLowerCase().includes(s) || r.flock.farm.toLowerCase().includes(s)));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  // Deep link from a batch's "Start Candling I/II": ?batch=<id>&stage=c1|c2 —
  // switch to the right tab, filter to that batch and open the record form for
  // the first flock still needing that stage. Runs once the batches have loaded.
  const openedRef = useRef<string | null>(null);
  useEffect(() => {
    const bId = search.get("batch");
    if (!bId) return;
    const stg = search.get("stage") === "c2" ? "c2" : "c1";
    const key = `${bId}|${stg}`;
    if (openedRef.current === key) return;
    const b = batches.find((x) => x.id === bId);
    if (!b) return; // batches not loaded yet — retry when they arrive
    openedRef.current = key;
    const flocks = batchFlocks(b);
    const idx = flocks.findIndex((f) =>
      stg === "c1" ? !flockHasCandling(f, 1) : (flockHasCandling(f, 1) && !flockHasCandling(f, 2))
    );
    /* eslint-disable react-hooks/set-state-in-effect */
    setMode(stg);
    setQ(b.batchNo);
    setPage(1);
    if (idx >= 0) { setSel({ batchId: bId, idx }); setEditStage(null); setCats({}); setTRows([{ machineCode: "", eggs: "" }]); }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [search, batches]);

  if (!user) return null;

  function switchMode(m: "c1" | "c2") { setMode(m); setSel(null); setEditStage(null); setCats({}); setTRows([{ machineCode: "", eggs: "" }]); setErr(null); setPage(1); }
  function selectFlock(batchId: string, idx: number) { setSel({ batchId, idx }); setEditStage(null); setCats({}); setTRows([{ machineCode: "", eggs: "" }]); setErr(null); }
  function editFlock(batchId: string, idx: number, stage: 1 | 2) {
    const b = batches.find((x) => x.id === batchId);
    if (!b) return;
    const flock = batchFlocks(b)[idx];
    const rec = [...(flock?.candlings ?? [])].reverse().find((c) => c.stage === stage);
    setSel({ batchId, idx });
    setEditStage(stage);
    setCats(rec ? Object.fromEntries(Object.entries(rec.categories).map(([k, v]) => [k, String(v)])) : {});
    setTRows([{ machineCode: "", eggs: "" }]);
    setErr(null);
  }
  function closeModal() { setSel(null); setEditStage(null); setCats({}); setErr(null); }

  function saveCandling(stage: 1 | 2) {
    setErr(null);
    if (!selected || !sel) return;
    const flocks = batchFlocks(selected.batch).slice();
    const target = { ...flocks[sel.idx] };
    const categories = Object.fromEntries(catDefs.map((c) => [c.key, Number(cats[c.key]) || 0]));
    const totalRem = candlingTotal(categories);
    const avail = stage === 1 ? target.eggsSet : flockFertileAfterC1(target);
    if (totalRem > avail) return setErr(`Cannot remove more than ${avail.toLocaleString()} eggs from this flock.`);
    if (editStage) {
      const existingIdx = target.candlings.map((c, i) => ({ c, i })).filter((x) => x.c.stage === stage).map((x) => x.i).pop();
      if (existingIdx != null) {
        target.candlings = target.candlings.map((c, i) => i === existingIdx ? { ...c, categories, totalRemoved: totalRem, by: user!.email, on: nowISO() } : c);
      } else {
        target.candlings = [...target.candlings, { stage, date: todayISO(), categories, totalRemoved: totalRem, by: user!.email, on: nowISO() }];
      }
    } else {
      const rec: Candling = { stage, date: todayISO(), categories, totalRemoved: totalRem, by: user!.email, on: nowISO() };
      target.candlings = [...target.candlings, rec];
    }
    flocks[sel.idx] = target;
    let nb: Batch = recomputeBatchAggregates({ ...selected.batch, flocks });
    if (!editStage && batchFlocks(nb).every((f) => flockHasCandling(f, stage))) {
      nb = markStep(nb, stage === 1 ? "candling-1" : "candling-2", user!);
    }
    upsertBatch(nb);
    toast(`Candling ${stage === 1 ? "I" : "II"} ${editStage ? "updated" : "recorded"} for flock ${target.flockId} — ${totalRem.toLocaleString()} removed.`);
    closeModal();
  }

  function saveTransfer() {
    setErr(null);
    if (!selected || !sel) return;
    const flocks = batchFlocks(selected.batch).slice();
    const target = { ...flocks[sel.idx] };
    const list: MachineAssignment[] = tRows
      .map((r) => ({ machineCode: r.machineCode, eggs: Number(r.eggs) || 0 }))
      .filter((a) => a.machineCode && a.eggs > 0);
    if (list.length === 0) return setErr("Select a hatcher and enter the number of eggs.");
    if (assignedTotal > flockFertileAfterC2(target)) return setErr(`Only ${flockFertileAfterC2(target).toLocaleString()} fertile eggs to transfer for this flock.`);
    const perMachine = new Map<string, number>();
    for (const a of list) perMachine.set(a.machineCode, (perMachine.get(a.machineCode) ?? 0) + a.eggs);
    for (const [mc, eggs] of perMachine) {
      const m = hatchers.find((x) => x.code === mc)!;
      if (eggs > machineFreeCapacity(m, batches, "transfers")) return setErr(`${mc} has no room for ${eggs.toLocaleString()}.`);
    }
    target.transfers = list;
    flocks[sel.idx] = target;
    let nb: Batch = recomputeBatchAggregates({ ...selected.batch, flocks });
    if (batchFlocks(nb).every(flockTransferDone)) nb = markStep(nb, "transfer", user!);
    upsertBatch(nb);
    const nextBatches = batches.map((b) => (b.id === nb.id ? nb : b));
    const touched = [...list.map((a) => a.machineCode), ...(nb.setters ?? []).map((sx) => sx.machineCode)];
    machinesToSync(machines, touched, nextBatches).forEach(upsertMachine);
    toast(`Transferred ${assignedTotal.toLocaleString()} eggs for flock ${target.flockId}.`);
    setSel(null); setTRows([{ machineCode: "", eggs: "" }]);
  }

  const romans = mode === "c1" ? "I" : "II";

  return (
    <div className="space-y-5">
      {/* Tabs (stick below the app top bar while scrolling) */}
      <div className="sticky top-16 z-20 -mx-4 border-b border-line bg-cream/90 px-4 py-2.5 backdrop-blur md:-mx-8 md:px-8">
        <div className="inline-flex rounded-xl border border-line bg-paper p-1">
          <button type="button" onClick={() => switchMode("c1")} className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${mode === "c1" ? "bg-gold text-[#231b04] shadow-sm" : "text-muted hover:text-ink"}`}>Candling I ({pendingC1} to candle)</button>
          <button type="button" onClick={() => switchMode("c2")} className={`rounded-lg px-4 py-1.5 text-sm font-semibold transition ${mode === "c2" ? "bg-gold text-[#231b04] shadow-sm" : "text-muted hover:text-ink"}`}>Candling II ({pendingC2} to candle)</button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<IcoEgg />} tone="gold" value={modeRows.filter((r) => !flockHasCandling(r.flock, stageNum)).length.toLocaleString()} label="Flocks to candle" sub="Total flocks" />
        <StatCard icon={<IcoEgg />} tone="green" value={eggsSetTotal.toLocaleString()} label="Eggs set" sub="Total eggs set" />
        <StatCard icon={<IcoChick />} tone="gold" value={candledEggs.toLocaleString()} label="Candled so far" sub={`${candledPct.toFixed(1)}% of eggs set`} />
        <StatCard icon={<IcoTrash />} tone="red" value={removedTotal.toLocaleString()} label="Removed (total)" sub={`${removedPct.toFixed(1)}% of eggs set`} />
      </div>

      <Card>
        <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[0.95rem] font-bold text-ink">Candling {romans} — flocks ({modeRows.length})</h2>
            <p className="text-xs text-muted">Percentages are each category removed ÷ eggs set. Candled flocks stay listed with their result.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full max-w-xs">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
              <Input className="pl-9" placeholder="Search batch or flock…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
            <div className="w-40"><Select value={productF} onChange={(e) => { setProductF(e.target.value); setPage(1); }} options={[{ value: "all", label: "All products" }, ...PRODUCTS.map((p) => ({ value: p, label: p }))]} /></div>
          </div>
        </div>

        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Flock</Th>
              <Th className="text-right">Eggs set</Th>
              {catCols.map((c) => <Th key={c.key} className="text-right">{c.label}</Th>)}
              <Th className="text-right">Fertile</Th>
              <Th>Candling {romans} due</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={6 + catCols.length} text={mode === "c1" ? "No flocks in candling." : "No flocks have had Candling I yet."} />
            ) : pageRows.map(({ batch, flock, idx }) => {
              const stage: 1 | 2 = mode === "c1" ? 1 : 2;
              const candled = flockHasCandling(flock, stage);
              const counts = catCounts(flock, stage);
              const fertile = mode === "c1" ? flockFertileAfterC1(flock) : flockFertileAfterC2(flock);
              const fertilePct = flock.eggsSet ? (fertile / flock.eggsSet) * 100 : 0;
              const needsAction = mode === "c1" ? !flockHasCandling(flock, 1) : !flockTransferDone(flock);
              const actionLabel = mode === "c1" ? "Candle I" : flockHasCandling(flock, 2) ? "Transfer" : "Candle II";
              return (
                <tr key={`${batch.id}-${idx}`} onClick={() => router.push(`/hatchery/batches/${batch.id}`)} className={`cursor-pointer transition hover:bg-cream/50 ${candled ? "bg-green-bg/40" : ""}`}>
                  <Td className="whitespace-nowrap"><span className="font-medium text-gold-dark">{batch.batchNo}</span></Td>
                  <Td><div className="font-medium text-ink">{flock.farm} · {flock.flockId}</div><div className="text-xs text-muted">{batch.productType}</div></Td>
                  <Td className="text-right tabular-nums">{flock.eggsSet.toLocaleString()}</Td>
                  {catCols.map((c) => {
                    const n = counts[c.key] ?? 0;
                    const pct = candled && flock.eggsSet ? (n / flock.eggsSet) * 100 : null;
                    return (
                      <Td key={c.key} className="text-right tabular-nums">
                        {pct === null ? <span className="text-muted">—</span> : <><div style={{ color: CAT_COLOR[c.key] }} className="font-semibold">{pct.toFixed(1)}%</div><div className="text-[11px] text-muted">{n.toLocaleString()}</div></>}
                      </Td>
                    );
                  })}
                  <Td className="text-right tabular-nums"><div className="font-semibold text-green">{fertile.toLocaleString()}</div>{candled && <div className="text-[11px] text-muted">{fertilePct.toFixed(1)}%</div>}</Td>
                  <Td><DueCell setDate={setDateOf(batch)} day={CANDLE_DAY[mode]} candled={candled} candledDate={candledOn(flock, stage)} /></Td>
                  <Td>
                    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                      {canAct && needsAction ? (
                        <Button size="sm" onClick={() => selectFlock(batch.id, idx)}>{actionLabel}</Button>
                      ) : (
                        <Pill tone="green">{mode === "c1" ? "Candled ✓" : flockHasCandling(flock, 2) ? "Transferred" : "C2 ✓"}</Pill>
                      )}
                      {canEdit && flockHasCandling(flock, stage) && (
                        <Button size="sm" variant="ghost" onClick={() => editFlock(batch.id, idx, stage)}>Edit</Button>
                      )}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No flocks" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} flocks`}</span>
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
      </Card>

      {/* Info + legend */}
      <div className="rounded-xl border border-green/30 bg-green-bg/40 px-4 py-2.5 text-sm text-ink">
        <span className="font-semibold">ⓘ</span> Candling {romans} is usually done on <strong>day {CANDLE_DAY[mode]}</strong> of incubation ({CANDLE_DAY[mode]} days after the batch was set).
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 rounded-xl border border-line bg-paper px-4 py-3">
        {catCols.map((c) => (
          <span key={c.key} className="inline-flex items-center gap-2 text-xs">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: CAT_COLOR[c.key] }} />
            <span className="font-semibold text-ink">{c.label}</span><span className="text-muted">{CAT_DESC[c.key] ?? ""}</span>
          </span>
        ))}
        <span className="inline-flex items-center gap-2 text-xs">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-green" />
          <span className="font-semibold text-ink">Fertile</span><span className="text-muted">Good embryos</span>
        </span>
      </div>

      {/* Candling record modal */}
      {selected && canAct && (phase === "c1" || phase === "c2") && (
        <Modal
          open
          onClose={closeModal}
          title={`${editStage ? "Edit " : ""}Candling ${phase === "c1" ? "I" : "II"} — ${selected.flock.farm} · flock ${selected.flock.flockId} (${selected.batch.batchNo})`}
          footer={<><Button variant="ghost" onClick={() => setSel(null)}>Cancel</Button><Button onClick={() => saveCandling(phase === "c1" ? 1 : 2)}>Save candling {phase === "c1" ? "I" : "II"}</Button></>}
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {catDefs.map((c) => (
                <Field key={c.key} label={c.label}>
                  <Input type="number" min={0} value={cats[c.key] ?? ""} onChange={(e) => setCats({ ...cats, [c.key]: e.target.value })} />
                </Field>
              ))}
            </div>
            <p className="text-sm">Total removed: <strong>{catTotal.toLocaleString()}</strong> · fertile so far {(selected.flock.eggsSet - (Object.values(cats).reduce((sm, v) => sm + (Number(v) || 0), 0))).toLocaleString()}</p>
            {err && <p className="text-sm text-status-refunded">{err}</p>}
          </div>
        </Modal>
      )}

      {/* Transfer modal */}
      {selected && canAct && phase === "transfer" && (
        <Modal
          open
          onClose={() => setSel(null)}
          title={`Transfer flock ${selected.flock.flockId} — ${selected.batch.batchNo}`}
          footer={<><Button variant="ghost" onClick={() => setSel(null)}>Cancel</Button>{hatchers.length > 0 && <Button onClick={saveTransfer}>Transfer flock</Button>}</>}
        >
          <div className="space-y-3">
            <p className="text-sm text-muted">Candling done for this flock. Transfer its {fertileC2.toLocaleString()} fertile eggs to hatcher machine(s).</p>
            {hatchers.length === 0 ? (
              <p className="text-sm text-status-refunded">No hatcher machines. Create one on the Machines page.</p>
            ) : (
              <>
                {tRows.map((row, i) => (
                  <div key={i} className="grid grid-cols-[1.4fr_1fr_auto] items-end gap-2">
                    <Field label="Hatcher">
                      <Select value={row.machineCode}
                        onChange={(e) => setTRows(tRows.map((r, j) => (j === i ? { ...r, machineCode: e.target.value } : r)))}
                        placeholder="Select hatcher"
                        options={hatchers.map((m) => ({ value: m.code, label: `${m.code} (free ${Math.max(0, hatcherFree(m.code, i)).toLocaleString()})` }))} />
                    </Field>
                    <Field label={row.machineCode ? `Eggs (≤ ${Math.max(0, hatcherFree(row.machineCode, i)).toLocaleString()})` : "Eggs"}>
                      <Input type="number" min={0} value={row.eggs} onChange={(e) => setTRows(tRows.map((r, j) => (j === i ? { ...r, eggs: e.target.value } : r)))} />
                    </Field>
                    <Button size="sm" variant="ghost" onClick={() => setTRows(tRows.length === 1 ? tRows : tRows.filter((_, j) => j !== i))} disabled={tRows.length === 1}>Remove</Button>
                  </div>
                ))}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setTRows([...tRows, { machineCode: "", eggs: "" }])}>+ Add hatcher</Button>
                  <p className="text-sm">
                    Assigned <strong>{assignedTotal.toLocaleString()}</strong> / {fertileC2.toLocaleString()} fertile ·{" "}
                    {assignedTotal > fertileC2 ? (
                      <span className="font-semibold text-status-refunded">over by {(assignedTotal - fertileC2).toLocaleString()}</span>
                    ) : assignedTotal === fertileC2 ? (
                      <span className="font-semibold text-green">all transferred ✓</span>
                    ) : (
                      <span className="font-semibold text-ink">{(fertileC2 - assignedTotal).toLocaleString()} left to transfer</span>
                    )}
                  </p>
                </div>
              </>
            )}
            {err && <p className="text-sm text-status-refunded">{err}</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---- due cell + stat card + icons -----------------------------------------

function DueCell({ setDate, day, candled, candledDate }: { setDate: string; day: number; candled: boolean; candledDate?: string }) {
  if (candled) {
    return <span className="whitespace-nowrap text-xs font-semibold text-green">✓ Candled{candledDate ? ` ${formatDate(candledDate)}` : ""}</span>;
  }
  const due = addDaysISO(setDate, day);
  const n = daysUntil(due);
  const tone = n < 0 ? "red" : n <= 2 ? "amber" : "green";
  const label = n < 0 ? `Overdue ${-n}d` : n === 0 ? "Due today" : `In ${n}d`;
  return (
    <div className="whitespace-nowrap">
      <div className="text-xs font-medium text-ink">{formatDate(due)}</div>
      <Pill tone={tone}>{label}</Pill>
    </div>
  );
}

type CardTone = "green" | "gold" | "blue" | "red" | "default";
const CARD_CHIP: Record<CardTone, string> = {
  green: "bg-green-bg text-green", gold: "bg-gold-bg text-gold-dark", blue: "bg-blue-bg text-blue", red: "bg-red-bg text-red", default: "bg-grey-bg text-ink",
};
function StatCard({ icon, value, label, sub, tone = "default" }: { icon: ReactNode; value: string; label: string; sub?: string; tone?: CardTone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 shadow-card">
      <span className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl ${CARD_CHIP[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.6rem] font-bold uppercase tracking-[0.08em] text-muted">{label}</p>
        <p className="truncate text-[1.35rem] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</p>
        {sub && <p className="mt-0.5 truncate text-[0.62rem] text-muted">{sub}</p>}
      </div>
    </div>
  );
}

const csvg = (children: ReactNode) => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoEgg = () => csvg(<ellipse cx="12" cy="13" rx="6" ry="8" />);
const IcoChick = () => csvg(<><ellipse cx="12" cy="13.5" rx="6" ry="7" /><path d="M12 6.5V4" /><circle cx="10" cy="12" r=".6" fill="currentColor" /></>);
const IcoTrash = () => csvg(<><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" /></>);

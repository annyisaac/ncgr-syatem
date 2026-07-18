"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Modal } from "@/components/ui/Modal";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { todayISO, nowISO } from "@/lib/format";
import {
  CANDLING_1_CATEGORIES, CANDLING_2_CATEGORIES,
  type Batch, type BatchFlock, type Candling, type MachineAssignment,
} from "@/lib/hatchery/types";
import {
  candlingTotal, markStep, machineFreeCapacity,
  batchFlocks, flockHasCandling, flockFertileAfterC1, flockFertileAfterC2,
  flockTransferDone, recomputeBatchAggregates,
} from "@/lib/hatchery/lifecycle";

const CAN_ACT = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

interface FlockRow { batch: Batch; flock: BatchFlock; idx: number; }

/** Sum a flock's removal categories for a candling stage. */
function catCounts(f: BatchFlock, stage: 1 | 2): Record<string, number> {
  const out: Record<string, number> = {};
  for (const c of f.candlings) if (c.stage === stage) {
    for (const [k, v] of Object.entries(c.categories)) out[k] = (out[k] ?? 0) + (Number(v) || 0);
  }
  return out;
}

export default function CandlingPage() {
  const { user } = useAuth();
  const { batches, machines, upsertBatch } = useHatchery();
  const { toast } = useToast();

  const [mode, setMode] = useState<"c1" | "c2">("c1");
  const [sel, setSel] = useState<{ batchId: string; idx: number } | null>(null);
  const [cats, setCats] = useState<Record<string, string>>({});
  const [tRows, setTRows] = useState<{ machineCode: string; eggs: string }[]>([{ machineCode: "", eggs: "" }]);
  const [err, setErr] = useState<string | null>(null);

  const canAct = !!user && CAN_ACT.includes(user.role);
  const hatchers = machines.filter((m) => m.type === "hatcher" && m.active);

  // Flocks in the candling phase. Candling I shows every flock (candled + to
  // candle); Candling II shows those that have had candling 1. Each row = one flock.
  const { rowsC1, rowsC2 } = useMemo(() => {
    const c1: FlockRow[] = [];
    const c2: FlockRow[] = [];
    // Newest batch first, oldest last.
    const ordered = batches.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    for (const b of ordered) {
      // Keep flocks on the candling page through candling AND transfer — they
      // only drop off once the batch has hatched (moved past candling).
      if (!(b.steps["setting"] && !b.steps["hatching"] && b.status === "active")) continue;
      batchFlocks(b).forEach((f, idx) => {
        c1.push({ batch: b, flock: f, idx });
        if (flockHasCandling(f, 1)) c2.push({ batch: b, flock: f, idx });
      });
    }
    return { rowsC1: c1, rowsC2: c2 };
  }, [batches]);
  // Flocks still to act on stay at the top; already-candled ones drop to the
  // bottom (kept in the list). Stable, so newest-batch order holds within each.
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
    : !flockHasCandling(selected.flock, 1) ? "c1"
    : !flockHasCandling(selected.flock, 2) ? "c2"
    : "transfer";

  const catDefs = phase === "c1" ? CANDLING_1_CATEGORIES : CANDLING_2_CATEGORIES;
  const catTotal = candlingTotal(Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Number(v) || 0])));
  const fertileC2 = selected ? flockFertileAfterC2(selected.flock) : 0;
  const assignedTotal = tRows.reduce((s, r) => s + (Number(r.eggs) || 0), 0);
  // Hatcher free capacity, minus what other rows in this form already claim.
  const hatcherFree = (machineCode: string, selfIndex: number) => {
    const m = hatchers.find((x) => x.code === machineCode);
    if (!m) return 0;
    const other = tRows.reduce((s, r, i) => (i !== selfIndex && r.machineCode === machineCode ? s + (Number(r.eggs) || 0) : s), 0);
    return machineFreeCapacity(m, batches, "transfers") - other;
  };

  if (!user) return null;

  function switchMode(m: "c1" | "c2") { setMode(m); setSel(null); setCats({}); setTRows([{ machineCode: "", eggs: "" }]); setErr(null); }
  function selectFlock(batchId: string, idx: number) { setSel({ batchId, idx }); setCats({}); setTRows([{ machineCode: "", eggs: "" }]); setErr(null); }

  function saveCandling(stage: 1 | 2) {
    setErr(null);
    if (!selected || !sel) return;
    const flocks = batchFlocks(selected.batch).slice();
    const target = { ...flocks[sel.idx] };
    const categories = Object.fromEntries(catDefs.map((c) => [c.key, Number(cats[c.key]) || 0]));
    const total = candlingTotal(categories);
    const avail = stage === 1 ? target.eggsSet : flockFertileAfterC1(target);
    if (total > avail) return setErr(`Cannot remove more than ${avail.toLocaleString()} eggs from this flock.`);
    const rec: Candling = { stage, date: todayISO(), categories, totalRemoved: total, by: user!.email, on: nowISO() };
    target.candlings = [...target.candlings, rec];
    flocks[sel.idx] = target;
    let nb: Batch = recomputeBatchAggregates({ ...selected.batch, flocks });
    if (batchFlocks(nb).every((f) => flockHasCandling(f, stage))) {
      nb = markStep(nb, stage === 1 ? "candling-1" : "candling-2", user!);
    }
    upsertBatch(nb);
    toast(`Candling ${stage === 1 ? "I" : "II"} recorded for flock ${target.flockId} — ${total.toLocaleString()} removed.`);
    setSel(null); setCats({});
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
    toast(`Transferred ${assignedTotal.toLocaleString()} eggs for flock ${target.flockId}.`);
    setSel(null); setTRows([{ machineCode: "", eggs: "" }]);
  }

  return (
    <div className="space-y-5">
      <p className="-mt-2 text-sm text-muted">Candling is done flock by flock. Each row is one flock inside its batch.</p>

      <div className="flex flex-wrap gap-2">
        <Button variant={mode === "c1" ? "primary" : "ghost"} onClick={() => switchMode("c1")}>Candling I ({pendingC1} to candle)</Button>
        <Button variant={mode === "c2" ? "primary" : "ghost"} onClick={() => switchMode("c2")}>Candling II ({pendingC2} to candle)</Button>
      </div>

      {selected && canAct && (phase === "c1" || phase === "c2") && (
        <Modal
          open
          onClose={() => setSel(null)}
          title={`Candling ${phase === "c1" ? "I" : "II"} — ${selected.flock.farm} · flock ${selected.flock.flockId} (${selected.batch.batchNo})`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSel(null)}>Cancel</Button>
              <Button onClick={() => saveCandling(phase === "c1" ? 1 : 2)}>Save candling {phase === "c1" ? "I" : "II"}</Button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {catDefs.map((c) => (
                <Field key={c.key} label={c.label}>
                  <Input type="number" min={0} value={cats[c.key] ?? ""} onChange={(e) => setCats({ ...cats, [c.key]: e.target.value })} />
                </Field>
              ))}
            </div>
            <p className="text-sm">Total removed: <strong>{catTotal.toLocaleString()}</strong> · fertile so far {(selected.flock.eggsSet - (Object.values(cats).reduce((s, v) => s + (Number(v) || 0), 0))).toLocaleString()}</p>
            {err && <p className="text-sm text-status-refunded">{err}</p>}
          </div>
        </Modal>
      )}

      {selected && canAct && phase === "transfer" && (
        <Modal
          open
          onClose={() => setSel(null)}
          title={`Transfer flock ${selected.flock.flockId} — ${selected.batch.batchNo}`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setSel(null)}>Cancel</Button>
              {hatchers.length > 0 && <Button onClick={saveTransfer}>Transfer flock</Button>}
            </>
          }
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

      <Card>
        <CardHeader title={mode === "c1" ? `Candling I — flocks (${rowsC1.length})` : `Candling II — flocks (${rowsC2.length})`} />
        <p className="mb-2 text-xs text-muted">Percentages are each category removed ÷ eggs set. Candled flocks stay listed with their result.</p>
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Flock</Th>
              <Th className="text-right">Eggs set</Th>
              {catCols.map((c) => <Th key={c.key} className="text-right">{c.label}</Th>)}
              <Th className="text-right">Fertile</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={5 + catCols.length} text={mode === "c1" ? "No flocks in candling." : "No flocks have had Candling I yet."} />
            ) : (
              rows.map(({ batch, flock, idx }) => {
                const stage: 1 | 2 = mode === "c1" ? 1 : 2;
                const isSel = sel?.batchId === batch.id && sel?.idx === idx;
                const candled = flockHasCandling(flock, stage);
                const counts = catCounts(flock, stage);
                const fertile = mode === "c1" ? flockFertileAfterC1(flock) : flockFertileAfterC2(flock);
                const needsAction = mode === "c1" ? !flockHasCandling(flock, 1) : !flockTransferDone(flock);
                const actionLabel = mode === "c1" ? "Candle I" : flockHasCandling(flock, 2) ? "Transfer" : "Candle II";
                return (
                  <tr key={`${batch.id}-${idx}`} className={isSel ? "bg-gold-bg" : candled ? "bg-green-bg" : undefined}>
                    <Td className="font-medium">{batch.batchNo}</Td>
                    <Td>{flock.farm} · {flock.flockId}</Td>
                    <Td className="text-right">{flock.eggsSet.toLocaleString()}</Td>
                    {catCols.map((c) => {
                      const pct = candled && flock.eggsSet ? ((counts[c.key] ?? 0) / flock.eggsSet) * 100 : null;
                      return (
                        <Td key={c.key} className="text-right">
                          {pct === null ? <span className="text-muted">—</span> : `${pct.toFixed(1)}%`}
                        </Td>
                      );
                    })}
                    <Td className="text-right">{fertile.toLocaleString()}</Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        {canAct && needsAction ? (
                          <Button size="sm" onClick={() => selectFlock(batch.id, idx)}>{actionLabel}</Button>
                        ) : (
                          <Pill tone="green">{mode === "c1" ? "C1 ✓" : flockHasCandling(flock, 2) ? "Transferred" : "C2 ✓"}</Pill>
                        )}
                        <Link href={`/hatchery/batches/${batch.id}`} className="inline-flex items-center rounded-md border border-line px-2.5 py-1 text-[0.72rem] font-semibold text-ink transition hover:border-gold hover:bg-gold-bg">View</Link>
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
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

export default function CandlingPage() {
  const { user } = useAuth();
  const { batches, machines, upsertBatch } = useHatchery();
  const { toast } = useToast();

  const [mode, setMode] = useState<"c1" | "c2">("c1");
  const [sel, setSel] = useState<{ batchId: string; idx: number } | null>(null);
  const [cats, setCats] = useState<Record<string, string>>({});
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const canAct = !!user && CAN_ACT.includes(user.role);
  const hatchers = machines.filter((m) => m.type === "hatcher" && m.active);

  // Every flock that still needs work, split by stage. Each row = one flock.
  const { rowsC1, rowsC2 } = useMemo(() => {
    const c1: FlockRow[] = [];
    const c2: FlockRow[] = [];
    for (const b of batches) {
      if (!(b.steps["setting"] && !b.steps["transfer"] && b.status === "active")) continue;
      batchFlocks(b).forEach((f, idx) => {
        if (!flockHasCandling(f, 1)) c1.push({ batch: b, flock: f, idx });
        else if (!flockTransferDone(f)) c2.push({ batch: b, flock: f, idx });
      });
    }
    return { rowsC1: c1, rowsC2: c2 };
  }, [batches]);
  const rows = mode === "c1" ? rowsC1 : rowsC2;

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
  const assignedTotal = Object.values(assign).reduce((s, v) => s + (Number(v) || 0), 0);

  if (!user) return null;

  function switchMode(m: "c1" | "c2") { setMode(m); setSel(null); setCats({}); setAssign({}); setErr(null); }
  function selectFlock(batchId: string, idx: number) { setSel({ batchId, idx }); setCats({}); setAssign({}); setErr(null); }

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
    toast(`Candling ${stage} recorded for flock ${target.flockId} — ${total.toLocaleString()} removed.`);
    setSel(null); setCats({});
  }

  function saveTransfer() {
    setErr(null);
    if (!selected || !sel) return;
    const flocks = batchFlocks(selected.batch).slice();
    const target = { ...flocks[sel.idx] };
    const list: MachineAssignment[] = hatchers
      .map((m) => ({ machineCode: m.code, eggs: Number(assign[m.code]) || 0 }))
      .filter((a) => a.eggs > 0);
    if (list.length === 0) return setErr("Assign eggs to at least one hatcher.");
    if (assignedTotal > flockFertileAfterC2(target)) return setErr(`Only ${flockFertileAfterC2(target).toLocaleString()} fertile eggs to transfer for this flock.`);
    for (const a of list) {
      const m = hatchers.find((x) => x.code === a.machineCode)!;
      if (a.eggs > machineFreeCapacity(m, batches, "transfers")) return setErr(`${a.machineCode} has no room for ${a.eggs.toLocaleString()}.`);
    }
    target.transfers = list;
    flocks[sel.idx] = target;
    let nb: Batch = recomputeBatchAggregates({ ...selected.batch, flocks });
    if (batchFlocks(nb).every(flockTransferDone)) nb = markStep(nb, "transfer", user!);
    upsertBatch(nb);
    toast(`Transferred ${assignedTotal.toLocaleString()} eggs for flock ${target.flockId}.`);
    setSel(null); setAssign({});
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Candling</h1>
      <p className="-mt-2 text-sm text-muted">Candling is done flock by flock. Each row is one flock inside its batch.</p>

      <div className="flex flex-wrap gap-2">
        <Button variant={mode === "c1" ? "primary" : "ghost"} onClick={() => switchMode("c1")}>Candling I ({rowsC1.length})</Button>
        <Button variant={mode === "c2" ? "primary" : "ghost"} onClick={() => switchMode("c2")}>Candling II ({rowsC2.length})</Button>
      </div>

      <Card>
        <CardHeader title={mode === "c1" ? `Flocks to candle — Candling I (${rowsC1.length})` : `Flocks for Candling II / transfer (${rowsC2.length})`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Flock</Th>
              <Th className="text-right">Eggs set</Th>
              <Th className="text-right">{mode === "c1" ? "Fertile" : "Fertile (after C1)"}</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} text={mode === "c1" ? "No flocks awaiting Candling I." : "No flocks awaiting Candling II."} />
            ) : (
              rows.map(({ batch, flock, idx }) => {
                const isSel = sel?.batchId === batch.id && sel?.idx === idx;
                const fertile = mode === "c1" ? flock.eggsSet : flockFertileAfterC1(flock);
                const actionLabel = mode === "c1" ? "Candle I" : flockHasCandling(flock, 2) ? "Transfer" : "Candle II";
                return (
                  <tr key={`${batch.id}-${idx}`} className={isSel ? "bg-gold-bg" : undefined}>
                    <Td className="font-medium">{batch.batchNo}</Td>
                    <Td>{flock.farm} · {flock.flockId}</Td>
                    <Td className="text-right">{flock.eggsSet.toLocaleString()}</Td>
                    <Td className="text-right">{fertile.toLocaleString()}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Pill tone={flockHasCandling(flock, 1) ? "green" : "gold"}>C1 {flockHasCandling(flock, 1) ? "✓" : "pending"}</Pill>
                        {mode === "c2" && <Pill tone={flockHasCandling(flock, 2) ? "green" : "gold"}>C2 {flockHasCandling(flock, 2) ? "✓" : "pending"}</Pill>}
                      </div>
                    </Td>
                    <Td>
                      <div className="flex gap-1">
                        {canAct && <Button size="sm" onClick={() => selectFlock(batch.id, idx)}>{actionLabel}</Button>}
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

      {selected && canAct && (phase === "c1" || phase === "c2") && (
        <Card>
          <CardHeader title={`Candling ${phase === "c1" ? 1 : 2} — ${selected.flock.farm} · flock ${selected.flock.flockId} (${selected.batch.batchNo})`} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {catDefs.map((c) => (
              <Field key={c.key} label={c.label}>
                <Input type="number" min={0} value={cats[c.key] ?? ""} onChange={(e) => setCats({ ...cats, [c.key]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">Total removed: <strong>{catTotal.toLocaleString()}</strong></p>
            <Button onClick={() => saveCandling(phase === "c1" ? 1 : 2)}>Save candling {phase === "c1" ? 1 : 2}</Button>
          </div>
          {err && <p className="mt-2 text-sm text-status-refunded">{err}</p>}
        </Card>
      )}

      {selected && canAct && phase === "transfer" && (
        <Card>
          <CardHeader title={`Transfer flock ${selected.flock.flockId} — ${selected.batch.batchNo}`} />
          <p className="mb-3 text-sm text-muted">Candling done for this flock. Transfer its {fertileC2.toLocaleString()} fertile eggs to hatcher machine(s).</p>
          {hatchers.length === 0 ? (
            <p className="text-sm text-status-refunded">No hatcher machines. Create one on the Machines page.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                {hatchers.map((m) => (
                  <Field key={m.code} label={`${m.code} (free ${machineFreeCapacity(m, batches, "transfers").toLocaleString()})`}>
                    <Input type="number" min={0} value={assign[m.code] ?? ""} onChange={(e) => setAssign({ ...assign, [m.code]: e.target.value })} />
                  </Field>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm">Total: <strong>{assignedTotal.toLocaleString()}</strong> / {fertileC2.toLocaleString()}</p>
                <Button onClick={saveTransfer}>Transfer flock</Button>
              </div>
            </>
          )}
          {err && <p className="mt-2 text-sm text-status-refunded">{err}</p>}
        </Card>
      )}
    </div>
  );
}

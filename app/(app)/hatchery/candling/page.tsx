"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { todayISO, nowISO } from "@/lib/format";
import {
  CANDLING_1_CATEGORIES, CANDLING_2_CATEGORIES,
  type Batch, type Candling, type MachineAssignment,
} from "@/lib/hatchery/types";
import {
  candlingTotal, hasCandling, markStep, removedInStage, machineFreeCapacity,
} from "@/lib/hatchery/lifecycle";

const CAN_ACT = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

export default function CandlingPage() {
  const { user } = useAuth();
  const { batches, machines, upsertBatch } = useHatchery();
  const { toast } = useToast();

  const [batchId, setBatchId] = useState("");
  const [cats, setCats] = useState<Record<string, string>>({});
  const [assign, setAssign] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const canAct = !!user && CAN_ACT.includes(user.role);
  const hatchers = machines.filter((m) => m.type === "hatcher" && m.active);

  // Batches that are set but not yet transferred.
  const workable = useMemo(
    () => batches.filter((b) => b.steps["setting"] && !b.steps["transfer"] && b.status === "active"),
    [batches]
  );
  const batch = workable.find((b) => b.id === batchId) ?? null;

  const phase: "c1" | "c2" | "transfer" | null = !batch
    ? null
    : !hasCandling(batch, 1) ? "c1"
    : !hasCandling(batch, 2) ? "c2"
    : "transfer";

  const catDefs = phase === "c1" ? CANDLING_1_CATEGORIES : CANDLING_2_CATEGORIES;
  const catTotal = candlingTotal(Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Number(v) || 0])));
  const fertileAfterC1 = batch ? batch.eggsSet - removedInStage(batch, 1) : 0;
  const fertileAfterC2 = batch ? fertileAfterC1 - removedInStage(batch, 2) : 0;
  const assignedTotal = Object.values(assign).reduce((s, v) => s + (Number(v) || 0), 0);

  if (!user) return null;

  function saveCandling(stage: 1 | 2) {
    setErr(null);
    if (!batch) return;
    const categories = Object.fromEntries(catDefs.map((c) => [c.key, Number(cats[c.key]) || 0]));
    const total = candlingTotal(categories);
    const avail = stage === 1 ? batch.eggsSet : fertileAfterC1;
    if (total > avail) return setErr(`Cannot remove more than ${avail} eggs.`);
    const rec: Candling = { stage, date: todayISO(), categories, totalRemoved: total, by: user!.email, on: nowISO() };
    let nb: Batch = { ...batch, candlings: [...batch.candlings, rec] };
    nb = markStep(nb, stage === 1 ? "candling-1" : "candling-2", user!);
    upsertBatch(nb);
    toast(`Candling ${stage} recorded — ${total} removed.`);
    setCats({});
  }

  function saveTransfer() {
    setErr(null);
    if (!batch) return;
    const list: MachineAssignment[] = hatchers
      .map((m) => ({ machineCode: m.code, eggs: Number(assign[m.code]) || 0 }))
      .filter((a) => a.eggs > 0);
    if (list.length === 0) return setErr("Assign eggs to at least one hatcher.");
    if (assignedTotal > fertileAfterC2) return setErr(`Only ${fertileAfterC2} fertile eggs to transfer.`);
    for (const a of list) {
      const m = hatchers.find((x) => x.code === a.machineCode)!;
      if (a.eggs > machineFreeCapacity(m, batches, "transfers")) return setErr(`${a.machineCode} has no room for ${a.eggs}.`);
    }
    upsertBatch(markStep({ ...batch, transfers: list }, "transfer", user!));
    toast(`Transferred ${assignedTotal} eggs to hatcher(s).`);
    setBatchId(""); setAssign({});
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Candling</h1>

      <Card>
        <CardHeader title="Select batch" />
        <Field label="Batch (set, awaiting candling / transfer)">
          <Select value={batchId} onChange={(e) => { setBatchId(e.target.value); setCats({}); setAssign({}); setErr(null); }}
            placeholder={workable.length ? "Select batch" : "No batches awaiting candling"}
            options={workable.map((b) => ({ value: b.id, label: `${b.batchNo} · ${b.eggsSet} eggs` }))} />
        </Field>
        {batch && (
          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Pill tone={hasCandling(batch, 1) ? "green" : "gold"}>Candling 1 {hasCandling(batch, 1) ? "done" : "pending"}</Pill>
            <Pill tone={hasCandling(batch, 2) ? "green" : hasCandling(batch, 1) ? "gold" : "neutral"}>Candling 2 {hasCandling(batch, 2) ? "done" : "pending"}</Pill>
            <Pill tone="info">{fertileAfterC2 > 0 ? `${fertileAfterC2} fertile` : `${fertileAfterC1} fertile (after C1)`}</Pill>
          </div>
        )}
      </Card>

      {batch && canAct && (phase === "c1" || phase === "c2") && (
        <Card>
          <CardHeader title={`Candling ${phase === "c1" ? 1 : 2} — remove eggs`} />
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {catDefs.map((c) => (
              <Field key={c.key} label={c.label}>
                <Input type="number" min={0} value={cats[c.key] ?? ""} onChange={(e) => setCats({ ...cats, [c.key]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">Total removed: <strong>{catTotal}</strong></p>
            <Button onClick={() => saveCandling(phase === "c1" ? 1 : 2)}>Save candling {phase === "c1" ? 1 : 2}</Button>
          </div>
          {err && <p className="mt-2 text-sm text-status-refunded">{err}</p>}
        </Card>
      )}

      {batch && canAct && phase === "transfer" && (
        <Card>
          <CardHeader title="Transfer to hatcher(s)" />
          <p className="mb-3 text-sm text-muted">Candling done. Transfer the {fertileAfterC2.toLocaleString()} fertile eggs to hatcher machine(s).</p>
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
                <p className="text-sm">Total: <strong>{assignedTotal.toLocaleString()}</strong> / {fertileAfterC2.toLocaleString()}</p>
                <Button onClick={saveTransfer}>Transfer</Button>
              </div>
            </>
          )}
          {err && <p className="mt-2 text-sm text-status-refunded">{err}</p>}
        </Card>
      )}
    </div>
  );
}

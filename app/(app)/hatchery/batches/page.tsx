"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";

import { nowISO } from "@/lib/format";
import type { Batch, BatchFlock, MachineAssignment, Reception } from "@/lib/hatchery/types";
import { batchCode, machineFreeCapacity, markStep, stepLabel, settableEggs } from "@/lib/hatchery/lifecycle";

const CAN_SET = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

interface Group { key: string; farm: string; flockId: string; product: Reception["productType"]; recs: Reception[]; eggs: number; date: string; }
/** One assignment line: a flock's eggs going into a setter machine.
 *  `setterOnly` lines have no flock picker — they inherit the flock of the
 *  nearest preceding flock line. */
interface AssignRow { groupKey: string; machineCode: string; eggs: string; setterOnly?: boolean; }

export default function BatchesPage() {
  const { user } = useAuth();
  const { receptions, machines, batches, upsertBatch, upsertReception, newId } = useHatchery();
  const { toast } = useToast();

  const [rowsIn, setRowsIn] = useState<AssignRow[]>([{ groupKey: "", machineCode: "", eggs: "" }]);
  const [err, setErr] = useState<string | null>(null);

  const canSet = !!user && CAN_SET.includes(user.role);
  const setters = machines.filter((m) => m.type === "setter" && m.active);

  // Only receptions marked "ready to set" (and not batched) can be batched.
  const groups: Group[] = useMemo(() => {
    const map = new Map<string, Reception[]>();
    for (const r of receptions) {
      if (r.batchId || r.location !== "ready") continue;
      const key = `${r.farm}||${r.flockId}||${r.productType}`;
      const arr = map.get(key) ?? [];
      arr.push(r);
      map.set(key, arr);
    }
    return [...map.entries()].map(([key, recs]) => ({
      key, farm: recs[0].farm, flockId: recs[0].flockId, product: recs[0].productType,
      recs, eggs: recs.reduce((s, r) => s + settableEggs(r), 0),
      date: recs.map((r) => r.date).sort()[0],
    }));
  }, [receptions]);

  const rows = useMemo(() => batches.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)), [batches]);
  // Resolve each line's flock: setter-only lines inherit the nearest preceding
  // flock line, so changing a flock cascades to its setter lines.
  const resolved = useMemo(() => {
    const eff = (i: number) => { for (let j = i; j >= 0; j--) if (!rowsIn[j].setterOnly) return rowsIn[j].groupKey; return ""; };
    return rowsIn.map((r, i) => ({ ...r, groupKey: r.setterOnly ? eff(i) : r.groupKey }));
  }, [rowsIn]);

  const assignedTotal = rowsIn.reduce((s, r) => s + (Number(r.eggs) || 0), 0);
  const flockCount = new Set(resolved.filter((r) => r.groupKey && (Number(r.eggs) || 0) > 0).map((r) => r.groupKey)).size;

  // Per-flock: how many eggs assigned (across setters) vs settable.
  const flockSummary = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of resolved) if (r.groupKey) m.set(r.groupKey, (m.get(r.groupKey) ?? 0) + (Number(r.eggs) || 0));
    return [...m.entries()].map(([key, assigned]) => {
      const g = groups.find((x) => x.key === key);
      return { key, label: g ? `${g.farm} · Flock ${g.flockId}` : key, assigned, settable: g?.eggs ?? 0 };
    });
  }, [resolved, groups]);

  // Setter free capacity, minus what other rows in this form already claim.
  const rowFree = (machineCode: string, selfIndex: number) => {
    const m = setters.find((x) => x.code === machineCode);
    if (!m) return 0;
    const claimedElsewhere = rowsIn.reduce((s, r, i) => (i !== selfIndex && r.machineCode === machineCode ? s + (Number(r.eggs) || 0) : s), 0);
    return machineFreeCapacity(m, batches, "setters") - claimedElsewhere;
  };
  // A flock's settable eggs, minus what other rows already claim for it.
  const groupFree = (groupKey: string, selfIndex: number) => {
    const g = groups.find((x) => x.key === groupKey);
    if (!g) return 0;
    const claimedElsewhere = resolved.reduce((s, r, i) => (i !== selfIndex && r.groupKey === groupKey ? s + (Number(r.eggs) || 0) : s), 0);
    return g.eggs - claimedElsewhere;
  };

  if (!user) return null;

  // New flock line (blank), vs another setter line for the last flock.
  function addFlock() { setRowsIn([...rowsIn, { groupKey: "", machineCode: "", eggs: "" }]); }
  function addSetter() {
    setRowsIn([...rowsIn, { groupKey: "", machineCode: "", eggs: "", setterOnly: true }]);
  }
  function removeRow(i: number) { setRowsIn(rowsIn.length === 1 ? rowsIn : rowsIn.filter((_, j) => j !== i)); }
  function updateRow(i: number, patch: Partial<AssignRow>) { setRowsIn(rowsIn.map((r, j) => (j === i ? { ...r, ...patch } : r))); }

  function createBatch() {
    setErr(null);
    const valid = resolved
      .map((r) => ({ groupKey: r.groupKey, machineCode: r.machineCode, eggs: Number(r.eggs) || 0 }))
      .filter((r) => r.groupKey && r.machineCode && r.eggs > 0);
    if (valid.length === 0) return setErr("Add at least one flock with a setter and eggs.");

    const usedGroups = [...new Set(valid.map((r) => r.groupKey))].map((k) => groups.find((g) => g.key === k)!);
    if ([...new Set(usedGroups.map((g) => g.product))].length > 1) return setErr("All flocks in one batch must be the same product.");

    for (const g of usedGroups) {
      const used = valid.filter((r) => r.groupKey === g.key).reduce((s, r) => s + r.eggs, 0);
      if (used > g.eggs) return setErr(`Flock ${g.flockId} (${g.farm}): only ${g.eggs.toLocaleString()} settable.`);
    }
    const perMachine = new Map<string, number>();
    for (const r of valid) perMachine.set(r.machineCode, (perMachine.get(r.machineCode) ?? 0) + r.eggs);
    for (const [mc, eggs] of perMachine) {
      const m = setters.find((x) => x.code === mc)!;
      if (eggs > machineFreeCapacity(m, batches, "setters")) return setErr(`${mc} does not have room for ${eggs.toLocaleString()} eggs.`);
    }

    const flocks: BatchFlock[] = usedGroups.map((g) => ({
      flockId: g.flockId,
      farm: g.farm,
      ageOfFlock: g.recs[0]?.ageOfFlock ?? 0,
      receptionIds: g.recs.map((r) => r.id),
      eggsSet: valid.filter((r) => r.groupKey === g.key).reduce((s, r) => s + r.eggs, 0),
      candlings: [],
      transfers: [],
    }));
    const setterList: MachineAssignment[] = valid.map((r) => ({ machineCode: r.machineCode, eggs: r.eggs }));
    const product = usedGroups[0].product;
    const date = usedGroups.map((g) => g.date).sort()[0];
    const total = flocks.reduce((s, f) => s + f.eggsSet, 0);
    const on = nowISO();
    const id = newId("batch");
    let batch: Batch = {
      id,
      batchNo: batchCode(date, product),
      productType: product,
      farm: flocks.length === 1 ? flocks[0].farm : "Multiple flocks",
      flockId: flocks.length === 1 ? flocks[0].flockId : `${flocks.length} flocks`,
      receptionIds: flocks.flatMap((f) => f.receptionIds),
      eggsSet: total,
      flocks,
      setters: setterList,
      transfers: [],
      candlings: [],
      hatchedCount: 0, culls: 0, unhatchedCount: 0, saleableCount: 0, countedTotal: 0,
      vaccinated: false,
      currentStep: "setting",
      status: "active",
      steps: {},
      history: [`${on} — Batch set: ${total.toLocaleString()} eggs across ${flocks.length} flock(s) (by ${user!.name})`],
      by: user!.email,
      createdAt: on,
    };
    batch = markStep(batch, "reception", user!);
    batch = markStep(batch, "setting", user!);
    upsertBatch(batch);
    usedGroups.forEach((g) => g.recs.forEach((r) => upsertReception({ ...r, batchId: id })));
    toast(`Batch ${batch.batchNo} set — ${total.toLocaleString()} eggs, ${flocks.length} flock(s).`);
    setRowsIn([{ groupKey: "", machineCode: "", eggs: "" }]);
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Batches / Setting</h1>

      {canSet && (
        <Card>
          <CardHeader title="Set a new batch" />
          {groups.length === 0 ? (
            <p className="text-sm text-muted">No receptions ready to set. Mark receptions “ready to set” on the Egg Reception or Store Room page first.</p>
          ) : setters.length === 0 ? (
            <p className="text-sm text-status-refunded">No setter machines. Create one on the Machines page first.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted">Add a flock, then add a setter line for it. A flock&apos;s eggs can be split across several setters — use “Add setter” until all its eggs are set. All flocks must be the same product.</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="ghost" onClick={addFlock}>+ Add flock</Button>
                  <Button size="sm" variant="ghost" onClick={addSetter}>+ Add setter</Button>
                </div>
              </div>
              {rowsIn.map((row, i) => {
                const eff = resolved[i].groupKey;
                const g = groups.find((x) => x.key === eff);
                return (
                <div key={i} className="grid grid-cols-1 gap-2 sm:grid-cols-[1.7fr_1.1fr_0.9fr_auto] sm:items-end">
                  {row.setterOnly ? (
                    <Field label="Flock">
                      <div className="truncate rounded-[9px] border border-line bg-cream/40 px-3.5 py-2.5 text-sm text-muted">
                        ↳ {g ? `${g.farm} · Flock ${g.flockId}` : "same flock"}
                      </div>
                    </Field>
                  ) : (
                    <Field label="Flock (farm · flock)">
                      <Select value={row.groupKey} onChange={(e) => updateRow(i, { groupKey: e.target.value })}
                        placeholder="Select flock"
                        options={groups.map((gg) => ({ value: gg.key, label: `${gg.farm} · Flock ${gg.flockId} · ${gg.product} · ${gg.eggs.toLocaleString()} settable` }))} />
                    </Field>
                  )}
                  <Field label="Setter">
                    <Select value={row.machineCode} onChange={(e) => updateRow(i, { machineCode: e.target.value })}
                      placeholder="Select setter"
                      options={setters.map((m) => ({ value: m.code, label: `${m.code} (free ${Math.max(0, rowFree(m.code, i)).toLocaleString()})` }))} />
                  </Field>
                  <Field label={eff && row.machineCode ? `Eggs (≤ ${Math.max(0, Math.min(groupFree(eff, i), rowFree(row.machineCode, i))).toLocaleString()})` : "Eggs"}>
                    <Input type="number" min={0} value={row.eggs} onChange={(e) => updateRow(i, { eggs: e.target.value })} />
                  </Field>
                  <Button size="sm" variant="ghost" onClick={() => removeRow(i)} disabled={rowsIn.length === 1}>Remove</Button>
                </div>
                );
              })}
              {flockSummary.length > 0 && (
                <div className="space-y-1 rounded-lg border border-line bg-cream/40 p-2.5 text-xs">
                  {flockSummary.map((s) => (
                    <div key={s.key} className="flex items-center justify-between gap-2">
                      <span className="text-muted">{s.label}</span>
                      <span className={s.assigned > s.settable ? "font-semibold text-status-refunded" : s.assigned === s.settable ? "font-semibold text-green" : "text-muted"}>
                        {s.assigned.toLocaleString()} / {s.settable.toLocaleString()} set{s.assigned > s.settable ? " · over!" : s.assigned === s.settable ? " · full ✓" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
                <p className="text-sm">Total to set: <strong>{assignedTotal.toLocaleString()}</strong> egg(s) · <strong>{flockCount}</strong> flock(s)</p>
                <Button onClick={createBatch}>Create batch</Button>
              </div>
              {err && <p className="text-sm text-status-refunded">{err}</p>}
            </div>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length} batch(es)`} />
        <TableWrap>
          <thead>
            <tr><Th>Batch</Th><Th>Product</Th><Th>Farm / flock</Th><Th>Step</Th><Th className="text-right">Eggs set</Th><Th className="text-right">Hatched</Th><Th className="text-right">Saleable</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={8} text="No batches yet." /> : rows.map((b) => (
              <tr key={b.id}>
                <Td><Link href={`/hatchery/batches/${b.id}`} className="font-medium text-gold-dark underline underline-offset-2">{b.batchNo}</Link></Td>
                <Td>{b.productType}</Td>
                <Td>{b.flocks && b.flocks.length > 1 ? `${b.flocks.length} flocks` : `${b.farm} · ${b.flockId}`}</Td>
                <Td>{stepLabel(b.currentStep)}</Td>
                <Td className="text-right">{b.eggsSet.toLocaleString()}</Td>
                <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
                <Td className="text-right">{b.saleableCount.toLocaleString()}</Td>
                <Td><Pill tone={b.status === "delivered" ? "fulfilled" : b.status === "dispatched" ? "gold" : "info"}>{b.status}</Pill></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

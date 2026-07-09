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
import type { Batch, MachineAssignment, Reception } from "@/lib/hatchery/types";
import { batchCode, machineFreeCapacity, markStep, stepLabel, settableEggs } from "@/lib/hatchery/lifecycle";

const CAN_SET = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

interface Group { key: string; farm: string; flockId: string; product: Reception["productType"]; recs: Reception[]; eggs: number; date: string; }
interface SetterRow { machineCode: string; eggs: string; }

export default function BatchesPage() {
  const { user } = useAuth();
  const { receptions, machines, batches, upsertBatch, upsertReception, newId } = useHatchery();
  const { toast } = useToast();

  const [group, setGroup] = useState<Group | null>(null);
  const [rowsIn, setRowsIn] = useState<SetterRow[]>([{ machineCode: "", eggs: "" }]);
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
  const assignedTotal = rowsIn.reduce((s, r) => s + (Number(r.eggs) || 0), 0);

  // Free capacity for a machine, minus what other rows in this form already claim.
  const rowFree = (machineCode: string, selfIndex: number) => {
    const m = setters.find((x) => x.code === machineCode);
    if (!m) return 0;
    const claimedElsewhere = rowsIn.reduce((s, r, i) => (i !== selfIndex && r.machineCode === machineCode ? s + (Number(r.eggs) || 0) : s), 0);
    return machineFreeCapacity(m, batches, "setters") - claimedElsewhere;
  };

  if (!user) return null;

  function addRow() { setRowsIn([...rowsIn, { machineCode: "", eggs: "" }]); }
  function removeRow(i: number) { setRowsIn(rowsIn.length === 1 ? rowsIn : rowsIn.filter((_, j) => j !== i)); }
  function updateRow(i: number, patch: Partial<SetterRow>) { setRowsIn(rowsIn.map((r, j) => (j === i ? { ...r, ...patch } : r))); }

  function createBatch() {
    setErr(null);
    if (!group) return;
    const setterList: MachineAssignment[] = rowsIn
      .map((r) => ({ machineCode: r.machineCode, eggs: Number(r.eggs) || 0 }))
      .filter((a) => a.machineCode && a.eggs > 0);
    if (setterList.length === 0) return setErr("Add at least one setter with eggs.");
    if (assignedTotal > group.eggs) return setErr(`Only ${group.eggs.toLocaleString()} settable eggs available in this group.`);
    // Sum per machine and check capacity.
    const perMachine = new Map<string, number>();
    for (const a of setterList) perMachine.set(a.machineCode, (perMachine.get(a.machineCode) ?? 0) + a.eggs);
    for (const [mc, eggs] of perMachine) {
      const m = setters.find((x) => x.code === mc)!;
      if (eggs > machineFreeCapacity(m, batches, "setters")) return setErr(`${mc} does not have room for ${eggs.toLocaleString()} eggs.`);
    }
    const on = nowISO();
    const id = newId("batch");
    let batch: Batch = {
      id,
      batchNo: batchCode(group.date, group.product),
      productType: group.product,
      farm: group.farm,
      flockId: group.flockId,
      receptionIds: group.recs.map((r) => r.id),
      eggsSet: assignedTotal,
      setters: setterList,
      transfers: [],
      candlings: [],
      hatchedCount: 0, culls: 0, unhatchedCount: 0, saleableCount: 0, countedTotal: 0,
      vaccinated: false,
      currentStep: "setting",
      status: "active",
      steps: {},
      history: [`${on} — Batch set: ${assignedTotal} eggs (by ${user!.name})`],
      by: user!.email,
      createdAt: on,
    };
    batch = markStep(batch, "reception", user!);
    batch = markStep(batch, "setting", user!);
    upsertBatch(batch);
    group.recs.forEach((r) => upsertReception({ ...r, batchId: id }));
    toast(`Batch ${batch.batchNo} set with ${assignedTotal.toLocaleString()} eggs.`);
    setGroup(null); setRowsIn([{ machineCode: "", eggs: "" }]);
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Batches / Setting</h1>

      {canSet && (
        <Card>
          <CardHeader title="Set a new batch" />
          {groups.length === 0 ? (
            <p className="text-sm text-muted">No receptions ready to set. Mark receptions “ready to set” on the Egg Reception or Store Room page first.</p>
          ) : (
            <div className="space-y-4">
              <Field label="Flock reception (same farm + flock is one batch)">
                <Select
                  value={group?.key ?? ""}
                  onChange={(e) => { setGroup(groups.find((g) => g.key === e.target.value) ?? null); setRowsIn([{ machineCode: "", eggs: "" }]); setErr(null); }}
                  placeholder="Select reception group"
                  options={groups.map((g) => ({ value: g.key, label: `${g.farm} · Flock ${g.flockId} · ${g.product} · ${g.eggs.toLocaleString()} settable (${g.recs.length} reception${g.recs.length > 1 ? "s" : ""})` }))}
                />
              </Field>

              {group && (
                <>
                  <p className="text-sm text-muted">
                    Batch code will be <strong className="text-ink">{batchCode(group.date, group.product)}</strong>.
                    Assign eggs to setter machine(s):
                  </p>
                  {setters.length === 0 ? (
                    <p className="text-sm text-status-refunded">No setter machines. Create one on the Machines page first.</p>
                  ) : (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-semibold text-ink">Setters</p>
                        <Button size="sm" variant="ghost" onClick={addRow}>+ Add setter</Button>
                      </div>
                      {rowsIn.map((row, i) => (
                        <div key={i} className="grid grid-cols-[1.4fr_1fr_auto] items-end gap-2">
                          <Field label="Setter">
                            <Select value={row.machineCode} onChange={(e) => updateRow(i, { machineCode: e.target.value })}
                              placeholder="Select setter"
                              options={setters.map((m) => ({ value: m.code, label: `${m.code} (free ${machineFreeCapacity(m, batches, "setters").toLocaleString()})` }))} />
                          </Field>
                          <Field label={row.machineCode ? `Eggs (free ${rowFree(row.machineCode, i).toLocaleString()})` : "Eggs set"}>
                            <Input type="number" min={0} value={row.eggs} onChange={(e) => updateRow(i, { eggs: e.target.value })} />
                          </Field>
                          <Button size="sm" variant="ghost" onClick={() => removeRow(i)} disabled={rowsIn.length === 1}>Remove</Button>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm">Total to set: <strong>{assignedTotal.toLocaleString()}</strong> / {group.eggs.toLocaleString()} settable</p>
                    <Button onClick={createBatch} disabled={setters.length === 0}>Create batch</Button>
                  </div>
                  {err && <p className="text-sm text-status-refunded">{err}</p>}
                </>
              )}
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
                <Td>{b.farm} · {b.flockId}</Td>
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

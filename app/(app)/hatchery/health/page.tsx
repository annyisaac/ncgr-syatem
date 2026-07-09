"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";

import { nowISO, todayISO, formatDate } from "@/lib/format";
import type { Vaccination } from "@/lib/hatchery/types";
import { markStep } from "@/lib/hatchery/lifecycle";

const CAN_ACT = ["Admin", "Hatchery Manager", "Hatchery Veterinary"];

export default function HealthPage() {
  const { user } = useAuth();
  const { batches, vaccinations, inventory, upsertVaccination, upsertBatch, upsertInventory, newId } = useHatchery();
  const { toast } = useToast();

  const [batchId, setBatchId] = useState("");
  const [vaccine, setVaccine] = useState("");
  const [date, setDate] = useState(todayISO());
  const [rejectBatch, setRejectBatch] = useState("");
  const [rejectCount, setRejectCount] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [rErr, setRErr] = useState<string | null>(null);

  const canAct = !!user && CAN_ACT.includes(user.role);
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;

  const rows = useMemo(
    () => vaccinations.slice().sort((a, b) => (a.on < b.on ? 1 : -1)),
    [vaccinations]
  );

  if (!user) return null;

  function recordVaccination(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!batchId) return setErr("Select a batch.");
    if (!vaccine.trim()) return setErr("Enter the vaccine.");
    const v: Vaccination = {
      id: newId("vacc"),
      batchId,
      vaccine: vaccine.trim(),
      date,
      administeredBy: user!.email,
      on: nowISO(),
    };
    upsertVaccination(v);
    const b = batches.find((x) => x.id === batchId);
    if (b && !b.steps["vaccination"]) upsertBatch(markStep(b, "vaccination", user!));
    toast(`Vaccination recorded for ${batchNo(batchId)}.`);
    setVaccine("");
  }

  function rejectChicks(e: React.FormEvent) {
    e.preventDefault();
    setRErr(null);
    const b = batches.find((x) => x.id === rejectBatch);
    if (!b) return setRErr("Select a batch.");
    const n = Number(rejectCount);
    if (!(n > 0)) return setRErr("Enter how many chicks to reject.");
    const rejectedCount = b.rejectedCount + n;
    const sellableCount = Math.max(0, b.gradeAcount - rejectedCount);
    upsertBatch({
      ...b,
      rejectedCount,
      sellableCount,
      history: [...b.history, `${nowISO()} — Vet rejected ${n} unhealthy chicks (by ${user!.name})`],
    });
    const inv = inventory.find((i) => i.batchId === b.id);
    if (inv) upsertInventory({ ...inv, availableCount: sellableCount, updatedBy: user!.email, on: nowISO() });
    toast(`Rejected ${n} chicks from ${b.batchNo}. ${sellableCount} sellable remain.`);
    setRejectCount("");
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Chick Health & Vaccination</h1>

      {canAct && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader title="Record vaccination" />
            <form onSubmit={recordVaccination} className="space-y-4">
              <Field label="Batch">
                <Select
                  value={batchId}
                  onChange={(e) => setBatchId(e.target.value)}
                  placeholder="Select batch"
                  options={batches.map((b) => ({ value: b.id, label: `${b.batchNo} (${b.productType})` }))}
                />
              </Field>
              <Field label="Vaccine">
                <Input value={vaccine} onChange={(e) => setVaccine(e.target.value)} placeholder="e.g. Marek's, Newcastle" />
              </Field>
              <Field label="Date">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </Field>
              {err && <p className="text-sm text-status-refunded">{err}</p>}
              <Button type="submit">Record vaccination</Button>
            </form>
          </Card>

          <Card>
            <CardHeader title="Reject unhealthy chicks" />
            <p className="mb-3 text-xs text-muted">
              Rejected chicks are removed from the sellable count and from sales inventory.
            </p>
            <form onSubmit={rejectChicks} className="space-y-4">
              <Field label="Batch">
                <Select
                  value={rejectBatch}
                  onChange={(e) => setRejectBatch(e.target.value)}
                  placeholder="Select batch"
                  options={batches
                    .filter((b) => b.gradeAcount > 0)
                    .map((b) => ({ value: b.id, label: `${b.batchNo} · ${b.sellableCount} sellable` }))}
                />
              </Field>
              <Field label="Chicks to reject">
                <Input type="number" min={1} value={rejectCount} onChange={(e) => setRejectCount(e.target.value)} />
              </Field>
              {rErr && <p className="text-sm text-status-refunded">{rErr}</p>}
              <Button type="submit" variant="danger">Reject chicks</Button>
            </form>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader title="Vaccination records" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Vaccine</Th>
              <Th>Date</Th>
              <Th>Administered by</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={4} text="No vaccination records yet." />
            ) : (
              rows.map((v) => (
                <tr key={v.id}>
                  <Td>{batchNo(v.batchId)}</Td>
                  <Td>{v.vaccine}</Td>
                  <Td>{formatDate(v.date)}</Td>
                  <Td>{v.administeredBy}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

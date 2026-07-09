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
import type { Batch, Supply, Vaccination } from "@/lib/hatchery/types";
import { markStep } from "@/lib/hatchery/lifecycle";

const CAN_VAX = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician", "Hatchery Attendant"];

export default function VaccinationPage() {
  const { user } = useAuth();
  const { batches, supplies, vaccinations, upsertBatch, upsertVaccination, upsertSupply, newId } = useHatchery();
  const { toast } = useToast();

  const [batchId, setBatchId] = useState("");
  const [vaccineId, setVaccineId] = useState("");
  const [doses, setDoses] = useState("");
  const [date, setDate] = useState(todayISO());
  const [err, setErr] = useState<string | null>(null);

  const canVax = !!user && CAN_VAX.includes(user.role);
  const vaccineSupplies = useMemo(() => supplies.filter((s) => s.kind === "vaccine"), [supplies]);

  // Only hatched batches can be vaccinated.
  const hatched = useMemo(() => batches.filter((b) => b.steps["hatching"]), [batches]);
  const batch = hatched.find((b) => b.id === batchId) ?? null;
  const vaccine = vaccineSupplies.find((s) => s.id === vaccineId) ?? null;
  const dosesN = Number(doses) || 0;

  const rows = useMemo(() => vaccinations.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [vaccinations]);
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;

  if (!user) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!batch) return setErr("Select a hatched batch.");
    if (!vaccine) return setErr("Select a vaccine.");
    if (dosesN <= 0) return setErr("Enter the number of doses.");
    if (dosesN > vaccine.quantity) return setErr(`Only ${vaccine.quantity} doses of ${vaccine.name} in stock.`);
    const on = nowISO();
    const rec: Vaccination = {
      id: newId("vax"), batchId: batch.id, vaccine: vaccine.name, doses: dosesN,
      date, administeredBy: user!.name, on,
    };
    upsertVaccination(rec);
    // Deduct vaccine stock.
    const s: Supply = { ...vaccine, quantity: vaccine.quantity - dosesN, history: [...vaccine.history, `${on} — ${dosesN} doses to ${batch.batchNo} by ${user!.name}`], on };
    upsertSupply(s);
    // Mark batch vaccinated + lifecycle step.
    let nb: Batch = { ...batch, vaccinated: true };
    if (!nb.steps["vaccination"]) nb = markStep(nb, "vaccination", user!);
    upsertBatch(nb);
    toast(`${dosesN} doses of ${vaccine.name} given to ${batch.batchNo}.`);
    setDoses("");
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Vaccination</h1>

      {canVax && (
        <Card>
          <CardHeader title="Record vaccination" />
          {hatched.length === 0 ? (
            <p className="text-sm text-muted">No hatched batches available to vaccinate.</p>
          ) : (
            <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Hatched batch">
                <Select value={batchId} onChange={(e) => setBatchId(e.target.value)} placeholder="Select batch"
                  options={hatched.map((b) => ({ value: b.id, label: `${b.batchNo} · ${b.saleableCount.toLocaleString()} saleable${b.vaccinated ? " · vaccinated" : ""}` }))} />
              </Field>
              <Field label="Vaccine (from inventory)">
                <Select value={vaccineId} onChange={(e) => setVaccineId(e.target.value)}
                  placeholder={vaccineSupplies.length ? "Select vaccine" : "No vaccines in inventory"}
                  options={vaccineSupplies.map((s) => ({ value: s.id, label: `${s.name} (${s.quantity} ${s.unit})` }))} />
              </Field>
              <Field label="Doses"><Input type="number" min={0} value={doses} onChange={(e) => setDoses(e.target.value)} /></Field>
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              {batch && <p className="sm:col-span-2 text-xs text-muted">{batch.saleableCount.toLocaleString()} saleable chicks in {batch.batchNo}.</p>}
              {err && <p className="sm:col-span-2 text-sm text-status-refunded">{err}</p>}
              <div className="sm:col-span-2 flex justify-end"><Button type="submit">Save vaccination</Button></div>
            </form>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title="Vaccination log" />
        <TableWrap>
          <thead><tr><Th>Date</Th><Th>Batch</Th><Th>Vaccine</Th><Th className="text-right">Doses</Th><Th>By</Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={5} text="No vaccinations yet." /> : rows.map((v) => (
              <tr key={v.id}><Td>{formatDate(v.date)}</Td><Td>{batchNo(v.batchId)}</Td><Td>{v.vaccine}</Td><Td className="text-right">{v.doses.toLocaleString()}</Td><Td>{v.administeredBy}</Td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

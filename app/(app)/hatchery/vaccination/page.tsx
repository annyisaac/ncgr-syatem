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
  const { batches, supplies, vaccinations, counts, inventory, upsertBatch, upsertVaccination, upsertSupply, upsertCount, upsertInventory, newId } = useHatchery();
  const { toast } = useToast();

  const [batchId, setBatchId] = useState("");
  const [vaccineId, setVaccineId] = useState("");
  const [doses, setDoses] = useState("");
  const [date, setDate] = useState(todayISO());
  const [vax, setVax] = useState<Record<string, string>>({}); // culls removed during vaccination, per flock
  const [err, setErr] = useState<string | null>(null);

  const canVax = !!user && CAN_VAX.includes(user.role);
  const vaccineSupplies = useMemo(() => supplies.filter((s) => s.kind === "vaccine"), [supplies]);

  const hatched = useMemo(() => batches.filter((b) => b.steps["hatching"]), [batches]);
  const batch = hatched.find((b) => b.id === batchId) ?? null;
  const vaccine = vaccineSupplies.find((s) => s.id === vaccineId) ?? null;
  const dosesN = Number(doses) || 0;

  // The batch's verified per-flock counts — vaccination culls come off these.
  const batchCounts = useMemo(
    () => (batch ? counts.filter((c) => c.batchId === batch.id && c.verified) : []),
    [counts, batch]
  );
  const finalSaleable = batchCounts.reduce((s, c) => s + Math.max(0, c.total - (Number(vax[c.flockId ?? ""]) || 0)), 0);

  const rows = useMemo(() => vaccinations.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [vaccinations]);
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;

  if (!user) return null;

  function pickBatch(id: string) {
    setBatchId(id);
    setVax({});
    setErr(null);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!batch) return setErr("Select a hatched batch.");
    if (!vaccine) return setErr("Select a vaccine.");
    if (dosesN <= 0) return setErr("Enter the number of doses.");
    if (dosesN > vaccine.quantity) return setErr(`Only ${vaccine.quantity} doses of ${vaccine.name} in stock.`);
    for (const c of batchCounts) {
      const vc = Number(vax[c.flockId ?? ""]) || 0;
      if (vc > c.total) return setErr(`Flock ${c.flockId}: culls (${vc}) can't exceed its ${c.total.toLocaleString()} saleable.`);
    }
    const on = nowISO();

    // Vaccination record + deduct vaccine stock.
    const rec: Vaccination = { id: newId("vax"), batchId: batch.id, vaccine: vaccine.name, doses: dosesN, date, administeredBy: user!.name, on };
    upsertVaccination(rec);
    const s: Supply = { ...vaccine, quantity: vaccine.quantity - dosesN, history: [...vaccine.history, `${on} — ${dosesN} doses to ${batch.batchNo} by ${user!.name}`], on };
    upsertSupply(s);

    // Apply vaccination culls per flock → final saleable.
    let saleableTot = 0, cullsTot = 0;
    for (const c of batchCounts) {
      const vc = Number(vax[c.flockId ?? ""]) || 0;
      upsertCount({ ...c, vaxCulls: vc });
      saleableTot += Math.max(0, c.total - vc);
      cullsTot += (c.culls ?? 0) + vc;
    }

    // Roll up to the batch: saleable = counted saleable − vaccination culls (final).
    let nb: Batch = { ...batch, vaccinated: true, saleableCount: saleableTot, culls: cullsTot };
    if (!nb.steps["vaccination"]) nb = markStep(nb, "vaccination", user!);
    upsertBatch(nb);

    // Update chick inventory to the post-vaccination saleable.
    const inv = inventory.find((i) => i.batchId === batch.id);
    upsertInventory(
      inv
        ? { ...inv, availableCount: saleableTot, updatedBy: user!.email, on }
        : { id: newId("inv"), productType: batch.productType, hatchDate: todayISO(), availableCount: saleableTot, batchId: batch.id, updatedBy: user!.email, on }
    );

    toast(`${dosesN} doses of ${vaccine.name} given to ${batch.batchNo} — final saleable ${saleableTot.toLocaleString()}.`);
    setDoses(""); setVax({});
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Vaccination</h1>
      <p className="-mt-2 text-sm text-muted">Vaccinate the batch and record any culls removed during vaccination, per flock — the remaining chicks are the final saleable number.</p>

      {canVax && (
        <Card>
          <CardHeader title="Record vaccination" />
          {hatched.length === 0 ? (
            <p className="text-sm text-muted">No hatched batches available to vaccinate.</p>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Hatched batch">
                  <Select value={batchId} onChange={(e) => pickBatch(e.target.value)} placeholder="Select batch"
                    options={hatched.map((b) => ({ value: b.id, label: `${b.batchNo} · ${b.saleableCount.toLocaleString()} saleable${b.vaccinated ? " · vaccinated" : ""}` }))} />
                </Field>
                <Field label="Vaccine (from inventory)">
                  <Select value={vaccineId} onChange={(e) => setVaccineId(e.target.value)}
                    placeholder={vaccineSupplies.length ? "Select vaccine" : "No vaccines in inventory"}
                    options={vaccineSupplies.map((s) => ({ value: s.id, label: `${s.name} (${s.quantity} ${s.unit})` }))} />
                </Field>
                <Field label="Doses"><Input type="number" min={0} value={doses} onChange={(e) => setDoses(e.target.value)} /></Field>
                <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              </div>

              {batch && (
                <div className="space-y-2 rounded-lg border border-line p-3">
                  <p className="text-sm font-semibold text-ink">Culls removed during vaccination (per flock)</p>
                  {batchCounts.length === 0 ? (
                    <p className="text-xs text-muted">This batch has no verified flock counts yet — verify counts on the Hatch page first.</p>
                  ) : (
                    <>
                      {batchCounts.map((c) => {
                        const vc = Number(vax[c.flockId ?? ""]) || 0;
                        return (
                          <div key={c.id} className="grid grid-cols-[1.4fr_0.8fr_0.8fr] items-end gap-2">
                            <div className="text-sm">
                              <span className="font-medium">Flock {c.flockId}</span>
                              <span className="ml-2 text-xs text-muted">{c.total.toLocaleString()} counted saleable</span>
                            </div>
                            <Field label="Culls (vax)">
                              <Input type="number" min={0} value={vax[c.flockId ?? ""] ?? ""} onChange={(e) => setVax({ ...vax, [c.flockId ?? ""]: e.target.value })} />
                            </Field>
                            <div className="pb-2 text-right text-sm">
                              <span className="text-xs text-muted">final </span>
                              <strong className="text-ink">{Math.max(0, c.total - vc).toLocaleString()}</strong>
                            </div>
                          </div>
                        );
                      })}
                      <p className="text-sm">Final saleable (batch): <strong className="text-green">{finalSaleable.toLocaleString()}</strong></p>
                    </>
                  )}
                </div>
              )}

              {err && <p className="text-sm text-status-refunded">{err}</p>}
              <div className="flex justify-end"><Button type="submit">Save vaccination</Button></div>
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

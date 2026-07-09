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

import { PRODUCTS, type Product } from "@/lib/types";
import { nowISO, formatDate, todayISO } from "@/lib/format";
import type { Batch } from "@/lib/hatchery/types";
import { addDays, INCUBATION_DAYS, CANDLING_1_DAY, CANDLING_2_DAY, stepLabel } from "@/lib/hatchery/lifecycle";

const CAN_CREATE = [
  "Admin",
  "Hatchery Manager",
  "Hatchery Operations Manager",
  "Production Technician",
];

export default function BatchesPage() {
  const { user } = useAuth();
  const { batches, upsertBatch, newId } = useHatchery();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [product, setProduct] = useState<Product>("Tetra Super Harco");
  const [eggSource, setEggSource] = useState("");
  const [eggCount, setEggCount] = useState("");
  const [grade, setGrade] = useState("A");
  const [incubator, setIncubator] = useState("");
  const [setDate, setSetDate] = useState(todayISO());
  const [err, setErr] = useState<string | null>(null);

  const canCreate = !!user && CAN_CREATE.includes(user.role);

  const rows = useMemo(
    () => batches.slice().sort((a, b) => (a.setDate < b.setDate ? 1 : -1)),
    [batches]
  );

  if (!user) return null;

  function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const eggs = Number(eggCount) || 0;
    if (!eggSource.trim()) return setErr("Enter the egg source.");
    if (eggs <= 0) return setErr("Enter the number of eggs.");
    if (!setDate) return setErr("Choose the set date.");

    const on = nowISO();
    const id = newId("batch");
    const batch: Batch = {
      id,
      batchNo: `B-${setDate.replace(/-/g, "")}-${id.slice(-4).toUpperCase()}`,
      productType: product,
      eggSource: eggSource.trim(),
      eggCount: eggs,
      qualityGrade: grade,
      incubator: incubator.trim() || undefined,
      setDate,
      expectedHatchDate: addDays(setDate, INCUBATION_DAYS),
      candling1Date: addDays(setDate, CANDLING_1_DAY),
      candling2Date: addDays(setDate, CANDLING_2_DAY),
      currentStep: "setting",
      steps: {
        "egg-receiving": { by: user!.email, on },
        "quality-inspection": { by: user!.email, on },
        storage: { by: user!.email, on },
        setting: { by: user!.email, on },
      },
      fertileCount: eggs,
      hatchedCount: 0,
      gradeAcount: 0,
      rejectedCount: 0,
      sellableCount: 0,
      status: "active",
      candlings: [],
      history: [`${on} — Batch created & set (by ${user!.name})`],
      by: user!.email,
      createdAt: on,
    };
    upsertBatch(batch);
    toast(`Batch ${batch.batchNo} set.`);
    setShowForm(false);
    setEggSource("");
    setEggCount("");
    setIncubator("");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Batches</h1>
        {canCreate && (
          <Button onClick={() => setShowForm((v) => !v)}>
            {showForm ? "Hide form" : "New batch (egg set)"}
          </Button>
        )}
      </div>

      {showForm && canCreate && (
        <Card>
          <CardHeader title="Egg reception & setting" />
          <form onSubmit={create} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Product">
              <Select
                value={product}
                onChange={(e) => setProduct(e.target.value as Product)}
                options={PRODUCTS.map((p) => ({ value: p, label: p }))}
              />
            </Field>
            <Field label="Egg source">
              <Input value={eggSource} onChange={(e) => setEggSource(e.target.value)} placeholder="e.g. Farm A / supplier" />
            </Field>
            <Field label="Egg count">
              <Input type="number" min={1} value={eggCount} onChange={(e) => setEggCount(e.target.value)} />
            </Field>
            <Field label="Quality grade">
              <Input value={grade} onChange={(e) => setGrade(e.target.value)} />
            </Field>
            <Field label="Incubator (setter)">
              <Input value={incubator} onChange={(e) => setIncubator(e.target.value)} placeholder="e.g. Setter 1" />
            </Field>
            <Field label="Set date" hint="Hatch, candling 1 & 2 dates are calculated automatically.">
              <Input type="date" value={setDate} onChange={(e) => setSetDate(e.target.value)} />
            </Field>
            <div className="sm:col-span-2 rounded-md bg-ink/5 p-3 text-sm">
              <span className="text-muted">Auto-calculated:</span>{" "}
              Candling 1 <strong>{formatDate(addDays(setDate, CANDLING_1_DAY))}</strong> ·
              Candling 2 <strong>{formatDate(addDays(setDate, CANDLING_2_DAY))}</strong> ·
              Expected hatch <strong>{formatDate(addDays(setDate, INCUBATION_DAYS))}</strong>
            </div>
            {err && <p className="sm:col-span-2 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit">Set batch</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length} batch(es)`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Batch</Th>
              <Th>Product</Th>
              <Th>Set date</Th>
              <Th>Current step</Th>
              <Th className="text-right">Eggs</Th>
              <Th className="text-right">Fertile</Th>
              <Th className="text-right">Hatched</Th>
              <Th className="text-right">Sellable</Th>
              <Th>Status</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={9} text="No batches yet." />
            ) : (
              rows.map((b) => (
                <tr key={b.id}>
                  <Td>
                    <Link href={`/hatchery/batches/${b.id}`} className="font-medium text-gold-dark underline underline-offset-2">
                      {b.batchNo}
                    </Link>
                  </Td>
                  <Td>{b.productType}</Td>
                  <Td>{formatDate(b.setDate)}</Td>
                  <Td>{stepLabel(b.currentStep)}</Td>
                  <Td className="text-right">{b.eggCount.toLocaleString()}</Td>
                  <Td className="text-right">{b.fertileCount.toLocaleString()}</Td>
                  <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
                  <Td className="text-right">{b.sellableCount.toLocaleString()}</Td>
                  <Td>
                    <Pill tone={b.status === "delivered" ? "fulfilled" : b.status === "dispatched" ? "gold" : "info"}>
                      {b.status}
                    </Pill>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

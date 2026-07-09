"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";

import { PRODUCTS, type Product } from "@/lib/types";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import type { Reception, ReceptionLocation } from "@/lib/hatchery/types";
import { settableEggs } from "@/lib/hatchery/lifecycle";

const CAN_ADD = [
  "Admin",
  "Hatchery Manager",
  "Operations Manager",
  "Hatchery Operations Manager",
  "Production Technician",
];

const num = (v: string) => Number(v) || 0;

export default function ReceptionPage() {
  const { user } = useAuth();
  const { receptions, batches, upsertReception, newId } = useHatchery();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [f, setF] = useState({
    farm: "", flockId: "", ageOfFlock: "", eggsReceived: "", ageOfEggs: "",
    crackedOnFarm: "", crackedOnSet: "", misshapen: "", dirty: "",
    product: "Tetra Super Harco" as Product, date: todayISO(),
  });
  const [err, setErr] = useState<string | null>(null);

  const canAdd = !!user && CAN_ADD.includes(user.role);
  const rows = useMemo(() => receptions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), [receptions]);
  const batchNo = (id?: string) => (id ? batches.find((b) => b.id === id)?.batchNo ?? id : null);

  if (!user) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.farm.trim()) return setErr("Enter the farm name.");
    if (!f.flockId.trim()) return setErr("Enter the flock ID.");
    if (num(f.eggsReceived) <= 0) return setErr("Enter eggs received.");
    const rec: Reception = {
      id: newId("rec"),
      date: f.date,
      farm: f.farm.trim(),
      flockId: f.flockId.trim(),
      ageOfFlock: num(f.ageOfFlock),
      eggsReceived: num(f.eggsReceived),
      ageOfEggs: num(f.ageOfEggs),
      crackedOnFarm: num(f.crackedOnFarm),
      crackedOnSet: num(f.crackedOnSet),
      misshapen: num(f.misshapen),
      dirty: num(f.dirty),
      productType: f.product,
      by: user!.email,
      on: nowISO(),
    };
    upsertReception(rec);
    toast(`Received ${rec.eggsReceived} eggs from ${rec.farm} — ${settableEggs(rec).toLocaleString()} settable.`);
    setShow(false);
    setF({ ...f, farm: "", flockId: "", ageOfFlock: "", eggsReceived: "", ageOfEggs: "", crackedOnFarm: "", crackedOnSet: "", misshapen: "", dirty: "" });
  }

  function setLocation(r: Reception, location: ReceptionLocation) {
    upsertReception({ ...r, location });
    toast(location === "store" ? "Sent to egg store room." : "Marked ready to set.");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Egg Reception</h1>
        {canAdd && <Button onClick={() => setShow((v) => !v)}>{show ? "Hide form" : "Record reception"}</Button>}
      </div>

      {show && canAdd && (
        <Card>
          <CardHeader title="Receive eggs from farm" />
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Farm name"><Input value={f.farm} onChange={(e) => setF({ ...f, farm: e.target.value })} /></Field>
            <Field label="Flock ID"><Input value={f.flockId} onChange={(e) => setF({ ...f, flockId: e.target.value })} /></Field>
            <Field label="Product">
              <Select value={f.product} onChange={(e) => setF({ ...f, product: e.target.value as Product })}
                options={PRODUCTS.map((p) => ({ value: p, label: p }))} />
            </Field>
            <Field label="Age of flock (weeks)"><Input type="number" value={f.ageOfFlock} onChange={(e) => setF({ ...f, ageOfFlock: e.target.value })} /></Field>
            <Field label="Eggs received"><Input type="number" value={f.eggsReceived} onChange={(e) => setF({ ...f, eggsReceived: e.target.value })} /></Field>
            <Field label="Age of eggs (days)"><Input type="number" value={f.ageOfEggs} onChange={(e) => setF({ ...f, ageOfEggs: e.target.value })} /></Field>
            <Field label="Cracked on farm"><Input type="number" value={f.crackedOnFarm} onChange={(e) => setF({ ...f, crackedOnFarm: e.target.value })} /></Field>
            <Field label="Cracked on set"><Input type="number" value={f.crackedOnSet} onChange={(e) => setF({ ...f, crackedOnSet: e.target.value })} /></Field>
            <Field label="Misshapen eggs"><Input type="number" value={f.misshapen} onChange={(e) => setF({ ...f, misshapen: e.target.value })} /></Field>
            <Field label="Dirty eggs"><Input type="number" value={f.dirty} onChange={(e) => setF({ ...f, dirty: e.target.value })} /></Field>
            <Field label="Date received"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <div className="sm:col-span-3 rounded-md border border-line bg-cream/40 px-3 py-2 text-sm">
              Settable eggs (received − cracked − misshapen − dirty):{" "}
              <strong className="text-ink">
                {Math.max(0, num(f.eggsReceived) - num(f.crackedOnFarm) - num(f.crackedOnSet) - num(f.misshapen) - num(f.dirty)).toLocaleString()}
              </strong>
            </div>
            {err && <p className="sm:col-span-3 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
              <Button type="submit">Save reception</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length} reception(s)`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Date</Th><Th>Farm</Th><Th>Flock</Th><Th>Product</Th>
              <Th className="text-right">Received</Th><Th className="text-right">Cracked</Th>
              <Th className="text-right">Misshapen</Th><Th className="text-right">Dirty</Th>
              <Th className="text-right">Settable</Th><Th>Where</Th><Th>Batch</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={11} text="No receptions yet." />
            ) : (
              rows.map((r) => (
                <tr key={r.id}>
                  <Td>{formatDate(r.date)}</Td>
                  <Td>{r.farm}</Td>
                  <Td>{r.flockId}</Td>
                  <Td>{r.productType}</Td>
                  <Td className="text-right">{r.eggsReceived.toLocaleString()}</Td>
                  <Td className="text-right">{(r.crackedOnFarm + r.crackedOnSet).toLocaleString()}</Td>
                  <Td className="text-right">{r.misshapen.toLocaleString()}</Td>
                  <Td className="text-right">{r.dirty.toLocaleString()}</Td>
                  <Td className="text-right font-semibold">{settableEggs(r).toLocaleString()}</Td>
                  <Td>
                    {r.batchId ? (
                      <Pill tone="green">Set</Pill>
                    ) : r.location === "store" ? (
                      <Pill tone="info">Store room</Pill>
                    ) : r.location === "ready" ? (
                      <Pill tone="gold">Ready to set</Pill>
                    ) : canAdd ? (
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setLocation(r, "store")}>Store</Button>
                        <Button size="sm" onClick={() => setLocation(r, "ready")}>Ready to set</Button>
                      </div>
                    ) : (
                      <Pill tone="neutral">Pending</Pill>
                    )}
                  </Td>
                  <Td>{r.batchId ? <Pill tone="gold">{batchNo(r.batchId)}</Pill> : <span className="text-muted">—</span>}</Td>
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

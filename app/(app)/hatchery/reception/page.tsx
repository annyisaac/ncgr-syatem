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

import { FarmsManager } from "@/components/hatchery/FarmsManager";
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
const CAN_MANAGE_FARMS = ["Admin", "Hatchery Manager"];

const num = (v: string) => Number(v) || 0;

export default function ReceptionPage() {
  const { user } = useAuth();
  const { receptions, batches, farms, flocks, upsertReception, newId } = useHatchery();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [showFarms, setShowFarms] = useState(false);
  const [f, setF] = useState({
    flock: "", ageOfFlock: "", eggsReceived: "", ageOfEggs: "",
    crackedOnFarm: "", crackedOnSet: "", misshapen: "", dirty: "",
    date: todayISO(),
  });
  const [err, setErr] = useState<string | null>(null);

  const canAdd = !!user && CAN_ADD.includes(user.role);
  const canManageFarms = !!user && CAN_MANAGE_FARMS.includes(user.role);
  const rows = useMemo(() => receptions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), [receptions]);
  const batchNo = (id?: string) => (id ? batches.find((b) => b.id === id)?.batchNo ?? id : null);
  const farmName = (id: string) => farms.find((x) => x.id === id)?.name ?? "—";

  // Only active flocks whose farm is also active can be received against.
  const activeFlocks = useMemo(
    () => flocks
      .filter((x) => x.active && farms.find((fm) => fm.id === x.farmId)?.active !== false)
      .map((x) => ({ ...x, farmName: farmName(x.farmId) }))
      .sort((a, b) => (a.farmName === b.farmName ? a.code.localeCompare(b.code) : a.farmName.localeCompare(b.farmName))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flocks, farms]
  );

  if (!user) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const flock = flocks.find((x) => x.id === f.flock);
    if (!flock) return setErr("Select the flock.");
    if (num(f.eggsReceived) <= 0) return setErr("Enter eggs received.");
    const farm = farmName(flock.farmId);
    const rec: Reception = {
      id: newId("rec"),
      date: f.date,
      farm,
      flockId: flock.code,
      ageOfFlock: num(f.ageOfFlock),
      eggsReceived: num(f.eggsReceived),
      ageOfEggs: num(f.ageOfEggs),
      crackedOnFarm: num(f.crackedOnFarm),
      crackedOnSet: num(f.crackedOnSet),
      misshapen: num(f.misshapen),
      dirty: num(f.dirty),
      productType: flock.productType,
      by: user!.email,
      on: nowISO(),
    };
    upsertReception(rec);
    toast(`Received ${rec.eggsReceived} eggs from ${farm} — ${settableEggs(rec).toLocaleString()} settable.`);
    setShow(false);
    setF({ ...f, flock: "", ageOfFlock: "", eggsReceived: "", ageOfEggs: "", crackedOnFarm: "", crackedOnSet: "", misshapen: "", dirty: "" });
  }

  function setLocation(r: Reception, location: ReceptionLocation) {
    upsertReception({ ...r, location });
    toast(location === "store" ? "Sent to egg store room." : "Marked ready to set.");
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Egg Reception</h1>
        <div className="flex flex-wrap gap-2">
          {canManageFarms && (
            <Button variant="secondary" onClick={() => setShowFarms((v) => !v)}>
              {showFarms ? "Hide farms & flocks" : "Manage farms & flocks"}
            </Button>
          )}
          {canAdd && <Button onClick={() => setShow((v) => !v)}>{show ? "Hide form" : "Record reception"}</Button>}
        </div>
      </div>

      {showFarms && canManageFarms && (
        <Card>
          <CardHeader title="Farms & flocks" />
          <FarmsManager />
        </Card>
      )}

      {show && canAdd && (
        <Card>
          <CardHeader title="Receive eggs from farm" />
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Farm · Flock (product)">
              <Select value={f.flock} onChange={(e) => setF({ ...f, flock: e.target.value })}
                placeholder={activeFlocks.length ? "Select flock" : "No flocks defined"}
                options={activeFlocks.map((x) => ({ value: x.id, label: `${x.farmName} · ${x.code} · ${x.productType}` }))} />
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

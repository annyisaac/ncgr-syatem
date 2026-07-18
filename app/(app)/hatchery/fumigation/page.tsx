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
import { nowISO, todayISO, formatDate } from "@/lib/format";
import type { Fumigation, Reception, TrolleyRow } from "@/lib/hatchery/types";
import { settableEggs } from "@/lib/hatchery/lifecycle";

const CAN_ADD = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

export default function FumigationPage() {
  const { user } = useAuth();
  const { fumigations, receptions, upsertFumigation, upsertReception, newId } = useHatchery();
  const { toast } = useToast();

  const [receptionId, setReceptionId] = useState("");
  const [chemicals, setChemicals] = useState("");
  const [time, setTime] = useState("");
  const [date, setDate] = useState(todayISO());
  const [trolleys, setTrolleys] = useState<{ label: string; eggs: string }[]>([{ label: "1", eggs: "" }]);
  const [err, setErr] = useState<string | null>(null);

  const canAdd = !!user && CAN_ADD.includes(user.role);

  // Available = not yet batched (may or may not be stored / partly fumigated).
  const available = useMemo(
    () => receptions.filter((r) => !r.batchId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [receptions]
  );
  const reception = available.find((r) => r.id === receptionId) ?? null;
  const settable = reception ? settableEggs(reception) : 0;
  const alreadyFum = reception?.fumigatedEggs ?? 0;
  const totalEggs = trolleys.reduce((s, t) => s + (Number(t.eggs) || 0), 0);

  const rows = useMemo(() => fumigations.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [fumigations]);
  const recLabel = (id?: string) => {
    const r = receptions.find((x) => x.id === id);
    return r ? `${r.farm} · ${r.flockId}` : "—";
  };

  if (!user) return null;

  function addTrolley() {
    setTrolleys([...trolleys, { label: String(trolleys.length + 1), eggs: "" }]);
  }
  function removeTrolley(i: number) {
    setTrolleys(trolleys.length === 1 ? trolleys : trolleys.filter((_, j) => j !== i));
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!reception) return setErr("Select a reception to fumigate.");
    if (!chemicals.trim()) return setErr("Enter the chemicals used.");
    if (totalEggs <= 0) return setErr("Add at least one trolley with eggs.");
    if (alreadyFum + totalEggs > settable) {
      return setErr(`That exceeds settable eggs — ${settable.toLocaleString()} settable, ${alreadyFum.toLocaleString()} already fumigated.`);
    }
    const rowsOut: TrolleyRow[] = trolleys
      .map((t) => ({ label: t.label.trim() || "-", eggs: Number(t.eggs) || 0 }))
      .filter((t) => t.eggs > 0);
    const rec: Fumigation = {
      id: newId("fum"), date, receptionId: reception.id, farm: reception.farm, flockId: reception.flockId,
      chemicals: chemicals.trim(), trolleys: rowsOut, totalEggs, time: time.trim(),
      by: user!.email, on: nowISO(),
    };
    upsertFumigation(rec);
    upsertReception({ ...reception, fumigatedEggs: alreadyFum + totalEggs });
    toast(`Fumigated ${totalEggs.toLocaleString()} eggs on ${rowsOut.length} trolley(s).`);
    setChemicals(""); setTime(""); setTrolleys([{ label: "1", eggs: "" }]);
  }

  return (
    <div className="space-y-5">

      {canAdd && (
        <Card>
          <CardHeader title="Fumigate a reception" />
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="sm:col-span-3">
                <Field label="Reception to fumigate">
                  <Select value={receptionId} onChange={(e) => { setReceptionId(e.target.value); setErr(null); }}
                    placeholder={available.length ? "Select reception" : "No available receptions"}
                    options={available.map((r) => ({
                      value: r.id,
                      label: `${r.farm} · ${r.flockId} · ${settableEggs(r).toLocaleString()} settable${r.location === "store" ? " · in store" : r.location === "ready" ? " · ready" : ""}${(r.fumigatedEggs ?? 0) > 0 ? ` · ${r.fumigatedEggs} fumigated` : ""}`,
                    }))} />
                </Field>
              </div>
              {reception && (
                <div className="sm:col-span-3 flex flex-wrap gap-2 text-xs">
                  <Pill tone="info">{settable.toLocaleString()} settable</Pill>
                  <Pill tone={alreadyFum >= settable ? "green" : "gold"}>{alreadyFum.toLocaleString()} fumigated</Pill>
                  <Pill tone="neutral">{Math.max(0, settable - alreadyFum).toLocaleString()} not fumigated</Pill>
                  {reception.location === "store" && <Pill tone="info">in store room</Pill>}
                </div>
              )}
              <Field label="Chemicals used"><Input value={chemicals} onChange={(e) => setChemicals(e.target.value)} placeholder="e.g. Formaldehyde + KMnO₄" /></Field>
              <Field label="Time / duration"><Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="e.g. 20 min / 08:30" /></Field>
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-sm font-semibold text-ink">Trolleys</p>
                <Button size="sm" variant="ghost" onClick={addTrolley}>+ Add trolley</Button>
              </div>
              {trolleys.map((t, i) => (
                <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                  <Field label={`Trolley ${i + 1}`}><Input value={t.label} onChange={(e) => setTrolleys(trolleys.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /></Field>
                  <Field label="Eggs on trolley"><Input type="number" min={0} value={t.eggs} onChange={(e) => setTrolleys(trolleys.map((x, j) => j === i ? { ...x, eggs: e.target.value } : x))} /></Field>
                  <Button size="sm" variant="ghost" onClick={() => removeTrolley(i)} disabled={trolleys.length === 1}>Remove</Button>
                </div>
              ))}
              <p className="text-sm">Total this run: <strong>{totalEggs.toLocaleString()}</strong> eggs across {trolleys.filter((t) => Number(t.eggs) > 0).length} trolley(s).</p>
            </div>

            {err && <p className="text-sm text-status-refunded">{err}</p>}
            <div className="flex justify-end"><Button type="submit">Save fumigation</Button></div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="Receptions — fumigation status" />
        <TableWrap>
          <thead><tr><Th>Farm / flock</Th><Th className="text-right">Settable</Th><Th className="text-right">Fumigated</Th><Th className="text-right">Not fumigated</Th><Th>Where</Th></tr></thead>
          <tbody>
            {available.length === 0 ? <EmptyRow colSpan={5} text="No receptions." /> : available.map((r) => {
              const s = settableEggs(r); const fum = r.fumigatedEggs ?? 0;
              return (
                <tr key={r.id}>
                  <Td>{r.farm} · {r.flockId}</Td>
                  <Td className="text-right">{s.toLocaleString()}</Td>
                  <Td className="text-right">{fum.toLocaleString()}</Td>
                  <Td className="text-right">{Math.max(0, s - fum).toLocaleString()}</Td>
                  <Td>{r.location === "store" ? <Pill tone="info">Store</Pill> : r.location === "ready" ? <Pill tone="gold">Ready</Pill> : <Pill tone="neutral">—</Pill>}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title={`${rows.length} fumigation run(s)`} />
        <TableWrap>
          <thead><tr><Th>Date</Th><Th>Reception</Th><Th>Chemicals</Th><Th className="text-right">Trolleys</Th><Th className="text-right">Eggs</Th><Th>Time</Th><Th>By</Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={7} text="No fumigation records yet." /> : rows.map((r) => {
              const trolleyCount = Array.isArray(r.trolleys) ? r.trolleys.length : Number(r.trolleys) || 0;
              const eggs = r.totalEggs ?? 0;
              return (
                <tr key={r.id}>
                  <Td>{formatDate(r.date)}</Td>
                  <Td>{recLabel(r.receptionId)}</Td>
                  <Td>{r.chemicals}</Td>
                  <Td className="text-right">{trolleyCount}</Td>
                  <Td className="text-right">{eggs.toLocaleString()}</Td>
                  <Td>{r.time}</Td>
                  <Td>{r.by}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { availableFor, type Availability } from "@/lib/types";
import {
  DEFAULT_HATCH_RATE,
  INCUBATION_DAYS,
  availabilityFromBatches,
  batchProjections,
  hatchDateOf,
  projectedChicksOf,
} from "@/lib/projection";

const CAN_MANAGE = ["Admin"]; // manually open a date
const CAN_PROJECT = ["Admin", "Hatchery Manager", "Production Technician"]; // adjust batch projections

export default function AvailabilityPage() {
  const { user } = useAuth();
  const { availability, orders, upsertAvailability, removeAvailability } = useData();
  const { batches, upsertBatch } = useHatchery();
  const { toast } = useToast();

  const [date, setDate] = useState(todayISO());
  const [ross, setRoss] = useState("");
  const [tetra, setTetra] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({}); // per-batch projection edits

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const canProject = !!user && CAN_PROJECT.includes(user.role);

  const rows = useMemo(() => availability.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), [availability]);
  const projections = useMemo(() => batchProjections(batches), [batches]);

  if (!user) return null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!date) return setErr("Choose a date.");
    const r = Number(ross) || 0;
    const t = Number(tetra) || 0;
    if (r <= 0 && t <= 0) return setErr("Enter available chicks for at least one product.");
    const existing = availability.find((a) => a.id === date);
    const rec: Availability = { id: date, date, ross: r, tetra: t, by: user!.email, on: nowISO() };
    upsertAvailability(rec);
    toast(`${existing ? "Updated" : "Opened"} ${formatDate(date)} — Ross ${r.toLocaleString()}, Tetra ${t.toLocaleString()}.`);
    setRoss(""); setTetra("");
  }

  function editRow(a: Availability) {
    setDate(a.date); setRoss(String(a.ross)); setTetra(String(a.tetra));
  }

  function deleteDate(a: Availability) {
    const onDate = orders.filter((o) => o.date === a.id && o.status !== "refunded" && o.status !== "rejected").length;
    const warn = onDate > 0
      ? `\n\nWARNING: ${onDate} order(s) are on this date. They keep their date, but it will no longer be an open availability slot.`
      : "";
    if (!confirm(`Delete the delivery date ${formatDate(a.date)}?${warn}\n\nThis cannot be undone.`)) return;
    void removeAvailability(a.id);
    toast(`Deleted delivery date ${formatDate(a.date)}.`);
  }

  // Publish one hatch date's availability from the (possibly updated) batch list.
  function publishDate(hatchDate: string, list = batches) {
    const v = availabilityFromBatches(list).get(hatchDate);
    const existing = availability.find((a) => a.id === hatchDate);
    if (!v || (v.ross <= 0 && v.tetra <= 0)) {
      if (existing?.fromBatch) void removeAvailability(hatchDate);
      return;
    }
    upsertAvailability({
      id: hatchDate, date: hatchDate, ross: v.ross, tetra: v.tetra,
      fromBatch: true, by: existing?.by ?? user!.email, on: nowISO(),
    });
  }

  // Re-publish every batch-driven date, and clear stale auto rows.
  function syncAll() {
    const derived = availabilityFromBatches(batches);
    for (const [d, v] of derived) {
      const existing = availability.find((a) => a.id === d);
      upsertAvailability({
        id: d, date: d, ross: v.ross, tetra: v.tetra,
        fromBatch: true, by: existing?.by ?? user!.email, on: nowISO(),
      });
    }
    for (const a of availability) {
      if (a.fromBatch && !derived.has(a.id)) void removeAvailability(a.id);
    }
    toast(`Published ${derived.size} batch-driven date(s) to the ordering calendar.`);
  }

  function saveProjection(batchId: string) {
    const b = batches.find((x) => x.id === batchId);
    if (!b || !b.setDate) return;
    const raw = draft[batchId];
    const n = Math.max(0, Math.round(Number(raw) || 0));
    const updated = { ...b, projectedChicks: n };
    void upsertBatch(updated);
    const list = batches.map((x) => (x.id === batchId ? updated : x));
    publishDate(hatchDateOf(b.setDate), list);
    setDraft((d) => { const rest = { ...d }; delete rest[batchId]; return rest; });
    toast(`${b.batchNo}: expected chicks set to ${n.toLocaleString()}.`);
  }

  return (
    <div className="space-y-5">
      <p className="-mt-2 text-sm text-muted">
        Open the delivery dates on which orders can be placed and set how many chicks are available per product.
        Zone managers see the remaining numbers; DSRs only see that a date is open.
      </p>

      {canProject && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardHeader title="Expected from batches" />
            <Button size="sm" onClick={syncAll}>Re-sync to calendar</Button>
          </div>
          <p className="-mt-1 mb-3 text-sm text-muted">
            Each batch is expected to hatch <strong>{INCUBATION_DAYS} days</strong> after setting, at{" "}
            <strong>{Math.round(DEFAULT_HATCH_RATE * 100)}%</strong> of the eggs set. Adjust any batch below — the delivery
            date is opened automatically with the total expected chicks.
          </p>
          <TableWrap>
            <thead>
              <tr>
                <Th>Hatch date</Th>
                <Th>Batch</Th>
                <Th>Product</Th>
                <Th className="text-right">Eggs set</Th>
                <Th className="text-right">Expected chicks</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {projections.length === 0 ? (
                <EmptyRow colSpan={6} text="No upcoming batches. Set a batch to project its chicks here." />
              ) : projections.map((p) => {
                const current = projectedChicksOf(p.batch);
                const val = draft[p.batch.id] ?? String(current);
                const changed = Number(val) !== current;
                const adjusted = p.batch.projectedChicks != null;
                return (
                  <tr key={p.batch.id}>
                    <Td className="font-medium">{formatDate(p.hatchDate)}</Td>
                    <Td>{p.batch.batchNo}</Td>
                    <Td><Pill tone={p.product === "Ross 308" ? "ross" : "tetra"}>{p.product}</Pill></Td>
                    <Td className="text-right">{p.eggsSet.toLocaleString()}</Td>
                    <Td className="text-right">
                      <div className="flex items-center justify-end gap-2">
                        <input
                          type="number" min={0}
                          className="w-24 rounded-md border border-line bg-transparent px-2 py-1 text-right text-sm"
                          value={val}
                          onChange={(e) => setDraft((d) => ({ ...d, [p.batch.id]: e.target.value }))}
                        />
                        {!adjusted && !changed && <span className="text-xs text-muted">80%</span>}
                        {adjusted && !changed && <span className="text-xs text-muted">adj.</span>}
                      </div>
                    </Td>
                    <Td>
                      <Button size="sm" variant={changed ? "primary" : "ghost"} disabled={!changed} onClick={() => saveProjection(p.batch.id)}>
                        Save
                      </Button>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader title="Open / update a date manually" />
          <form onSubmit={save} className="flex flex-wrap items-end gap-3">
            <Field label="Delivery date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Ross 308 chicks"><Input type="number" min={0} value={ross} onChange={(e) => setRoss(e.target.value)} /></Field>
            <Field label="Tetra Super Harco chicks"><Input type="number" min={0} value={tetra} onChange={(e) => setTetra(e.target.value)} /></Field>
            <Button type="submit">Save availability</Button>
            {err && <p className="w-full text-sm text-status-refunded">{err}</p>}
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length} open date(s)`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Source</Th>
              <Th className="text-right">Ross available</Th><Th className="text-right">Ross left</Th>
              <Th className="text-right">Tetra available</Th><Th className="text-right">Tetra left</Th>
              {canManage && <Th></Th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={canManage ? 7 : 6} text="No ordering dates opened yet." />
            ) : rows.map((a) => {
              const rossLeft = availableFor(a, "Ross 308", orders);
              const tetraLeft = availableFor(a, "Tetra Super Harco", orders);
              return (
                <tr key={a.id}>
                  <Td className="font-medium">{formatDate(a.date)}</Td>
                  <Td>{a.fromBatch ? <Pill tone="green">Batches</Pill> : <span className="text-muted">Manual</span>}</Td>
                  <Td className="text-right">{a.ross.toLocaleString()}</Td>
                  <Td className="text-right">{a.ross > 0 ? <Pill tone={rossLeft > 0 ? "green" : "red"}>{rossLeft.toLocaleString()}</Pill> : <span className="text-muted">—</span>}</Td>
                  <Td className="text-right">{a.tetra.toLocaleString()}</Td>
                  <Td className="text-right">{a.tetra > 0 ? <Pill tone={tetraLeft > 0 ? "green" : "red"}>{tetraLeft.toLocaleString()}</Pill> : <span className="text-muted">—</span>}</Td>
                  {canManage && (
                    <Td>
                      {a.fromBatch ? (
                        <span className="text-xs text-muted">Auto — adjust in “Expected from batches”</span>
                      ) : (
                        <div className="flex gap-2">
                          <Button size="sm" variant="ghost" onClick={() => editRow(a)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteDate(a)}>Delete</Button>
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

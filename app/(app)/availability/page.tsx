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
import { Kpi } from "@/components/dashboard/Kpi";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { availableFor, type Availability, type Product } from "@/lib/types";
import {
  INCUBATION_DAYS,
  ROSS_HATCH_RATE,
  TETRA_HATCH_RATE,
  availabilityFromBatches,
  batchProjections,
  daysUntil,
  hatchDateOf,
  hatchedBatches,
  projectedChicksOf,
  type BatchProjection,
} from "@/lib/projection";

const CAN_MANAGE = ["Admin"]; // manually open / close a date
const CAN_PROJECT = ["Admin", "Hatchery Manager", "Production Technician"]; // adjust batch projections

const isActive = (s?: string) => s !== "refunded" && s !== "rejected";

/** "today" / "tomorrow" / "in N days" / "N days ago". */
function daysLabel(n: number): string {
  if (n === 0) return "today";
  if (n === 1) return "tomorrow";
  if (n === -1) return "yesterday";
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

function FillBar({ pct, over }: { pct: number; over: boolean }) {
  return (
    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-grey-bg">
      <div
        className={over ? "h-full bg-red" : pct >= 90 ? "h-full bg-amber" : "h-full bg-green"}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
}

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
  const hatched = useMemo(() => hatchedBatches(batches), [batches]);

  // Chicks already ordered on a date for a product (active orders only).
  const orderedOn = useMemo(() => {
    return (dateId: string, product: Product) =>
      orders
        .filter((o) => o.date === dateId && o.product === product && isActive(o.status))
        .reduce((s, o) => s + (o.chicks || 0), 0);
  }, [orders]);

  // Group upcoming projections by hatch date, with per-date subtotals.
  const grouped = useMemo(() => {
    const m = new Map<string, { date: string; items: BatchProjection[]; ross: number; tetra: number }>();
    for (const p of projections) {
      const g = m.get(p.hatchDate) ?? { date: p.hatchDate, items: [], ross: 0, tetra: 0 };
      g.items.push(p);
      if (p.product === "Ross 308") g.ross += p.projected; else g.tetra += p.projected;
      m.set(p.hatchDate, g);
    }
    return [...m.values()];
  }, [projections]);

  const kpi = useMemo(() => {
    const upRoss = projections.filter((p) => p.product === "Ross 308").reduce((s, p) => s + p.projected, 0);
    const upTetra = projections.filter((p) => p.product === "Tetra Super Harco").reduce((s, p) => s + p.projected, 0);
    const open = rows.filter((a) => !a.closed && (a.ross > 0 || a.tetra > 0));
    const left = open.reduce((s, a) => s + availableFor(a, "Ross 308", orders) + availableFor(a, "Tetra Super Harco", orders), 0);
    return { upRoss, upTetra, openCount: open.length, left, next: projections[0]?.hatchDate ?? null };
  }, [projections, rows, orders]);

  if (!user) return null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!date) return setErr("Choose a date.");
    const r = Number(ross) || 0;
    const t = Number(tetra) || 0;
    if (r <= 0 && t <= 0) return setErr("Enter available chicks for at least one product.");
    const existing = availability.find((a) => a.id === date);
    const rec: Availability = { id: date, date, ross: r, tetra: t, closed: existing?.closed, by: user!.email, on: nowISO() };
    upsertAvailability(rec);
    toast(`${existing ? "Updated" : "Opened"} ${formatDate(date)} — Ross ${r.toLocaleString()}, Tetra ${t.toLocaleString()}.`);
    setRoss(""); setTetra("");
  }

  function editRow(a: Availability) {
    setDate(a.date); setRoss(String(a.ross)); setTetra(String(a.tetra));
  }

  function deleteDate(a: Availability) {
    const onDate = orders.filter((o) => o.date === a.id && isActive(o.status)).length;
    const warn = onDate > 0
      ? `\n\nWARNING: ${onDate} order(s) are on this date. They keep their date, but it will no longer be an open availability slot.`
      : "";
    if (!confirm(`Delete the delivery date ${formatDate(a.date)}?${warn}\n\nThis cannot be undone.`)) return;
    void removeAvailability(a.id);
    toast(`Deleted delivery date ${formatDate(a.date)}.`);
  }

  function toggleClose(a: Availability) {
    upsertAvailability({ ...a, closed: !a.closed, by: user!.email, on: nowISO() });
    toast(`${a.closed ? "Reopened" : "Closed"} ${formatDate(a.date)} for ordering.`);
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
      fromBatch: true, closed: existing?.closed, by: existing?.by ?? user!.email, on: nowISO(),
    });
  }

  // Re-publish every batch-driven date, and clear stale auto rows.
  function syncAll() {
    const derived = availabilityFromBatches(batches);
    for (const [d, v] of derived) {
      const existing = availability.find((a) => a.id === d);
      upsertAvailability({
        id: d, date: d, ross: v.ross, tetra: v.tetra,
        fromBatch: true, closed: existing?.closed, by: existing?.by ?? user!.email, on: nowISO(),
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
    const n = Math.max(0, Math.round(Number(draft[batchId]) || 0));
    const updated = { ...b, projectedChicks: n };
    const list = batches.map((x) => (x.id === batchId ? updated : x));
    const hd = hatchDateOf(b.setDate);
    // Warn (but still save) if the new date total drops below what's already ordered.
    const total = availabilityFromBatches(list).get(hd);
    const already = orderedOn(hd, b.productType);
    const newForProduct = b.productType === "Ross 308" ? total?.ross ?? 0 : total?.tetra ?? 0;
    void upsertBatch(updated);
    publishDate(hd, list);
    setDraft((d) => { const rest = { ...d }; delete rest[batchId]; return rest; });
    if (already > 0 && newForProduct < already) {
      toast(`⚠ ${b.batchNo}: ${newForProduct.toLocaleString()} projected is below ${already.toLocaleString()} already ordered on ${formatDate(hd)}.`);
    } else {
      toast(`${b.batchNo}: expected chicks set to ${n.toLocaleString()}.`);
    }
  }

  return (
    <div className="space-y-5">
      <p className="-mt-2 text-sm text-muted">
        Chicks are expected on the delivery calendar <strong>{INCUBATION_DAYS} days</strong> after a batch is set, at{" "}
        {ROSS_HATCH_RATE === TETRA_HATCH_RATE
          ? <><strong>{Math.round(ROSS_HATCH_RATE * 100)}%</strong> of the eggs set</>
          : <>Ross <strong>{Math.round(ROSS_HATCH_RATE * 100)}%</strong> / Tetra <strong>{Math.round(TETRA_HATCH_RATE * 100)}%</strong> of eggs set</>}.
        Adjust any batch below; zone managers see the remaining numbers, DSRs only see that a date is open.
      </p>

      {/* Supply at a glance */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Kpi compact icon="chicks" tone="blue" label="Upcoming Ross" value={kpi.upRoss.toLocaleString()} sub="projected, not yet hatched" />
        <Kpi compact icon="chicks" tone="purple" label="Upcoming Tetra" value={kpi.upTetra.toLocaleString()} sub="projected, not yet hatched" />
        <Kpi compact icon="orders" tone="default" label="Open dates" value={String(kpi.openCount)} />
        <Kpi compact icon="check" tone="green" label="Chicks still available" value={kpi.left.toLocaleString()} />
        <Kpi compact icon="pending" tone="amber" label="Next hatch" value={kpi.next ? formatDate(kpi.next) : "—"} sub={kpi.next ? daysLabel(daysUntil(kpi.next)) : undefined} />
      </div>

      {canProject && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardHeader title="Expected from batches" />
            <Button size="sm" onClick={syncAll}>Re-sync to calendar</Button>
          </div>
          <p className="-mt-1 mb-3 text-sm text-muted">
            Each set batch opens its hatch date automatically. Adjust a batch&apos;s expected chicks below — the delivery
            date&apos;s total updates. A batch&apos;s own number always wins over the default rate.
          </p>
          <TableWrap>
            <thead>
              <tr>
                <Th>Batch</Th>
                <Th>Product</Th>
                <Th className="text-right">Eggs set</Th>
                <Th className="text-right">Expected chicks</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {grouped.length === 0 ? (
                <EmptyRow colSpan={5} text="No upcoming batches. Set a batch to project its chicks here." />
              ) : grouped.map((g) => (
                <FragmentRows key={g.date} groupDate={g.date} ross={g.ross} tetra={g.tetra}>
                  {g.items.map((p) => {
                    const current = projectedChicksOf(p.batch);
                    const val = draft[p.batch.id] ?? String(current);
                    const changed = Number(val) !== current;
                    const adjusted = p.batch.projectedChicks != null;
                    return (
                      <tr key={p.batch.id}>
                        <Td className="font-medium">{p.batch.batchNo}</Td>
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
                            {!adjusted && !changed && <span className="text-xs text-muted">{Math.round((p.product === "Ross 308" ? ROSS_HATCH_RATE : TETRA_HATCH_RATE) * 100)}%</span>}
                            {adjusted && !changed && <span className="text-xs text-muted">adj.</span>}
                          </div>
                        </Td>
                        <Td>
                          <Button size="sm" variant={changed ? "primary" : "ghost"} disabled={!changed} onClick={() => saveProjection(p.batch.id)}>Save</Button>
                        </Td>
                      </tr>
                    );
                  })}
                </FragmentRows>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {canProject && hatched.length > 0 && (
        <Card>
          <CardHeader title="Projection accuracy" />
          <p className="-mt-1 mb-3 text-sm text-muted">How hatched batches compared to their projection — use it to calibrate the rate.</p>
          <TableWrap>
            <thead>
              <tr>
                <Th>Hatch date</Th>
                <Th>Batch</Th>
                <Th>Product</Th>
                <Th className="text-right">Eggs set</Th>
                <Th className="text-right">Projected</Th>
                <Th className="text-right">Actual</Th>
                <Th className="text-right">vs projected</Th>
                <Th className="text-right">Real hatch %</Th>
              </tr>
            </thead>
            <tbody>
              {hatched.slice(0, 12).map((h) => {
                const vsProj = h.projected > 0 ? Math.round((h.actual / h.projected) * 100) : 0;
                const realRate = h.batch.eggsSet > 0 ? Math.round((h.actual / h.batch.eggsSet) * 100) : 0;
                return (
                  <tr key={h.batch.id}>
                    <Td className="font-medium">{formatDate(h.hatchDate)}</Td>
                    <Td>{h.batch.batchNo}</Td>
                    <Td><Pill tone={h.batch.productType === "Ross 308" ? "ross" : "tetra"}>{h.batch.productType}</Pill></Td>
                    <Td className="text-right">{h.batch.eggsSet.toLocaleString()}</Td>
                    <Td className="text-right">{h.projected.toLocaleString()}</Td>
                    <Td className="text-right font-medium">{h.actual.toLocaleString()}</Td>
                    <Td className="text-right"><Pill tone={vsProj >= 100 ? "green" : vsProj >= 90 ? "amber" : "red"}>{vsProj}%</Pill></Td>
                    <Td className="text-right text-muted">{realRate}%</Td>
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
        <CardHeader title={`${rows.length} date(s)`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th>Source</Th>
              <Th className="text-right">Ross (left / avail)</Th>
              <Th className="text-right">Tetra (left / avail)</Th>
              <Th>Committed</Th>
              <Th>Status</Th>
              {canManage && <Th></Th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={canManage ? 7 : 6} text="No ordering dates opened yet." />
            ) : rows.map((a) => {
              const rossLeft = availableFor(a, "Ross 308", orders);
              const tetraLeft = availableFor(a, "Tetra Super Harco", orders);
              const rossOrd = orderedOn(a.id, "Ross 308");
              const tetraOrd = orderedOn(a.id, "Tetra Super Harco");
              const cap = a.ross + a.tetra;
              const ord = rossOrd + tetraOrd;
              const pct = cap > 0 ? Math.round((ord / cap) * 100) : 0;
              const over = rossOrd > a.ross || tetraOrd > a.tetra;
              return (
                <tr key={a.id} className={a.closed ? "opacity-55" : undefined}>
                  <Td className="font-medium">{formatDate(a.date)}</Td>
                  <Td>{a.fromBatch ? <Pill tone="green">Batches</Pill> : <span className="text-muted">Manual</span>}</Td>
                  <Td className="text-right">
                    {a.ross > 0 ? <><Pill tone={rossLeft > 0 ? "green" : "red"}>{rossLeft.toLocaleString()}</Pill> <span className="text-xs text-muted">/ {a.ross.toLocaleString()}</span></> : <span className="text-muted">—</span>}
                  </Td>
                  <Td className="text-right">
                    {a.tetra > 0 ? <><Pill tone={tetraLeft > 0 ? "green" : "red"}>{tetraLeft.toLocaleString()}</Pill> <span className="text-xs text-muted">/ {a.tetra.toLocaleString()}</span></> : <span className="text-muted">—</span>}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <FillBar pct={pct} over={over} />
                      <span className="text-xs text-muted tabular-nums">{pct}%</span>
                    </div>
                  </Td>
                  <Td>
                    {a.closed ? <Pill tone="neutral">Closed</Pill> : over ? <Pill tone="red">Oversold</Pill> : <Pill tone="green">Open</Pill>}
                  </Td>
                  {canManage && (
                    <Td>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="ghost" onClick={() => toggleClose(a)}>{a.closed ? "Reopen" : "Close"}</Button>
                        {!a.fromBatch && <>
                          <Button size="sm" variant="ghost" onClick={() => editRow(a)}>Edit</Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteDate(a)}>Delete</Button>
                        </>}
                        {a.fromBatch && <span className="self-center text-xs text-muted">auto</span>}
                      </div>
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

/** A date sub-header row (date · countdown · subtotals) followed by its batch rows. */
function FragmentRows({ groupDate, ross, tetra, children }: {
  groupDate: string; ross: number; tetra: number; children: React.ReactNode;
}) {
  return (
    <>
      <tr className="bg-cream/40">
        <td colSpan={5} className="border-b border-line px-2.5 py-2 align-middle">
          <span className="font-semibold text-ink">{formatDate(groupDate)}</span>
          <span className="text-muted"> · {daysLabel(daysUntil(groupDate))}</span>
          <span className="text-muted"> · </span>
          {ross > 0 && <span className="text-blue">Ross {ross.toLocaleString()}</span>}
          {ross > 0 && tetra > 0 && <span className="text-muted"> · </span>}
          {tetra > 0 && <span className="text-purple">Tetra {tetra.toLocaleString()}</span>}
        </td>
      </tr>
      {children}
    </>
  );
}

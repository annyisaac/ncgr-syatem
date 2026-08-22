"use client";

import { useMemo, useState, useEffect, type ReactNode } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { PERIODS, presetToRange, type PeriodPreset } from "@/lib/period";
import { ALL_TIME, inRange } from "@/components/ui/DateRange";
import { availableFor, toDeliver, type Availability, type Product } from "@/lib/types";
import {
  DELIVERY_LAG_DAYS,
  availabilityFromBatches,
  batchProjections,
  daysUntil,
  deliveryDateOf,
  hatchedBatches,
  projectedChicksOf,
  type BatchProjection,
} from "@/lib/projection";

const CAN_MANAGE = ["Admin"]; // manually open / close / edit a date
const CAN_PROJECT = ["Admin", "Hatchery Manager", "Production Technician"]; // adjust batch projections

const isActive = (s?: string) => s !== "refunded" && s !== "rejected";
const daysLabel = (n: number) => (n === 0 ? "today" : n === 1 ? "tomorrow" : n === -1 ? "yesterday" : n > 0 ? `in ${n} days` : `${-n} days ago`);

function FillBar({ pct, over, full }: { pct: number; over: boolean; full?: boolean }) {
  return (
    <div className={`h-1.5 overflow-hidden rounded-full bg-grey-bg ${full ? "w-full" : "w-24"}`}>
      <div className={over ? "h-full bg-red" : pct >= 90 ? "h-full bg-amber" : "h-full bg-green"} style={{ width: `${Math.min(100, pct)}%` }} />
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
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [showForm, setShowForm] = useState(false);
  const [preset, setPreset] = useState<PeriodPreset>("month"); // projection-accuracy range
  const [sourceFilter, setSourceFilter] = useState<"all" | "manual" | "batches">("all");
  const [showAllDates, setShowAllDates] = useState(false);

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const canProject = !!user && CAN_PROJECT.includes(user.role);

  const rows = useMemo(() => availability.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), [availability]);
  const projections = useMemo(() => batchProjections(batches), [batches]);
  const hatched = useMemo(() => hatchedBatches(batches), [batches]);

  const orderedOn = useMemo(() => (dateId: string, product: Product) =>
    orders.filter((o) => o.date === dateId && o.product === product && isActive(o.status)).reduce((s, o) => s + toDeliver(o), 0), [orders]);

  // Upcoming projections grouped by delivery date (manager editing).
  const grouped = useMemo(() => {
    const m = new Map<string, { date: string; items: BatchProjection[]; ross: number; tetra: number }>();
    for (const p of projections) {
      const g = m.get(p.deliveryDate) ?? { date: p.deliveryDate, items: [], ross: 0, tetra: 0 };
      g.items.push(p);
      if (p.product === "Ross 308") g.ross += p.projected; else g.tetra += p.projected;
      m.set(p.deliveryDate, g);
    }
    return [...m.values()];
  }, [projections]);

  // --- Projection accuracy over the chosen period -------------------------
  const range = useMemo(() => presetToRange(preset, ALL_TIME, todayISO()), [preset]);
  const accuracy = useMemo(() => {
    const list = hatched.filter((h) => inRange(h.hatchDate, range));
    const eggsSet = list.reduce((s, h) => s + h.batch.eggsSet, 0);
    const projected = list.reduce((s, h) => s + h.projected, 0);
    const actual = list.reduce((s, h) => s + h.actual, 0);
    const realPct = eggsSet > 0 ? Math.round((actual / eggsSet) * 100) : 0;
    const vsProjPct = projected > 0 ? Math.round((actual / projected) * 100) : 0;
    return { list, eggsSet, projected, actual, realPct, vsProjPct, variance: vsProjPct - 100 };
  }, [hatched, range]);

  // Auto-link manually opened dates to their batch (Admin persists).
  useEffect(() => {
    if (!canManage) return;
    const derived = availabilityFromBatches(batches);
    for (const a of availability) {
      if (a.fromBatch) continue;
      const v = derived.get(a.id);
      if (!v || (v.ross <= 0 && v.tetra <= 0)) continue;
      void upsertAvailability({ id: a.id, date: a.date, ross: v.ross, tetra: v.tetra, fromBatch: true, closed: a.closed, by: a.by ?? user!.email, on: nowISO() });
      toast(`Linked ${formatDate(a.date)} to its batch.`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, availability, canManage]);

  if (!user) return null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!date) return setErr("Choose a date.");
    const r = Number(ross) || 0, t = Number(tetra) || 0;
    if (r <= 0 && t <= 0) return setErr("Enter available chicks for at least one product.");
    const existing = availability.find((a) => a.id === date);
    upsertAvailability({ id: date, date, ross: r, tetra: t, closed: existing?.closed, by: user!.email, on: nowISO() });
    toast(`${existing ? "Updated" : "Opened"} ${formatDate(date)} — Ross ${r.toLocaleString()}, Tetra ${t.toLocaleString()}.`);
    setRoss(""); setTetra(""); setShowForm(false);
  }

  function editRow(a: Availability) {
    setErr(null);
    setDate(a.date); setRoss(String(a.ross)); setTetra(String(a.tetra)); setShowForm(true);
  }

  const hasActiveOrders = (id: string) => orders.some((o) => o.date === id && isActive(o.status));

  function toggleClose(a: Availability) {
    upsertAvailability({ ...a, closed: !a.closed, by: user!.email, on: nowISO() });
    toast(`${a.closed ? "Reopened" : "Closed"} ${formatDate(a.date)} for ordering.`);
  }

  function publishDate(deliveryDate: string, list = batches) {
    const v = availabilityFromBatches(list).get(deliveryDate);
    const existing = availability.find((a) => a.id === deliveryDate);
    if (!v || (v.ross <= 0 && v.tetra <= 0)) {
      if (existing?.fromBatch && !hasActiveOrders(deliveryDate)) void removeAvailability(deliveryDate);
      return;
    }
    upsertAvailability({ id: deliveryDate, date: deliveryDate, ross: v.ross, tetra: v.tetra, fromBatch: true, closed: existing?.closed, by: existing?.by ?? user!.email, on: nowISO() });
    toast(`Re-synced ${formatDate(deliveryDate)} to its batch projection.`);
  }

  function syncAll() {
    const derived = availabilityFromBatches(batches);
    for (const [d, v] of derived) {
      const existing = availability.find((a) => a.id === d);
      upsertAvailability({ id: d, date: d, ross: v.ross, tetra: v.tetra, fromBatch: true, closed: existing?.closed, by: existing?.by ?? user!.email, on: nowISO() });
    }
    for (const a of availability) if (a.fromBatch && !derived.has(a.id) && !hasActiveOrders(a.id)) void removeAvailability(a.id);
    toast(`Published ${derived.size} batch-driven date(s) to the ordering calendar.`);
  }

  function saveProjection(batchId: string) {
    const b = batches.find((x) => x.id === batchId);
    if (!b || !b.setDate) return;
    const n = Math.max(0, Math.round(Number(draft[batchId]) || 0));
    const updated = { ...b, projectedChicks: n };
    const list = batches.map((x) => (x.id === batchId ? updated : x));
    const hd = deliveryDateOf(b.setDate);
    const total = availabilityFromBatches(list).get(hd);
    const already = orderedOn(hd, b.productType);
    const newForProduct = b.productType === "Ross 308" ? total?.ross ?? 0 : total?.tetra ?? 0;
    void upsertBatch(updated);
    publishDate(hd, list);
    setDraft((d) => { const rest = { ...d }; delete rest[batchId]; return rest; });
    if (already > 0 && newForProduct < already) toast(`⚠ ${b.batchNo}: ${newForProduct.toLocaleString()} projected is below ${already.toLocaleString()} already ordered on ${formatDate(hd)}.`);
    else toast(`${b.batchNo}: expected chicks set to ${n.toLocaleString()}.`);
  }

  function exportAccuracy() {
    if (accuracy.list.length === 0) return toast("No hatched batches in this period.", "info");
    const head = ["Hatch date", "Batch", "Product", "Eggs set", "Projected", "Actual", "Real hatch %", "vs Projected %"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const h of accuracy.list) {
      const real = h.batch.eggsSet > 0 ? Math.round((h.actual / h.batch.eggsSet) * 100) : 0;
      const vs = h.projected > 0 ? Math.round((h.actual / h.projected) * 100) : 0;
      lines.push([formatDate(h.hatchDate), h.batch.batchNo, h.batch.productType, String(h.batch.eggsSet), String(h.projected), String(h.actual), `${real}%`, `${vs}%`].map((v) => esc(String(v))).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = "projection-accuracy.csv"; a.click(); URL.revokeObjectURL(url);
  }

  const rossOrderedForDate = orderedOn(date, "Ross 308");
  const tetraOrderedForDate = orderedOn(date, "Tetra Super Harco");
  const rossOversell = ross.trim() !== "" && Number(ross) < rossOrderedForDate;
  const tetraOversell = tetra.trim() !== "" && Number(tetra) < tetraOrderedForDate;

  const filteredDates = rows.filter((a) => sourceFilter === "all" || (sourceFilter === "batches" ? a.fromBatch : !a.fromBatch));
  const visibleDates = showAllDates ? filteredDates : filteredDates.slice(0, 8);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Projection &amp; Delivery Overview</h1>
          <p className="mt-1 text-sm text-muted">Track hatching performance and delivery commitments.</p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && <Button size="sm" onClick={() => { setErr(null); setDate(todayISO()); setRoss(""); setTetra(""); setShowForm(true); }}>Open a date</Button>}
          {canProject && <Button size="sm" variant="ghost" onClick={syncAll}>Re-sync to calendar</Button>}
        </div>
      </div>

      {/* ---------------------------------------------------------- Projection accuracy */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-bg text-gold-dark"><IcoTrend /></span>
            <div>
              <h2 className="text-[0.78rem] font-bold uppercase tracking-wide text-ink">Projection accuracy</h2>
              <p className="text-xs text-muted">How hatched batches compared to their projection — use it to calibrate the rate.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-44"><Select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} options={PERIODS.filter((p) => p.value !== "custom")} /></div>
            {canProject && <Button size="sm" variant="ghost" onClick={exportAccuracy}>⬇ Export</Button>}
          </div>
        </div>

        {/* Summary tiles */}
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
          <ProjTile icon={<IcoCal />} tone="blue" value={String(accuracy.list.length)} label="Batches" sub="In this period" />
          <ProjTile icon={<IcoEgg />} tone="green" value={accuracy.eggsSet.toLocaleString()} label="Eggs set" sub="Total" />
          <ProjTile icon={<IcoChick />} tone="purple" value={accuracy.actual.toLocaleString()} label="Actual hatched" sub="Total" />
          <ProjTile icon={<IcoTarget />} tone="gold" value={`${accuracy.realPct}%`} label="Avg real hatch %" sub="Performance" />
          <ProjTile icon={<IcoVar />} tone={accuracy.variance < 0 ? "red" : "green"} value={`${Math.abs(accuracy.variance)}%`} label="Avg vs projected" sub="Variance" />
        </div>

        {/* Per-batch cards */}
        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {accuracy.list.length === 0 ? (
            <div className="col-span-full py-8 text-center text-sm text-muted">No hatched batches in this period.</div>
          ) : accuracy.list.slice(0, 7).map((h) => {
            const real = h.batch.eggsSet > 0 ? Math.round((h.actual / h.batch.eggsSet) * 100) : 0;
            const vs = h.projected > 0 ? Math.round((h.actual / h.projected) * 100) : 0;
            const tone = vs >= 100 ? "text-green" : vs >= 90 ? "text-amber" : "text-red";
            return (
              <div key={h.batch.id} className="rounded-2xl border border-line bg-paper p-4 shadow-card">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted">{formatDate(h.hatchDate)}</span>
                  <Pill tone={h.batch.productType === "Ross 308" ? "ross" : "tetra"}>{h.batch.productType}</Pill>
                </div>
                <p className="mt-1 truncate font-bold text-ink">{h.batch.batchNo}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 border-t border-line pt-3">
                  <ProjMini label="Eggs Set" value={h.batch.eggsSet.toLocaleString()} />
                  <ProjMini label="Actual" value={h.actual.toLocaleString()} />
                  <ProjMini label="Real Hatch %" value={`${real}%`} />
                </div>
                <div className="mt-3 flex items-center justify-between rounded-lg bg-cream px-3 py-2 text-xs">
                  <span className="text-muted">vs Projected</span>
                  <span className={`flex items-center gap-1 font-bold ${tone}`}>{vs >= 100 ? "▲" : "▼"} {vs}%</span>
                </div>
              </div>
            );
          })}
          {accuracy.list.length > 0 && accuracy.list.length <= 7 && (
            <div className="hidden items-center gap-3 rounded-2xl border border-dashed border-line bg-cream/50 p-4 xl:flex">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-gold-bg text-gold-dark"><IcoChick /></span>
              <div><p className="font-semibold text-ink">Keep monitoring</p><p className="text-xs text-muted">Calibrate regularly for better accuracy.</p></div>
            </div>
          )}
        </div>
      </Card>

      {/* ---------------------------------------------------------- Delivery dates */}
      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-bg text-gold-dark"><IcoCal /></span>
            <div>
              <h2 className="text-[0.78rem] font-bold uppercase tracking-wide text-ink">Delivery dates · {filteredDates.length}</h2>
              <p className="text-xs text-muted">Track commitments vs availability by delivery date.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-40"><Select value={sourceFilter} onChange={(e) => { setSourceFilter(e.target.value as typeof sourceFilter); setShowAllDates(false); }} options={[{ value: "all", label: "All sources" }, { value: "manual", label: "Manual" }, { value: "batches", label: "Batches" }]} /></div>
            <Link href="/planning"><Button size="sm" variant="ghost">📅 View calendar</Button></Link>
          </div>
        </div>

        {filteredDates.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">No ordering dates {sourceFilter === "all" ? "opened yet" : `from this source`}.</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {visibleDates.map((a) => {
              const rossLeft = availableFor(a, "Ross 308", orders);
              const tetraLeft = availableFor(a, "Tetra Super Harco", orders);
              const rossOrd = orderedOn(a.id, "Ross 308");
              const tetraOrd = orderedOn(a.id, "Tetra Super Harco");
              const cap = a.ross + a.tetra;
              const pct = cap > 0 ? Math.round(((rossOrd + tetraOrd) / cap) * 100) : 0;
              const over = rossOrd > a.ross || tetraOrd > a.tetra;
              const past = a.date < todayISO();
              return (
                <div key={a.id} className={`flex flex-col rounded-2xl border border-line bg-paper p-4 shadow-card ${a.closed || past ? "opacity-70" : ""}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-ink">{formatDate(a.date)}</span>
                    {a.fromBatch ? <Pill tone="green">Batches</Pill> : <Pill tone="neutral">Manual</Pill>}
                  </div>
                  <div className="mt-3 space-y-1.5 text-sm">
                    <div className="flex items-center justify-between"><span className="text-muted">Ross (Left / Avail)</span>{a.ross > 0 ? <span className="tabular-nums"><b className={rossLeft > 0 ? "text-green" : "text-red"}>● {rossLeft.toLocaleString()}</b> <span className="text-muted">/ {a.ross.toLocaleString()}</span></span> : <span className="text-muted">—</span>}</div>
                    <div className="flex items-center justify-between"><span className="text-muted">Tetra (Left / Avail)</span>{a.tetra > 0 ? <span className="tabular-nums"><b className={tetraLeft > 0 ? "text-green" : "text-red"}>● {tetraLeft.toLocaleString()}</b> <span className="text-muted">/ {a.tetra.toLocaleString()}</span></span> : <span className="text-muted">—</span>}</div>
                  </div>
                  <div className="mt-3">
                    <div className="mb-1 flex items-center justify-between text-xs"><span className="text-muted">Committed</span><span className="font-semibold tabular-nums text-ink">{pct}%</span></div>
                    <FillBar pct={pct} over={over} full />
                  </div>
                  <div className="mt-2.5 flex items-center justify-between text-sm"><span className="text-muted">Status</span>{past ? <Pill tone="neutral">Ended</Pill> : a.closed ? <Pill tone="neutral">Closed</Pill> : over ? <Pill tone="red">Oversold</Pill> : <Pill tone="green">Open</Pill>}</div>
                  {canManage && !past && (
                    <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
                      <Button size="sm" variant="ghost" onClick={() => toggleClose(a)}>{a.closed ? "Reopen" : "Close"}</Button>
                      {a.fromBatch ? <Button size="sm" variant="ghost" onClick={() => publishDate(a.id)}>Auto</Button> : <Button size="sm" variant="ghost" onClick={() => editRow(a)}>Edit</Button>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {filteredDates.length > 8 && (
          <div className="mt-4 flex items-center justify-center gap-3 text-sm text-muted">
            <span>Showing {visibleDates.length} of {filteredDates.length} dates</span>
            <Button size="sm" variant="ghost" onClick={() => setShowAllDates((v) => !v)}>{showAllDates ? "Show fewer" : "View all dates →"}</Button>
          </div>
        )}
      </Card>

      {/* ---------------------------------------------------------- Upcoming production (adjust projections) */}
      {canProject && grouped.length > 0 && (
        <Card>
          <h3 className="card-title">Upcoming production — adjust expected chicks</h3>
          <p className="mb-3 mt-1 text-sm text-muted">Each set batch opens its delivery date automatically (hatch + {DELIVERY_LAG_DAYS} days). Adjust a batch&apos;s expected chicks — the delivery date&apos;s total updates.</p>
          <div className="space-y-3">
            {grouped.map((g) => (
              <div key={g.date}>
                <div className="mb-1.5 flex flex-wrap items-center gap-x-1.5 text-xs">
                  <span className="font-semibold text-ink">{formatDate(g.date)}</span>
                  <span className="text-muted">· {daysLabel(daysUntil(g.date))}</span>
                  {g.ross > 0 && <span className="text-blue">· Ross {g.ross.toLocaleString()}</span>}
                  {g.tetra > 0 && <span className="text-purple">· Tetra {g.tetra.toLocaleString()}</span>}
                </div>
                <div className="space-y-1.5">
                  {g.items.map((p) => {
                    const current = projectedChicksOf(p.batch);
                    const val = draft[p.batch.id] ?? String(current);
                    const changed = Number(val) !== current;
                    const rate = p.eggsSet > 0 ? Math.round((current / p.eggsSet) * 100) : 0;
                    return (
                      <div key={p.batch.id} className="flex items-center gap-3 rounded-xl border border-line bg-field/50 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2"><span className="truncate text-xs font-semibold text-ink">{p.batch.batchNo}</span><Pill tone={p.product === "Ross 308" ? "ross" : "tetra"}>{p.product === "Ross 308" ? "Ross" : "Tetra"}</Pill></div>
                          <div className="mt-1 flex items-center gap-2"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-grey-bg"><div className="h-full bg-green" style={{ width: `${Math.min(100, rate)}%` }} /></div><span className="text-[0.68rem] text-muted tabular-nums">{p.eggsSet.toLocaleString()} eggs · {p.batch.projectedChicks != null ? "adj." : `${rate}%`}</span></div>
                        </div>
                        <div className="flex items-center gap-2">
                          <input type="number" min={0} className="w-20 rounded-md border border-line bg-transparent px-2 py-1 text-right text-xs tabular-nums" value={val} onChange={(e) => setDraft((d) => ({ ...d, [p.batch.id]: e.target.value }))} />
                          <Button size="sm" variant={changed ? "primary" : "ghost"} disabled={!changed} onClick={() => saveProjection(p.batch.id)}>Save</Button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {canManage && (
        <Modal open={showForm} onClose={() => setShowForm(false)} title="Open / update a delivery date">
          <form onSubmit={save} className="space-y-3">
            <Field label="Delivery date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Ross 308 chicks"><Input type="number" min={0} value={ross} onChange={(e) => setRoss(e.target.value)} /></Field>
              <Field label="Tetra Super Harco chicks"><Input type="number" min={0} value={tetra} onChange={(e) => setTetra(e.target.value)} /></Field>
            </div>
            {err && <p className="text-sm text-status-refunded">{err}</p>}
            {(rossOversell || tetraOversell) && (
              <p className="rounded-lg border border-red/30 bg-red-bg px-3 py-2 text-sm font-medium text-red">
                ⚠ {formatDate(date)} already has orders — saving this will oversell the date.
                {rossOversell && ` Ross: ${rossOrderedForDate.toLocaleString()} ordered vs ${Number(ross).toLocaleString()} you're setting.`}
                {tetraOversell && ` Tetra: ${tetraOrderedForDate.toLocaleString()} ordered vs ${Number(tetra).toLocaleString()} you're setting.`}
              </p>
            )}
            <div className="flex justify-end pt-1"><Button type="submit">Save availability</Button></div>
          </form>
        </Modal>
      )}
    </div>
  );
}

// ---- small pieces ----------------------------------------------------------

type Tone = "blue" | "green" | "purple" | "gold" | "red";
const CHIP: Record<Tone, string> = { blue: "bg-blue-bg text-blue", green: "bg-green-bg text-green", purple: "bg-purple-bg text-purple", gold: "bg-gold-bg text-gold-dark", red: "bg-red-bg text-red" };
function ProjTile({ icon, value, label, sub, tone }: { icon: ReactNode; value: string; label: string; sub: string; tone: Tone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 shadow-card">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${CHIP[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[1.15rem] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</p>
        <p className="mt-1 truncate text-[0.6rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
        <p className="truncate text-[0.58rem] text-muted">{sub}</p>
      </div>
    </div>
  );
}
function ProjMini({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="truncate text-[0.56rem] font-semibold uppercase tracking-wide text-muted">{label}</p><p className="truncate text-sm font-bold tabular-nums text-ink">{value}</p></div>;
}

const isvg = (children: ReactNode) => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>;
const IcoTrend = () => isvg(<><path d="M4 15l5-5 4 4 7-7" /><path d="M17 7h4v4" /></>);
const IcoCal = () => isvg(<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M9 3v4M15 3v4" /></>);
const IcoEgg = () => isvg(<ellipse cx="12" cy="13" rx="6" ry="8" />);
const IcoChick = () => isvg(<><circle cx="12" cy="10" r="5" /><path d="M12 15v4M9 19h6M10 9h.01M14 9h.01M12 11l1.5 1" /></>);
const IcoTarget = () => isvg(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="1" /></>);
const IcoVar = () => isvg(<><path d="M4 9l5 5 4-4 7 7" /><path d="M17 17h4v-4" /></>);

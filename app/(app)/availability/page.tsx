"use client";

import { useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { availableFor, toDeliver, type Availability, type Product } from "@/lib/types";
import {
  INCUBATION_DAYS,
  DELIVERY_LAG_DAYS,
  ROSS_HATCH_RATE,
  TETRA_HATCH_RATE,
  availabilityFromBatches,
  batchProjections,
  daysUntil,
  deliveryDateOf,
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

/** A metric tile with a coloured accent bar — the top overview row. */
function Metric({ label, value, note, accent }: {
  label: string; value: string; note?: React.ReactNode; accent: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-line bg-paper p-4 shadow-card">
      <span className="absolute left-0 top-4 h-8 w-1 rounded-r-full" style={{ background: accent }} aria-hidden />
      <div className="ml-2 text-[0.66rem] font-bold uppercase tracking-wide text-muted">{label}</div>
      <div className="ml-2 mt-1.5 text-[1.5rem] font-extrabold leading-none tracking-tight tabular-nums">{value}</div>
      {note !== undefined && <div className="ml-2 mt-1 text-[0.72rem] text-muted">{note}</div>}
    </div>
  );
}

/** Build an SVG polyline `d` from a numeric series, scaled to w×h. */
function sparkPath(vals: number[], w = 300, h = 54): string {
  if (vals.length < 2) return "";
  const max = Math.max(...vals), min = Math.min(...vals), span = max - min || 1, step = w / (vals.length - 1);
  return vals
    .map((v, i) => `${i === 0 ? "M" : "L"} ${(i * step).toFixed(1)} ${(h - 4 - ((v - min) / span) * (h - 8)).toFixed(1)}`)
    .join(" ");
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
  const [showForm, setShowForm] = useState(false); // "open / update a date" modal

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const canProject = !!user && CAN_PROJECT.includes(user.role);

  const rows = useMemo(() => availability.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), [availability]);
  const projections = useMemo(() => batchProjections(batches), [batches]);
  const hatched = useMemo(() => hatchedBatches(batches), [batches]);

  // Chicks already committed on a date for a product (active orders only) — the
  // full amount that leaves the hatchery: chicks + 2% free extra + compensation.
  const orderedOn = useMemo(() => {
    return (dateId: string, product: Product) =>
      orders
        .filter((o) => o.date === dateId && o.product === product && isActive(o.status))
        .reduce((s, o) => s + toDeliver(o), 0);
  }, [orders]);

  // Group upcoming projections by delivery date, with per-date subtotals.
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

  const kpi = useMemo(() => {
    const upRoss = projections.filter((p) => p.product === "Ross 308").reduce((s, p) => s + p.projected, 0);
    const upTetra = projections.filter((p) => p.product === "Tetra Super Harco").reduce((s, p) => s + p.projected, 0);
    const open = rows.filter((a) => !a.closed && a.date >= todayISO() && (a.ross > 0 || a.tetra > 0));
    const left = open.reduce((s, a) => s + availableFor(a, "Ross 308", orders) + availableFor(a, "Tetra Super Harco", orders), 0);
    return { upRoss, upTetra, openCount: open.length, left, next: projections[0]?.deliveryDate ?? null };
  }, [projections, rows, orders]);

  // Open dates whose orders already exceed the capacity set for a product.
  const attention = useMemo(
    () => rows.filter((a) => !a.closed && a.date >= todayISO() && (orderedOn(a.id, "Ross 308") > a.ross || orderedOn(a.id, "Tetra Super Harco") > a.tetra)),
    [rows, orderedOn]
  );

  // Capacity health across open dates: on-plan (<90% full), watch (90–100%),
  // oversold (>100%). Score weights a watch date as half a healthy one.
  const health = useMemo(() => {
    const open = rows.filter((a) => !a.closed && a.date >= todayISO() && (a.ross > 0 || a.tetra > 0));
    let onPlan = 0, watch = 0, oversold = 0;
    for (const a of open) {
      const rp = a.ross > 0 ? orderedOn(a.id, "Ross 308") / a.ross : 0;
      const tp = a.tetra > 0 ? orderedOn(a.id, "Tetra Super Harco") / a.tetra : 0;
      const p = Math.max(rp, tp);
      if (p > 1) oversold++; else if (p >= 0.9) watch++; else onPlan++;
    }
    const total = open.length;
    const score = total ? Math.round((100 * (onPlan + watch * 0.5)) / total) : 100;
    return { onPlan, watch, oversold, total, score };
  }, [rows, orderedOn]);

  // Chicks still available across the next few open delivery dates — the trend.
  const trend = useMemo(() => {
    const today = todayISO();
    return rows
      .filter((a) => !a.closed && (a.ross > 0 || a.tetra > 0) && a.date >= today)
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .slice(0, 8)
      .map((a) => availableFor(a, "Ross 308", orders) + availableFor(a, "Tetra Super Harco", orders));
  }, [rows, orders]);

  // Auto-match: a delivery date opened MANUALLY (in anticipation of chicks) is
  // linked to its batch as soon as one is set for the same delivery date — the
  // row flips to batch-backed and its capacity follows the batch projection from
  // then on. This is the same effect as "Re-sync to calendar", but automatic and
  // scoped to the manual dates a batch now covers (batch-only dates still publish
  // via Re-sync). Only an Admin persists it; once one loads the page, every user
  // sees the linked date. The write flips fromBatch → true, so a matched row is
  // skipped on the next run and the effect converges after one write per date.
  useEffect(() => {
    if (!canManage) return;
    const derived = availabilityFromBatches(batches);
    for (const a of availability) {
      if (a.fromBatch) continue; // already batch-backed
      const v = derived.get(a.id);
      if (!v || (v.ross <= 0 && v.tetra <= 0)) continue; // no batch delivers on this date
      const same = v.ross === a.ross && v.tetra === a.tetra;
      void upsertAvailability({
        id: a.id, date: a.date, ross: v.ross, tetra: v.tetra,
        fromBatch: true, closed: a.closed, by: a.by ?? user!.email, on: nowISO(),
      });
      toast(
        same
          ? `Linked ${formatDate(a.date)} to its batch.`
          : `Linked ${formatDate(a.date)} to its batch — capacity now follows the batch projection (Ross ${v.ross.toLocaleString()}, Tetra ${v.tetra.toLocaleString()}).`
      );
    }
    // upsertAvailability / toast are stable enough; re-running on their identity
    // would just repeat a converged no-op. Track the real inputs only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches, availability, canManage]);

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
    setShowForm(false);
  }

  function editRow(a: Availability) {
    setErr(null);
    setDate(a.date); setRoss(String(a.ross)); setTetra(String(a.tetra));
    setShowForm(true);
  }

  // Delivery dates are never deleted from the calendar — a date is taken out of
  // ordering with Close (reversible), so orders can never be orphaned from their
  // date. Auto-published (batch-driven) dates are still cleaned up when their
  // batch goes away, but only if no active order still sits on that date.
  const hasActiveOrders = (id: string) => orders.some((o) => o.date === id && isActive(o.status));

  function toggleClose(a: Availability) {
    upsertAvailability({ ...a, closed: !a.closed, by: user!.email, on: nowISO() });
    toast(`${a.closed ? "Reopened" : "Closed"} ${formatDate(a.date)} for ordering.`);
  }

  // Publish one delivery date's availability from the (possibly updated) batch list.
  function publishDate(deliveryDate: string, list = batches) {
    const v = availabilityFromBatches(list).get(deliveryDate);
    const existing = availability.find((a) => a.id === deliveryDate);
    if (!v || (v.ross <= 0 && v.tetra <= 0)) {
      if (existing?.fromBatch && !hasActiveOrders(deliveryDate)) void removeAvailability(deliveryDate);
      return;
    }
    upsertAvailability({
      id: deliveryDate, date: deliveryDate, ross: v.ross, tetra: v.tetra,
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
      if (a.fromBatch && !derived.has(a.id) && !hasActiveOrders(a.id)) void removeAvailability(a.id);
    }
    toast(`Published ${derived.size} batch-driven date(s) to the ordering calendar.`);
  }

  function saveProjection(batchId: string) {
    const b = batches.find((x) => x.id === batchId);
    if (!b || !b.setDate) return;
    const n = Math.max(0, Math.round(Number(draft[batchId]) || 0));
    const updated = { ...b, projectedChicks: n };
    const list = batches.map((x) => (x.id === batchId ? updated : x));
    const hd = deliveryDateOf(b.setDate);
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

  // Live oversell check for the manual form: is the number being typed below
  // what's already ordered on that date?
  const rossOrderedForDate = orderedOn(date, "Ross 308");
  const tetraOrderedForDate = orderedOn(date, "Tetra Super Harco");
  const rossOversell = ross.trim() !== "" && Number(ross) < rossOrderedForDate;
  const tetraOversell = tetra.trim() !== "" && Number(tetra) < tetraOrderedForDate;

  // Donut fill: green = on-plan share, amber = watch, red = oversold.
  const gEnd = health.total ? (health.onPlan / health.total) * 100 : 0;
  const aEnd = health.total ? ((health.onPlan + health.watch) / health.total) * 100 : 0;
  const ringBg = health.total
    ? `conic-gradient(var(--color-green) 0 ${gEnd}%, var(--color-amber) ${gEnd}% ${aEnd}%, var(--color-red) ${aEnd}% 100%)`
    : "conic-gradient(var(--color-grey-bg) 0 100%)";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[0.62rem] font-extrabold uppercase tracking-[0.14em] text-gold-dark">Delivery availability</p>
          <h1 className="mt-0.5 text-2xl font-extrabold tracking-tight text-ink">Capacity at a glance</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">
            Chicks hatch <strong className="text-ink">{INCUBATION_DAYS} days</strong> after a batch is set and are delivered{" "}
            <strong className="text-ink">{DELIVERY_LAG_DAYS} days</strong> later — reaching the calendar{" "}
            <strong className="text-ink">{INCUBATION_DAYS + DELIVERY_LAG_DAYS} days</strong> after setting, at{" "}
            {ROSS_HATCH_RATE === TETRA_HATCH_RATE
              ? <><strong className="text-ink">{Math.round(ROSS_HATCH_RATE * 100)}%</strong> of eggs set</>
              : <>Ross <strong className="text-ink">{Math.round(ROSS_HATCH_RATE * 100)}%</strong> / Tetra <strong className="text-ink">{Math.round(TETRA_HATCH_RATE * 100)}%</strong> of eggs set</>}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {canManage && (
            <Button size="sm" onClick={() => { setErr(null); setDate(todayISO()); setRoss(""); setTetra(""); setShowForm(true); }}>
              Open a date
            </Button>
          )}
          {canProject && <Button size="sm" variant="ghost" onClick={syncAll}>Re-sync to calendar</Button>}
        </div>
      </div>

      {/* Overview metric tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Metric label="Upcoming Ross" value={kpi.upRoss.toLocaleString()} note="projected, not yet hatched" accent="var(--color-blue)" />
        <Metric label="Upcoming Tetra" value={kpi.upTetra.toLocaleString()} note="projected, not yet hatched" accent="var(--color-purple)" />
        <Metric label="Open dates" value={String(kpi.openCount)} accent="var(--color-gold)" />
        <Metric label="Chicks still available" value={kpi.left.toLocaleString()} accent="var(--color-green)" />
        <Metric label="Next delivery" value={kpi.next ? formatDate(kpi.next) : "—"} note={kpi.next ? daysLabel(daysUntil(kpi.next)) : undefined} accent="var(--color-amber)" />
      </div>

      {/* Attention banner */}
      {attention.length > 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-amber/40 bg-amber-bg/60 p-4 shadow-card">
          <div className="flex items-center gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-bg font-extrabold text-amber">!</span>
            <div>
              <b className="text-sm text-ink">{attention.length} date{attention.length > 1 ? "s" : ""} need attention</b>
              <p className="text-xs text-muted">Orders exceed the capacity you set — raise the cap or reschedule.</p>
            </div>
          </div>
          <Button size="sm" variant="ghost" onClick={() => document.getElementById("dates-table")?.scrollIntoView({ behavior: "smooth", block: "start" })}>Review oversold</Button>
        </div>
      ) : (
        <div className="flex items-center gap-3 rounded-2xl border border-green/25 bg-green-bg/50 p-4 shadow-card">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-bg font-extrabold text-green">✓</span>
          <div>
            <b className="text-sm text-ink">All open dates are within capacity</b>
            <p className="text-xs text-muted">No date is oversold right now.</p>
          </div>
        </div>
      )}

      {/* Upcoming production (editable batch projections) + capacity health */}
      <div className={canProject ? "grid gap-5 lg:grid-cols-[1.6fr_1fr]" : "grid gap-5"}>
        {canProject && (
          <Card>
            <h3 className="card-title">Upcoming production</h3>
            <p className="mb-3 mt-1 text-sm text-muted">
              Each set batch opens its delivery date automatically (hatch + {DELIVERY_LAG_DAYS} days). Adjust a batch&apos;s
              expected chicks — the delivery date&apos;s total updates.
            </p>
            {grouped.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No upcoming batches. Set a batch to project its chicks here.</p>
            ) : (
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
                        const adjusted = p.batch.projectedChicks != null;
                        const rate = p.eggsSet > 0 ? Math.round((current / p.eggsSet) * 100) : 0;
                        return (
                          <div key={p.batch.id} className="flex items-center gap-3 rounded-xl border border-line bg-field/50 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="truncate text-xs font-semibold text-ink">{p.batch.batchNo}</span>
                                <Pill tone={p.product === "Ross 308" ? "ross" : "tetra"}>{p.product === "Ross 308" ? "Ross" : "Tetra"}</Pill>
                              </div>
                              <div className="mt-1 flex items-center gap-2">
                                <div className="h-1.5 w-24 overflow-hidden rounded-full bg-grey-bg"><div className="h-full bg-green" style={{ width: `${Math.min(100, rate)}%` }} /></div>
                                <span className="text-[0.68rem] text-muted tabular-nums">{p.eggsSet.toLocaleString()} eggs · {adjusted ? "adj." : `${rate}%`}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <input
                                type="number" min={0}
                                className="w-20 rounded-md border border-line bg-transparent px-2 py-1 text-right text-xs tabular-nums"
                                value={val}
                                onChange={(e) => setDraft((d) => ({ ...d, [p.batch.id]: e.target.value }))}
                              />
                              <Button size="sm" variant={changed ? "primary" : "ghost"} disabled={!changed} onClick={() => saveProjection(p.batch.id)}>Save</Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        <Card>
          <h3 className="card-title">Capacity health</h3>
          <div className="mt-4 flex items-center gap-5">
            <div className="grid h-24 w-24 shrink-0 place-items-center rounded-full" style={{ background: ringBg }}>
              <div className="grid h-[4.6rem] w-[4.6rem] place-items-center rounded-full bg-paper text-center">
                <div>
                  <div className="text-xl font-extrabold leading-none tracking-tight text-ink tabular-nums">{health.score}</div>
                  <div className="text-[0.6rem] text-muted">score / 100</div>
                </div>
              </div>
            </div>
            <div className="flex-1 space-y-1.5 text-xs">
              <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-green" />On plan</span><b className="tabular-nums">{health.onPlan}</b></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber" />Watch (≥90%)</span><b className="tabular-nums">{health.watch}</b></div>
              <div className="flex items-center justify-between"><span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-red" />Oversold</span><b className="tabular-nums">{health.oversold}</b></div>
            </div>
          </div>
          <div className="mt-4 border-t border-line pt-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-ink">Chicks available ahead</span>
              <span className="text-muted">next {trend.length} date{trend.length === 1 ? "" : "s"}</span>
            </div>
            {trend.length >= 2 ? (
              <svg viewBox="0 0 300 54" preserveAspectRatio="none" className="mt-2 h-14 w-full" aria-hidden>
                <path d={`${sparkPath(trend)} L 300 54 L 0 54 Z`} fill="var(--color-green-bg)" />
                <path d={sparkPath(trend)} fill="none" stroke="var(--color-green)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <p className="mt-2 text-xs text-muted">Not enough upcoming dates to chart yet.</p>
            )}
          </div>
        </Card>
      </div>

      {canProject && hatched.length > 0 && (
        <Card>
          <CardHeader title="Projection accuracy" />
          <p className="-mt-1 mb-3 text-sm text-muted">How hatched batches compared to their projection — use it to calibrate the rate.</p>
          <div className="hidden sm:block">
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
          </div>

          {/* Mobile: each hatched batch as a card. */}
          <div className="space-y-2.5 sm:hidden">
            {hatched.slice(0, 12).map((h) => {
              const vsProj = h.projected > 0 ? Math.round((h.actual / h.projected) * 100) : 0;
              const realRate = h.batch.eggsSet > 0 ? Math.round((h.actual / h.batch.eggsSet) * 100) : 0;
              return (
                <div key={h.batch.id} className="rounded-2xl border border-line bg-paper p-3.5 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-ink">{h.batch.batchNo}</p>
                      <p className="text-xs text-muted">Hatched {formatDate(h.hatchDate)}</p>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Pill tone={h.batch.productType === "Ross 308" ? "ross" : "tetra"}>{h.batch.productType}</Pill>
                      <Pill tone={vsProj >= 100 ? "green" : vsProj >= 90 ? "amber" : "red"}>{vsProj}% vs proj</Pill>
                    </div>
                  </div>
                  <div className="mt-2.5 grid grid-cols-3 gap-x-3 gap-y-2 text-sm">
                    <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Eggs set</p><p className="font-medium tabular-nums text-ink">{h.batch.eggsSet.toLocaleString()}</p></div>
                    <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Projected</p><p className="font-medium tabular-nums text-ink">{h.projected.toLocaleString()}</p></div>
                    <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Actual</p><p className="font-medium tabular-nums text-ink">{h.actual.toLocaleString()}</p></div>
                  </div>
                  <p className="mt-1.5 text-xs text-muted">Real hatch rate <b className="text-ink">{realRate}%</b></p>
                </div>
              );
            })}
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
                {rossOversell && ` Ross: ${rossOrderedForDate.toLocaleString()} ordered vs ${Number(ross).toLocaleString()} you're setting (over by ${(rossOrderedForDate - Number(ross)).toLocaleString()}).`}
                {tetraOversell && ` Tetra: ${tetraOrderedForDate.toLocaleString()} ordered vs ${Number(tetra).toLocaleString()} you're setting (over by ${(tetraOrderedForDate - Number(tetra)).toLocaleString()}).`}
              </p>
            )}
            <div className="flex justify-end pt-1">
              <Button type="submit">Save availability</Button>
            </div>
          </form>
        </Modal>
      )}

      <Card>
        <div id="dates-table" className="mb-4 scroll-mt-24">
          <h3 className="card-title">Delivery dates · {rows.length}</h3>
        </div>
        <div className="hidden sm:block">
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
              const past = a.date < todayISO(); // a finished date is auto-closed
              return (
                <tr key={a.id} className={a.closed || past ? "opacity-55" : undefined}>
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
                    {past ? <Pill tone="neutral">Ended</Pill> : a.closed ? <Pill tone="neutral">Closed</Pill> : over ? <Pill tone="red">Oversold</Pill> : <Pill tone="green">Open</Pill>}
                  </Td>
                  {canManage && (
                    <Td>
                      {past ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          <Button size="sm" variant="ghost" onClick={() => toggleClose(a)}>{a.closed ? "Reopen" : "Close"}</Button>
                          {!a.fromBatch && (
                            <Button size="sm" variant="ghost" onClick={() => editRow(a)}>Edit</Button>
                          )}
                          {a.fromBatch && <span className="self-center text-xs text-muted">auto</span>}
                        </div>
                      )}
                    </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        </div>

        {/* Mobile: each delivery date as a card. */}
        <div className="space-y-2.5 sm:hidden">
          {rows.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted">No ordering dates opened yet.</p>
          ) : rows.map((a) => {
            const rossLeft = availableFor(a, "Ross 308", orders);
            const tetraLeft = availableFor(a, "Tetra Super Harco", orders);
            const rossOrd = orderedOn(a.id, "Ross 308");
            const tetraOrd = orderedOn(a.id, "Tetra Super Harco");
            const cap = a.ross + a.tetra;
            const ord = rossOrd + tetraOrd;
            const pct = cap > 0 ? Math.round((ord / cap) * 100) : 0;
            const over = rossOrd > a.ross || tetraOrd > a.tetra;
            const past = a.date < todayISO();
            return (
              <div key={a.id} className={"rounded-2xl border border-line bg-paper p-3.5 shadow-card " + (a.closed || past ? "opacity-60" : "")}>
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-semibold text-ink">{formatDate(a.date)}</p>
                    <div className="mt-0.5">{a.fromBatch ? <Pill tone="green">Batches</Pill> : <span className="text-xs text-muted">Manual</span>}</div>
                  </div>
                  {past ? <Pill tone="neutral">Ended</Pill> : a.closed ? <Pill tone="neutral">Closed</Pill> : over ? <Pill tone="red">Oversold</Pill> : <Pill tone="green">Open</Pill>}
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Ross (left / avail)</p>
                    {a.ross > 0 ? <p className="flex items-center gap-1.5"><Pill tone={rossLeft > 0 ? "green" : "red"}>{rossLeft.toLocaleString()}</Pill><span className="text-xs text-muted">/ {a.ross.toLocaleString()}</span></p> : <p className="text-muted">—</p>}
                  </div>
                  <div>
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Tetra (left / avail)</p>
                    {a.tetra > 0 ? <p className="flex items-center gap-1.5"><Pill tone={tetraLeft > 0 ? "green" : "red"}>{tetraLeft.toLocaleString()}</Pill><span className="text-xs text-muted">/ {a.tetra.toLocaleString()}</span></p> : <p className="text-muted">—</p>}
                  </div>
                </div>
                <div className="mt-2.5">
                  <p className="mb-1 text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Committed</p>
                  <div className="flex items-center gap-2"><FillBar pct={pct} over={over} /><span className="text-xs text-muted tabular-nums">{pct}%</span></div>
                </div>
                {canManage && !past && (
                  <div className="mt-2.5 flex flex-wrap items-center justify-end gap-2 border-t border-line pt-2.5">
                    <Button size="sm" variant="ghost" onClick={() => toggleClose(a)}>{a.closed ? "Reopen" : "Close"}</Button>
                    {!a.fromBatch && <Button size="sm" variant="ghost" onClick={() => editRow(a)}>Edit</Button>}
                    {a.fromBatch && <span className="self-center text-xs text-muted">auto</span>}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

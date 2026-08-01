"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { Card } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { GreetingHeader, StatTile, SectionTitle, SearchTimeBar } from "@/components/dashboard/DashKit";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { presetToRange, type PeriodPreset } from "@/lib/period";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { formatRWF } from "@/lib/config";
import { computeKpis, stepLabel, isMachineOverTemp } from "@/lib/hatchery/lifecycle";
import { visibleOrders } from "@/lib/permissions";
import { PRODUCTS, isFullyPaid, type Order, type User } from "@/lib/types";
import type { Batch } from "@/lib/hatchery/types";

const HATCHERY_SUBTITLE: Partial<Record<string, string>> = {
  "Hatchery Veterinary": "here's health & vaccination today",
  "Maintenance Technician": "here's machines & maintenance today",
  "Hatchery Sales & Coordination Officer": "here's sales coordination today",
  "Production Technician": "here's the production floor today",
};

/** Shared search + period filter passed to every hatchery dashboard view. */
export interface DashFilter {
  q: string;
  range: DateRangeValue;
}

/** Text match against a set of fields (empty query = match all). */
function matches(q: string, ...fields: (string | undefined)[]): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return fields.some((f) => (f ?? "").toLowerCase().includes(s));
}
/** Date-in-range test (no range set = match all). */
function inFilterRange(dateIso: string | undefined, range: DateRangeValue): boolean {
  if (!(range.from || range.to)) return true;
  return inRange((dateIso ?? "").slice(0, 10), range);
}

export default function HatcheryDashboard() {
  const { user } = useAuth();
  const { loading } = useHatchery();

  const [q, setQ] = useState("");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const range = presetToRange(preset, custom, todayISO());

  if (!user) return null;

  const role = user.role;
  const filter: DashFilter = { q, range };
  return (
    <div className="space-y-5">
      <GreetingHeader name={user.name} subtitle={HATCHERY_SUBTITLE[role] ?? "here's the hatchery today"} right={<Pill tone="gold">{role}</Pill>} />

      <SearchTimeBar q={q} setQ={setQ} placeholder="Search this dashboard…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />

      {loading ? (
        <Card><p className="text-sm text-muted">Loading hatchery data…</p></Card>
      ) : role === "Hatchery Veterinary" ? (
        <VetView filter={filter} />
      ) : role === "Maintenance Technician" ? (
        <MaintenanceView filter={filter} />
      ) : role === "Hatchery Sales & Coordination Officer" ? (
        <CoordinationView user={user} filter={filter} />
      ) : role === "Production Technician" ? (
        <TechView filter={filter} />
      ) : role === "Hatchery Operations Manager" ? (
        <ProductionView filter={filter} />
      ) : (
        <ManagerView user={user} filter={filter} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function BatchesCard({ batches, filter, title = "Batches" }: { batches: Batch[]; filter?: DashFilter; title?: string }) {
  const rows = batches
    .filter((b) => !filter || (matches(filter.q, b.batchNo, b.productType, stepLabel(b.currentStep)) && inFilterRange(b.createdAt, filter.range)))
    .slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 12);
  const tone = (s: Batch["status"]) =>
    s === "delivered" ? "fulfilled" : s === "dispatched" ? "gold" : s === "inactive" ? "neutral" : "info";
  return (
    <Card>
      <SectionTitle label={title} />
      <TableWrap>
        <thead>
          <tr>
            <Th>Batch</Th><Th>Product</Th><Th>Step</Th>
            <Th className="text-right">Eggs set</Th><Th className="text-right">Hatched</Th>
            <Th className="text-right">Saleable</Th><Th>Status</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <EmptyRow colSpan={7} text="No batches yet." />
          ) : rows.map((b) => (
            <tr key={b.id}>
              <Td><Link href={`/hatchery/batches/${b.id}`} className="text-gold-dark underline underline-offset-2">{b.batchNo}</Link></Td>
              <Td>{b.productType}</Td>
              <Td>{stepLabel(b.currentStep)}</Td>
              <Td className="text-right">{b.eggsSet.toLocaleString()}</Td>
              <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
              <Td className="text-right">{b.saleableCount.toLocaleString()}</Td>
              <Td><Pill tone={tone(b.status)}>{b.status}</Pill></Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );
}

function OverTempCard() {
  const { readings } = useHatchery();
  const alerts = useMemo(
    () => readings.filter((r) => isMachineOverTemp(r.dryF, r.wetF, r.digitalTempF)).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 6),
    [readings]
  );
  if (alerts.length === 0) return null;
  return (
    <Card>
      <SectionTitle label="Recent over-temperature readings" />
      <div className="space-y-1.5 text-sm">
        {alerts.map((r) => (
          <div key={r.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-red/30 bg-red-bg px-3 py-2">
            <span>{r.machineCode} · {r.operator}</span>
            <span className="text-red">dry {r.dryF}°F · wet {r.wetF}°F · digital {r.digitalTempF}°F · {formatDateTime(r.timestamp)}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

const awaitingVaccination = (b: Batch) => !!b.steps["counting"] && !b.vaccinated;
const inPipeline = (b: Batch) => !!b.steps["setting"] && !b.steps["hatching"] && b.status === "active";

function payState(o: Order): { label: string; tone: "green" | "gold" | "red" | "info" } {
  if (isFullyPaid(o)) return { label: "Paid", tone: "green" };
  if (o.debtOk) return { label: "On debt", tone: "info" };
  if (o.payments.some((p) => p.amt > 0)) return { label: "Partial", tone: "gold" };
  return { label: "Unpaid", tone: "red" };
}
const ordersToDeliver = (orders: Order[], user: User) =>
  visibleOrders(orders, user).filter((o) => o.confirmedOk && o.status !== "refunded" && o.status !== "rejected" && !o.deliverOk);

// ---------------------------------------------------------------------------
// Manager (Admin / Hatchery Manager / Operations Manager) — full overview
// ---------------------------------------------------------------------------

function ManagerView({ user, filter }: { user: User; filter: DashFilter }) {
  const { batches, inventory, maintenance, allocations, dispatches, supplies, spareParts, spareRequests, machines } = useHatchery();
  const activeMachines = machines.filter((m) => m.active).length;
  const { orders } = useData();
  const kpis = useMemo(() => computeKpis(batches, inventory), [batches, inventory]);
  const downtime = maintenance.reduce((s, m) => s + (m.downtimeHours ?? 0), 0);
  const pendingAlloc = allocations.filter((a) => a.status === "proposed" || a.status === "finalized").length;
  const inTransit = dispatches.filter((d) => !d.deliveredAt).length;
  const toDeliver = ordersToDeliver(orders, user);
  const demand = toDeliver.reduce((s, o) => s + o.chicks, 0);
  const lowStock = supplies.filter((s) => s.quantity <= 0).length + spareParts.filter((p) => p.quantity <= 0).length;
  const pendingParts = spareRequests.filter((r) => r.status === "pending").length;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <StatTile label="Active batches" value={String(kpis.activeBatches)} />
        <StatTile label="Eggs set" value={kpis.eggsSet.toLocaleString()} />
        <StatTile label="Chicks hatched" value={kpis.chicksHatched.toLocaleString()} tone="green" />
        <StatTile label="Hatchability" value={`${kpis.hatchability.toFixed(0)}%`} tone="gold" />
        <StatTile label="Available chicks" value={kpis.saleableAvailable.toLocaleString()} tone="green" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Chicks to deliver" value={demand.toLocaleString()} tone={demand ? "gold" : "default"} />
        <StatTile label="Orders awaiting" value={String(toDeliver.length)} />
        <StatTile label="Pending allocations" value={String(pendingAlloc)} tone={pendingAlloc ? "gold" : "default"} />
        <StatTile label="In transit" value={String(inTransit)} />
        <StatTile label="Downtime (h)" value={downtime.toFixed(1)} tone={downtime > 0 ? "red" : "default"} />
        <StatTile label="Low / pending parts" value={`${lowStock} / ${pendingParts}`} tone={lowStock || pendingParts ? "gold" : "default"} />
        <StatTile label="Active machines" value={String(activeMachines)} />
      </div>
      <OverTempCard />
      <BatchesCard batches={batches} filter={filter} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Hatchery Operations Manager — production overview
// ---------------------------------------------------------------------------

function ProductionView({ filter }: { filter: DashFilter }) {
  const { batches, inventory, machines, machineIssues, maintenance, spareParts, spareRequests } = useHatchery();
  const kpis = useMemo(() => computeKpis(batches, inventory), [batches, inventory]);
  const activeMachines = machines.filter((m) => m.active).length;

  // Where every active batch sits in the reception → set → candle → hatch →
  // count/box → vaccinate flow, so the ops manager sees what the floor owes today.
  const stages = useMemo(() => {
    const active = batches.filter((b) => b.status === "active");
    return {
      toSet: active.filter((b) => !b.steps["setting"]).length,
      toCandle: batches.filter(inPipeline).length,
      inHatchers: batches.filter((b) => b.steps["transfer"] && !b.steps["hatching"]).length,
      toCount: batches.filter((b) => b.steps["hatching"] && !b.steps["counting"]).length,
      toVaccinate: batches.filter(awaitingVaccination).length,
    };
  }, [batches]);

  const openIssues = machineIssues.filter((i) => i.status === "open").length;
  const downtime = maintenance.reduce((s, m) => s + (m.downtimeHours ?? 0), 0);
  const outParts = spareParts.filter((p) => p.quantity <= 0).length;
  const pendingSpares = spareRequests.filter((r) => r.status === "pending").length;

  const openIssueRows = useMemo(
    () => machineIssues
      .filter((i) => i.status === "open" && matches(filter.q, i.machineCode, i.description))
      .sort((a, b) => (a.on < b.on ? 1 : -1)),
    [machineIssues, filter]
  );
  const recentMaint = useMemo(
    () => maintenance
      .filter((m) => matches(filter.q, m.area, m.kind, m.notes) && inFilterRange(m.on, filter.range))
      .slice().sort((a, b) => (a.on < b.on ? 1 : -1)).slice(0, 8),
    [maintenance, filter]
  );

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <StatTile label="Active batches" value={String(kpis.activeBatches)} />
        <StatTile label="Eggs set" value={kpis.eggsSet.toLocaleString()} />
        <StatTile label="Chicks hatched" value={kpis.chicksHatched.toLocaleString()} tone="green" />
        <StatTile label="Hatchability" value={`${kpis.hatchability.toFixed(0)}%`} tone="gold" />
        <StatTile label="Available chicks" value={kpis.saleableAvailable.toLocaleString()} tone="green" />
        <StatTile label="Active machines" value={String(activeMachines)} />
      </div>

      <Card>
        <SectionTitle label="Today's production pipeline" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
          <StatTile label="To set" value={String(stages.toSet)} tone={stages.toSet ? "gold" : "default"} />
          <StatTile label="Incubating / to candle" value={String(stages.toCandle)} />
          <StatTile label="In hatchers" value={String(stages.inHatchers)} />
          <StatTile label="To count & box" value={String(stages.toCount)} tone={stages.toCount ? "gold" : "default"} />
          <StatTile label="Awaiting vaccination" value={String(stages.toVaccinate)} tone={stages.toVaccinate ? "gold" : "default"} />
        </div>
      </Card>

      <Card>
        <SectionTitle label="Needs attention" />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Open machine issues" value={String(openIssues)} tone={openIssues ? "red" : "green"} />
          <StatTile label="Maintenance downtime (h)" value={downtime.toLocaleString()} tone={downtime ? "gold" : "default"} />
          <StatTile label="Spare parts out of stock" value={String(outParts)} tone={outParts ? "red" : "green"} />
          <StatTile label="Spare requests pending" value={String(pendingSpares)} tone={pendingSpares ? "gold" : "default"} />
        </div>
      </Card>

      {openIssueRows.length > 0 && (
        <Card>
          <SectionTitle label={`Open machine issues (${openIssueRows.length})`} />
          <TableWrap>
            <thead><tr><Th>Machine</Th><Th>Severity</Th><Th>Issue</Th><Th>Reported</Th></tr></thead>
            <tbody>
              {openIssueRows.map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.machineCode}</Td>
                  <Td><Pill tone={i.severity === "high" ? "red" : i.severity === "medium" ? "gold" : "neutral"}>{i.severity}</Pill></Td>
                  <Td className="text-sm">{i.description}</Td>
                  <Td className="text-xs text-muted">{i.reporterName ?? i.reportedBy} · {formatDateTime(i.on)}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      <Card>
        <SectionTitle label="Recent maintenance" />
        <TableWrap>
          <thead><tr><Th>When</Th><Th>Area</Th><Th>Note</Th><Th className="text-right">Downtime (h)</Th></tr></thead>
          <tbody>
            {recentMaint.length === 0 ? <EmptyRow colSpan={4} text="No maintenance logged." /> : recentMaint.map((m) => (
              <tr key={m.id}>
                <Td className="text-xs text-muted">{formatDate(m.on.slice(0, 10))}</Td>
                <Td>{m.area ?? m.kind}</Td>
                <Td className="text-sm">{m.notes}</Td>
                <Td className="text-right">{(m.downtimeHours ?? 0).toFixed(1)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <OverTempCard />
      <BatchesCard batches={batches} filter={filter} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Production Technician — production tasks
// ---------------------------------------------------------------------------

function TechView({ filter }: { filter: DashFilter }) {
  const { batches, machines } = useHatchery();
  const toCandle = batches.filter(inPipeline);
  const inHatchers = batches.filter((b) => b.steps["transfer"] && !b.steps["hatching"]);
  const activeMachines = machines.filter((m) => m.active).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Batches to candle" value={String(toCandle.length)} tone={toCandle.length ? "gold" : "default"} />
        <StatTile label="In hatchers" value={String(inHatchers.length)} />
        <StatTile label="Active batches" value={String(batches.filter((b) => b.status === "active").length)} />
        <StatTile label="Active machines" value={String(activeMachines)} />
      </div>
      <OverTempCard />
      <BatchesCard batches={batches.filter((b) => b.status === "active")} filter={filter} title="Active pipeline" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Hatchery Veterinary — health / vaccination
// ---------------------------------------------------------------------------

function VetView({ filter }: { filter: DashFilter }) {
  const { batches, vaccineRequests, farmVisits, biosecurity } = useHatchery();
  const toVax = batches
    .filter(awaitingVaccination)
    .filter((b) => matches(filter.q, b.batchNo, b.productType) && inFilterRange(b.createdAt, filter.range));
  const pendingReq = vaccineRequests
    .filter((r) => r.status === "requested" || r.status === "confirmed")
    .filter((r) => matches(filter.q, r.vaccine, r.status));
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatTile label="Batches to vaccinate" value={String(toVax.length)} tone={toVax.length ? "gold" : "default"} />
        <StatTile label="Pending vaccine requests" value={String(pendingReq.length)} tone={pendingReq.length ? "gold" : "default"} />
        <StatTile label="Farm visits logged" value={String(farmVisits.length)} />
        <StatTile label="Biosecurity logs" value={String(biosecurity.length)} />
      </div>

      <Card>
        <SectionTitle label={`Batches awaiting vaccination (${toVax.length})`} />
        <TableWrap>
          <thead><tr><Th>Batch</Th><Th>Product</Th><Th className="text-right">Counted</Th><Th className="text-right">Culls</Th></tr></thead>
          <tbody>
            {toVax.length === 0 ? <EmptyRow colSpan={4} text="Nothing awaiting vaccination." /> : toVax.map((b) => (
              <tr key={b.id}>
                <Td><Link href={`/hatchery/batches/${b.id}`} className="text-gold-dark underline underline-offset-2">{b.batchNo}</Link></Td>
                <Td>{b.productType}</Td>
                <Td className="text-right">{b.countedTotal.toLocaleString()}</Td>
                <Td className="text-right">{b.culls.toLocaleString()}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <SectionTitle label={`Vaccine requests to act on (${pendingReq.length})`} />
        <TableWrap>
          <thead><tr><Th>Vaccine</Th><Th className="text-right">Qty</Th><Th>Status</Th></tr></thead>
          <tbody>
            {pendingReq.length === 0 ? <EmptyRow colSpan={3} text="No pending requests." /> : pendingReq.map((r) => (
              <tr key={r.id}>
                <Td>{r.vaccine}</Td>
                <Td className="text-right">{r.quantity.toLocaleString()} {r.unit}</Td>
                <Td><Pill tone={r.status === "confirmed" ? "gold" : "info"}>{r.status}</Pill></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Maintenance Technician — machines & spare parts
// ---------------------------------------------------------------------------

function MaintenanceView({ filter }: { filter: DashFilter }) {
  const { readings, maintenance, machines, spareParts, spareRequests } = useHatchery();
  const alerts = readings.filter((r) => isMachineOverTemp(r.dryF, r.wetF, r.digitalTempF)).length;
  const downtime = maintenance.reduce((s, m) => s + (m.downtimeHours ?? 0), 0);
  const lowParts = spareParts.filter((p) => p.quantity <= 0).filter((p) => matches(filter.q, p.name, p.location));
  const pendingReq = spareRequests.filter((r) => r.status === "pending");
  const recentMaint = maintenance
    .filter((m) => matches(filter.q, m.area, m.kind, m.notes) && inFilterRange(m.on, filter.range))
    .slice().sort((a, b) => (a.on < b.on ? 1 : -1)).slice(0, 8);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatTile label="Over-temp readings" value={String(alerts)} tone={alerts ? "red" : "default"} />
        <StatTile label="Downtime (h)" value={downtime.toFixed(1)} tone={downtime > 0 ? "red" : "default"} />
        <StatTile label="Machines" value={String(machines.length)} />
        <StatTile label="Parts out of stock" value={String(lowParts.length)} tone={lowParts.length ? "gold" : "default"} />
        <StatTile label="Part requests" value={String(pendingReq.length)} tone={pendingReq.length ? "gold" : "default"} />
      </div>
      <OverTempCard />

      <Card>
        <SectionTitle label="Spare parts needing attention" />
        <TableWrap>
          <thead><tr><Th>Part</Th><Th>Location</Th><Th className="text-right">In stock</Th></tr></thead>
          <tbody>
            {lowParts.length === 0 ? <EmptyRow colSpan={3} text="All spare parts in stock." /> : lowParts.map((p) => (
              <tr key={p.id}><Td className="font-medium">{p.name}</Td><Td className="text-muted">{p.location ?? "—"}</Td><Td className="text-right"><Pill tone="gold">out</Pill></Td></tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <SectionTitle label="Recent maintenance" />
        <TableWrap>
          <thead><tr><Th>When</Th><Th>Area</Th><Th>Note</Th><Th className="text-right">Downtime (h)</Th></tr></thead>
          <tbody>
            {recentMaint.length === 0 ? <EmptyRow colSpan={4} text="No maintenance logged." /> : recentMaint.map((m) => (
              <tr key={m.id}>
                <Td className="text-xs text-muted">{formatDate(m.on.slice(0, 10))}</Td>
                <Td>{m.area ?? m.kind}</Td>
                <Td className="text-sm">{m.notes}</Td>
                <Td className="text-right">{(m.downtimeHours ?? 0).toFixed(1)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Hatchery Sales & Coordination Officer — sales coordination
// ---------------------------------------------------------------------------

const COORD_COLORS = { delivered: "#3f9142", ready: "#3b82f6", allocate: "#e0a92e", waiting: "#d9534f" };

function addDaysISO(iso: string, n: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}
function sameMonth(iso: string | undefined, ref: string): boolean {
  return !!iso && iso.slice(0, 7) === ref.slice(0, 7);
}
function weekDays(today: string): { date: string; label: string; sub: string }[] {
  const d = new Date(today + "T00:00:00");
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday);
    day.setDate(monday.getDate() + i);
    return { date: day.toISOString().slice(0, 10), label: names[i], sub: `${day.getDate()} ${day.toLocaleString("en", { month: "short" })}` };
  });
}
function ago(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

function Donut({ segments, total }: { segments: { value: number; color: string }[]; total: number }) {
  const size = 150, stroke = 20, r = (size - stroke) / 2, C = 2 * Math.PI * r;
  const arcs = segments.reduce<{ list: { len: number; start: number; color: string }[]; acc: number }>(
    (state, s) => {
      const len = total > 0 ? (s.value / total) * C : 0;
      return { list: [...state.list, { len, start: state.acc, color: s.color }], acc: state.acc + len };
    },
    { list: [], acc: 0 }
  ).list;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
      <g transform={`rotate(-90 ${size / 2} ${size / 2})`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#ece7db" strokeWidth={stroke} />
        {arcs.map((a, i) => (
          <circle key={i} cx={size / 2} cy={size / 2} r={r} fill="none" stroke={a.color} strokeWidth={stroke} strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-a.start} />
        ))}
      </g>
      <text x="50%" y="46%" textAnchor="middle" dominantBaseline="middle" className="fill-ink" fontSize="22" fontWeight="700">{total}</text>
      <text x="50%" y="60%" textAnchor="middle" dominantBaseline="middle" className="fill-muted" fontSize="10">Orders</text>
    </svg>
  );
}

function AttnRow({ tone, title, detail, count }: { tone: "red" | "gold" | "info"; title: string; detail: string; count: number }) {
  return (
    <Link href="/hatchery/coordination" className="flex items-center gap-3 rounded-lg border border-line px-3 py-2.5 hover:border-gold">
      <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold ${tone === "red" ? "bg-red-bg text-red" : tone === "info" ? "bg-blue-bg text-blue" : "bg-gold-bg text-gold-dark"}`}>!</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="truncate text-xs text-muted">{detail}</p>
      </div>
      <span className="text-xs font-semibold text-muted">{count} orders ›</span>
    </Link>
  );
}

function ProdAllocBar({ product, reserved, remaining }: { product: string; reserved: number; remaining: number }) {
  const total = reserved + remaining;
  const pct = total > 0 ? Math.round((reserved / total) * 100) : 0;
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-ink">{product}</p>
      <div className="grid grid-cols-3 gap-1 text-xs text-muted">
        <span>Available <strong className="text-ink">{total.toLocaleString()}</strong></span>
        <span>Reserved <strong className="text-ink">{reserved.toLocaleString()}</strong></span>
        <span>Remaining <strong className="text-ink">{remaining.toLocaleString()}</strong></span>
      </div>
      <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-0.5 text-right text-[11px] text-muted">{pct}% reserved</p>
    </div>
  );
}

function CoordinationView({ user, filter }: { user: User; filter: DashFilter }) {
  const { inventory, allocations, farmVisits } = useHatchery();
  const { orders, notifications } = useData();
  const today = todayISO();

  const active = useMemo(
    () => visibleOrders(orders, user).filter((o) => o.status !== "refunded" && o.status !== "rejected"),
    [orders, user]
  );
  const awaiting = useMemo(() => active.filter((o) => o.confirmedOk && !o.deliverOk), [active]);

  const chicksBy = (p: string) => awaiting.filter((o) => o.product === p).reduce((s, o) => s + o.chicks, 0);
  const reservedBy = (p: string) => allocations.filter((a) => a.status !== "cancelled" && a.productType === p).reduce((s, a) => s + a.quantity, 0);
  const invBy = (p: string) => inventory.filter((i) => i.productType === p).reduce((s, i) => s + i.availableCount, 0);
  const chicksInInv = inventory.reduce((s, i) => s + i.availableCount, 0);
  const revenueMonth = active.flatMap((o) => o.payments).filter((p) => p.verified && !p.voided && sameMonth(p.verifiedOn ?? p.on, today)).reduce((s, p) => s + p.amt, 0);

  const noAlloc = active.filter((o) => o.confirmedOk && !o.allocatedOk && !o.deliverOk);
  const awaitPay = active.filter((o) => !o.confirmedOk && !o.deliverOk);
  const dueToday = awaiting.filter((o) => o.date === today);

  const week = weekDays(today);
  const weekData = week.map((d) => ({ ...d, chicks: awaiting.filter((o) => o.date === d.date).reduce((s, o) => s + o.chicks, 0) }));
  const weekTotal = weekData.reduce((s, d) => s + d.chicks, 0);
  const weekMax = Math.max(1, ...weekData.map((d) => d.chicks));

  const status = {
    delivered: active.filter((o) => o.deliverOk).length,
    ready: active.filter((o) => o.allocatedOk && !o.deliverOk).length,
    allocate: active.filter((o) => o.confirmedOk && !o.allocatedOk && !o.deliverOk).length,
    waiting: active.filter((o) => !o.confirmedOk).length,
  };
  const totalOrders = active.length;
  const pctOf = (n: number) => (totalOrders ? Math.round((n / totalOrders) * 100) : 0);

  const recent = useMemo(
    () => active.filter((o) => matches(filter.q, o.name, o.product)).slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 5),
    [active, filter.q]
  );
  const visits = farmVisits.slice().sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 4);
  const notifs = notifications.slice(0, 4);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Today's deliveries" value={String(dueToday.length)} />
        <StatTile label="Tomorrow's deliveries" value={String(awaiting.filter((o) => o.date === addDaysISO(today, 1)).length)} />
        <StatTile label="Awaiting payment" value={String(awaitPay.length)} tone={awaitPay.length ? "gold" : "default"} />
        <StatTile label="Ready for allocation" value={String(noAlloc.length)} tone={noAlloc.length ? "gold" : "default"} />
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Ross 308 to deliver" value={chicksBy("Ross 308").toLocaleString()} tone="gold" />
        <StatTile label="Tetra Super Harco to deliver" value={chicksBy("Tetra Super Harco").toLocaleString()} tone="gold" />
        <StatTile label="Chicks in inventory" value={chicksInInv.toLocaleString()} tone={chicksInInv ? "green" : "default"} />
        <StatTile label="Revenue (this month)" value={formatRWF(revenueMonth)} tone="green" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle label={`Delivery calendar — this week (${weekTotal.toLocaleString()} chicks)`} />
          <div className="flex h-44 items-end gap-2 pt-2">
            {weekData.map((d) => (
              <div key={d.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                <span className="text-[10px] text-muted">{d.chicks ? d.chicks.toLocaleString() : ""}</span>
                <div className="w-full rounded-t bg-gold" style={{ height: `${(d.chicks / weekMax) * 100}%`, minHeight: d.chicks ? 3 : 0 }} title={`${d.chicks} chicks`} />
                <span className="text-[10px] font-medium text-ink">{d.label}</span>
                <span className="text-[9px] text-muted">{d.sub}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle label="Orders requiring attention" action={<Link href="/hatchery/coordination" className="text-xs font-semibold text-gold-dark">View all →</Link>} />
          <div className="space-y-2">
            {awaitPay.length === 0 && noAlloc.length === 0 && dueToday.length === 0 ? (
              <p className="text-sm text-muted">Nothing needs attention right now.</p>
            ) : (
              <>
                {awaitPay.length > 0 && <AttnRow tone="red" title="Awaiting payment" detail={`e.g. ${awaitPay[0].name} · ${awaitPay[0].product}`} count={awaitPay.length} />}
                {noAlloc.length > 0 && <AttnRow tone="gold" title="No batch allocated" detail={`e.g. ${noAlloc[0].name} · ${noAlloc[0].product}`} count={noAlloc.length} />}
                {dueToday.length > 0 && <AttnRow tone="info" title="Delivery today" detail="Scheduled for delivery today" count={dueToday.length} />}
              </>
            )}
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle label="Production allocation" />
          <div className="space-y-4">
            {PRODUCTS.map((p) => <ProdAllocBar key={p} product={p} reserved={reservedBy(p)} remaining={invBy(p)} />)}
          </div>
        </Card>

        <Card>
          <SectionTitle label="Delivery status" />
          <div className="flex items-center gap-5">
            <Donut total={totalOrders} segments={[
              { value: status.delivered, color: COORD_COLORS.delivered },
              { value: status.ready, color: COORD_COLORS.ready },
              { value: status.allocate, color: COORD_COLORS.allocate },
              { value: status.waiting, color: COORD_COLORS.waiting },
            ]} />
            <div className="space-y-1.5 text-sm">
              <Legend color={COORD_COLORS.delivered} label="Delivered" value={status.delivered} pct={pctOf(status.delivered)} />
              <Legend color={COORD_COLORS.ready} label="Ready for delivery" value={status.ready} pct={pctOf(status.ready)} />
              <Legend color={COORD_COLORS.allocate} label="To allocate" value={status.allocate} pct={pctOf(status.allocate)} />
              <Legend color={COORD_COLORS.waiting} label="Awaiting payment" value={status.waiting} pct={pctOf(status.waiting)} />
            </div>
          </div>
        </Card>
      </div>

      <Card>
        <SectionTitle label="Recent orders" action={<Link href="/hatchery/coordination" className="text-xs font-semibold text-gold-dark">View all →</Link>} />
        <TableWrap>
          <thead>
            <tr><Th>Customer</Th><Th>Product</Th><Th className="text-right">Chicks</Th><Th>Delivery date</Th><Th>Payment</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {recent.length === 0 ? <EmptyRow colSpan={6} text="No orders." /> : recent.map((o) => {
              const ps = payState(o);
              const st = o.deliverOk ? "Delivered" : o.allocatedOk ? "Ready" : o.confirmedOk ? "To allocate" : "Awaiting payment";
              const tone = o.deliverOk ? "green" : o.allocatedOk ? "info" : o.confirmedOk ? "gold" : "neutral";
              return (
                <tr key={o.id}>
                  <Td className="font-medium">{o.name}</Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                  <Td>{formatDate(o.date)}</Td>
                  <Td><Pill tone={ps.tone}>{ps.label}</Pill></Td>
                  <Td><Pill tone={tone}>{st}</Pill></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle label="Recent farm visits" action={<Link href="/hatchery/farm-visits" className="text-xs font-semibold text-gold-dark">View all →</Link>} />
          <div className="space-y-1.5 text-sm">
            {visits.length === 0 ? <p className="text-muted">No farm visits logged.</p> : visits.map((v) => (
              <div key={v.id} className="flex items-center justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                <span className="truncate"><strong className="text-ink">{v.customerName}</strong> <span className="text-muted">· {v.product}</span></span>
                <Pill tone={v.sentToSales ? "green" : "gold"}>{v.sentToSales ? "Sent to sales" : "Pending"}</Pill>
              </div>
            ))}
          </div>
        </Card>

        <Card>
          <SectionTitle label="Notifications" />
          <div className="space-y-1.5 text-sm">
            {notifs.length === 0 ? <p className="text-muted">No notifications.</p> : notifs.map((n) => (
              <div key={n.id} className="flex items-start justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                <span className="min-w-0"><span className="text-ink">{n.title}</span> <span className="text-muted">— {n.body}</span></span>
                <span className="shrink-0 text-xs text-muted">{ago(n.createdAt)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </>
  );
}

function Legend({ color, label, value, pct }: { color: string; label: string; value: number; pct: number }) {
  return (
    <div className="flex items-center gap-2">
      <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
      <span className="text-ink">{label}</span>
      <span className="text-muted">{value} ({pct}%)</span>
    </div>
  );
}

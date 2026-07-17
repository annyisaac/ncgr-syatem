"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Kpi } from "@/components/dashboard/Kpi";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { formatDate, formatDateTime } from "@/lib/format";
import { computeKpis, stepLabel, isMachineOverTemp } from "@/lib/hatchery/lifecycle";
import { visibleOrders } from "@/lib/permissions";
import { PRODUCTS, balance, isFullyPaid, type Order, type User } from "@/lib/types";
import type { Batch } from "@/lib/hatchery/types";

export default function HatcheryDashboard() {
  const { user } = useAuth();
  const { loading } = useHatchery();
  if (!user) return null;

  const role = user.role;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Hatchery</h1>
        <Pill tone="gold">{role}</Pill>
      </div>

      {loading ? (
        <Card><p className="text-sm text-muted">Loading hatchery data…</p></Card>
      ) : role === "Hatchery Veterinary" ? (
        <VetView />
      ) : role === "Maintenance Technician" ? (
        <MaintenanceView />
      ) : role === "Hatchery Sales & Coordination Officer" ? (
        <CoordinationView user={user} />
      ) : role === "Production Technician" ? (
        <TechView />
      ) : role === "Hatchery Operations Manager" ? (
        <ProductionView />
      ) : (
        <ManagerView user={user} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared pieces
// ---------------------------------------------------------------------------

function BatchesCard({ batches, title = "Batches" }: { batches: Batch[]; title?: string }) {
  const rows = batches.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 12);
  const tone = (s: Batch["status"]) =>
    s === "delivered" ? "fulfilled" : s === "dispatched" ? "gold" : s === "inactive" ? "neutral" : "info";
  return (
    <Card>
      <CardHeader title={title} />
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
      <CardHeader title="Recent over-temperature readings" />
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

function ManagerView({ user }: { user: User }) {
  const { batches, inventory, maintenance, allocations, dispatches, supplies, spareParts, spareRequests } = useHatchery();
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
        <Kpi label="Active batches" value={String(kpis.activeBatches)} />
        <Kpi label="Eggs set" value={kpis.eggsSet.toLocaleString()} />
        <Kpi label="Chicks hatched" value={kpis.chicksHatched.toLocaleString()} tone="green" />
        <Kpi label="Hatchability" value={`${kpis.hatchability.toFixed(0)}%`} tone="gold" />
        <Kpi label="Available chicks" value={kpis.saleableAvailable.toLocaleString()} tone="green" />
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi label="Chicks to deliver" value={demand.toLocaleString()} tone={demand ? "gold" : "default"} />
        <Kpi label="Orders awaiting" value={String(toDeliver.length)} />
        <Kpi label="Pending allocations" value={String(pendingAlloc)} tone={pendingAlloc ? "gold" : "default"} />
        <Kpi label="In transit" value={String(inTransit)} />
        <Kpi label="Downtime (h)" value={downtime.toFixed(1)} tone={downtime > 0 ? "red" : "default"} />
        <Kpi label="Low / pending parts" value={`${lowStock} / ${pendingParts}`} tone={lowStock || pendingParts ? "gold" : "default"} />
      </div>
      <OverTempCard />
      <BatchesCard batches={batches} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Hatchery Operations Manager — production overview
// ---------------------------------------------------------------------------

function ProductionView() {
  const { batches, inventory } = useHatchery();
  const kpis = useMemo(() => computeKpis(batches, inventory), [batches, inventory]);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
        <Kpi label="Active batches" value={String(kpis.activeBatches)} />
        <Kpi label="Eggs set" value={kpis.eggsSet.toLocaleString()} />
        <Kpi label="Chicks hatched" value={kpis.chicksHatched.toLocaleString()} tone="green" />
        <Kpi label="Hatchability" value={`${kpis.hatchability.toFixed(0)}%`} tone="gold" />
        <Kpi label="Available chicks" value={kpis.saleableAvailable.toLocaleString()} tone="green" />
      </div>
      <OverTempCard />
      <BatchesCard batches={batches} />
    </>
  );
}

// ---------------------------------------------------------------------------
// Production Technician — production tasks
// ---------------------------------------------------------------------------

function TechView() {
  const { batches, counts } = useHatchery();
  const toCandle = batches.filter(inPipeline);
  const inHatchers = batches.filter((b) => b.steps["transfer"] && !b.steps["hatching"]);
  const toVerify = counts.filter((c) => !c.verified).length;
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Batches to candle" value={String(toCandle.length)} tone={toCandle.length ? "gold" : "default"} />
        <Kpi label="In hatchers" value={String(inHatchers.length)} />
        <Kpi label="Counts to verify" value={String(toVerify)} tone={toVerify ? "gold" : "default"} />
        <Kpi label="Active batches" value={String(batches.filter((b) => b.status === "active").length)} />
      </div>
      <OverTempCard />
      <BatchesCard batches={batches.filter((b) => b.status === "active")} title="Active pipeline" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Hatchery Veterinary — health / vaccination
// ---------------------------------------------------------------------------

function VetView() {
  const { batches, vaccineRequests, farmVisits, biosecurity } = useHatchery();
  const toVax = batches.filter(awaitingVaccination);
  const pendingReq = vaccineRequests.filter((r) => r.status === "requested" || r.status === "confirmed");
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Batches to vaccinate" value={String(toVax.length)} tone={toVax.length ? "gold" : "default"} />
        <Kpi label="Pending vaccine requests" value={String(pendingReq.length)} tone={pendingReq.length ? "gold" : "default"} />
        <Kpi label="Farm visits logged" value={String(farmVisits.length)} />
        <Kpi label="Biosecurity logs" value={String(biosecurity.length)} />
      </div>

      <Card>
        <CardHeader title={`Batches awaiting vaccination (${toVax.length})`} />
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
        <CardHeader title={`Vaccine requests to act on (${pendingReq.length})`} />
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

function MaintenanceView() {
  const { readings, maintenance, machines, spareParts, spareRequests } = useHatchery();
  const alerts = readings.filter((r) => isMachineOverTemp(r.dryF, r.wetF, r.digitalTempF)).length;
  const downtime = maintenance.reduce((s, m) => s + (m.downtimeHours ?? 0), 0);
  const lowParts = spareParts.filter((p) => p.quantity <= 0);
  const pendingReq = spareRequests.filter((r) => r.status === "pending");
  const recentMaint = maintenance.slice().sort((a, b) => (a.on < b.on ? 1 : -1)).slice(0, 8);
  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Over-temp readings" value={String(alerts)} tone={alerts ? "red" : "default"} />
        <Kpi label="Downtime (h)" value={downtime.toFixed(1)} tone={downtime > 0 ? "red" : "default"} />
        <Kpi label="Machines" value={String(machines.length)} />
        <Kpi label="Parts out of stock" value={String(lowParts.length)} tone={lowParts.length ? "gold" : "default"} />
        <Kpi label="Part requests" value={String(pendingReq.length)} tone={pendingReq.length ? "gold" : "default"} />
      </div>
      <OverTempCard />

      <Card>
        <CardHeader title="Spare parts needing attention" />
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
        <CardHeader title="Recent maintenance" />
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

function CoordinationView({ user }: { user: User }) {
  const { inventory, allocations, dispatches } = useHatchery();
  const { orders } = useData();
  const toDeliver = useMemo(
    () => ordersToDeliver(orders, user).slice().sort((a, b) => (a.date === b.date ? a.plan - b.plan : a.date < b.date ? -1 : 1)),
    [orders, user]
  );
  const availBy = (p: string) => inventory.filter((i) => i.productType === p && i.availableCount > 0).reduce((s, i) => s + i.availableCount, 0);
  const totalAvail = inventory.reduce((s, i) => s + i.availableCount, 0);
  const pendingAlloc = allocations.filter((a) => a.status === "proposed" || a.status === "finalized").length;
  const inTransit = dispatches.filter((d) => !d.deliveredAt).length;

  return (
    <>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Kpi label="Chicks available" value={totalAvail.toLocaleString()} tone="green" />
        {PRODUCTS.map((p) => <Kpi key={p} label={`${p} available`} value={availBy(p).toLocaleString()} />)}
        <Kpi label="Pending allocations" value={String(pendingAlloc)} tone={pendingAlloc ? "gold" : "default"} />
        <Kpi label="In transit" value={String(inTransit)} />
      </div>

      <Card>
        <CardHeader title={`Chicks to deliver — delivery plan (${toDeliver.length})`} />
        <TableWrap>
          <thead>
            <tr><Th>Delivery date</Th><Th>Client</Th><Th>Product</Th><Th className="text-right">Chicks</Th><Th>Payment</Th><Th className="text-right">Balance</Th></tr>
          </thead>
          <tbody>
            {toDeliver.length === 0 ? <EmptyRow colSpan={6} text="Nothing awaiting delivery." /> : toDeliver.map((o) => {
              const ps = payState(o);
              const bal = balance(o);
              return (
                <tr key={o.id}>
                  <Td>{formatDate(o.date)}</Td>
                  <Td>{o.name}</Td>
                  <Td>{o.product}</Td>
                  <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                  <Td><Pill tone={ps.tone}>{ps.label}</Pill></Td>
                  <Td className="text-right">{bal > 0 ? `${bal.toLocaleString()} RWF` : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted"><Link href="/hatchery/coordination" className="text-gold-dark underline">Open Coordination →</Link> to allocate and dispatch.</p>
      </Card>
    </>
  );
}

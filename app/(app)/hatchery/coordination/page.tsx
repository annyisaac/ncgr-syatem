"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { ActionsDropdown, type DropdownAction } from "@/components/ui/Dropdown";
import { cn } from "@/lib/cn";

import { visibleOrders } from "@/lib/permissions";
import { smartMatch } from "@/lib/search";
import { formatRWF } from "@/lib/config";
import { nowISO, todayISO, formatDate, formatDateTime } from "@/lib/format";
import { withHistory, deliveryDateReached, fulfillOrder, rejectOrder } from "@/lib/orders";
import { manifestPDF } from "@/lib/reports";
import { shareRouteLink, listDeliveryLinks } from "@/lib/db";
import type { Allocation } from "@/lib/hatchery/types";
import {
  PRODUCTS, balance, paidAmount, orderTotal, toDeliver, extra2, isFullyPaid,
  type Order, type Payment, type Route,
} from "@/lib/types";

const CAN_MANAGE = ["Admin", "Hatchery Manager", "Hatchery Sales & Coordination Officer"];

type CoordStatus = "pending" | "confirmed" | "ready" | "delivered" | "cancelled";
const coordStatus = (o: Order): CoordStatus =>
  o.status === "refunded" || o.status === "rejected" ? "cancelled"
  : o.deliverOk ? "delivered"
  : o.allocatedOk ? "ready"
  : o.confirmedOk ? "confirmed"
  : "pending";

const STATUS_LABEL: Record<CoordStatus, string> = {
  pending: "Awaiting payment",
  confirmed: "Payment Confirmed",
  ready: "Ready for Delivery",
  delivered: "Delivered",
  cancelled: "Cancelled",
};
const STATUS_TONE: Record<CoordStatus, "green" | "gold" | "info" | "neutral" | "red"> = {
  pending: "neutral", confirmed: "gold", ready: "info", delivered: "green", cancelled: "red",
};

function payState(o: Order): { label: string; tone: "green" | "gold" | "red" | "info" } {
  if (isFullyPaid(o)) return { label: "Paid", tone: "green" };
  if (o.debtOk) return { label: "On debt", tone: "info" };
  if (o.payments.some((p) => p.amt > 0)) return { label: "Partial", tone: "gold" };
  return { label: "Unpaid", tone: "red" };
}
const mainPayment = (o: Order): Payment | undefined =>
  [...o.payments].reverse().find((p) => p.verified) ?? o.payments[o.payments.length - 1];

export default function CoordinationPage() {
  const { user, } = useAuth();
  const { orders, users, dsrs, routes, upsertOrder } = useData();
  const { batches, inventory, allocations, upsertAllocation, upsertInventory, upsertBatch, newId } = useHatchery();
  const { toast } = useToast();

  const [tab, setTab] = useState<"all" | CoordStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [allocFor, setAllocFor] = useState<Order | null>(null);
  const [cancelFor, setCancelFor] = useState<Order | null>(null);
  const [payFor, setPayFor] = useState<Order | null>(null);
  const [viewRoute, setViewRoute] = useState<{ r: Route; list: Order[]; date: string } | null>(null);
  const [showRoutes, setShowRoutes] = useState(false);
  const [sharedRoutes, setSharedRoutes] = useState<Set<string>>(new Set());
  const [qrFor, setQrFor] = useState<{ url: string; driver: string } | null>(null);

  // Which routes' driver links have already been shared (one-time share).
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const links = await listDeliveryLinks();
        if (!active) return;
        const shared = new Set<string>();
        for (const l of links) if (l.active && l.routeId && l.shared) shared.add(l.routeId);
        setSharedRoutes(shared);
      } catch { /* links stay hidden until available */ }
    })();
    return () => { active = false; };
  }, []);

  const [dateF, setDateF] = useState("");
  const [productF, setProductF] = useState("all");
  const [payF, setPayF] = useState("all");
  const [salesF, setSalesF] = useState("all");
  const [q, setQ] = useState("");

  const role = user?.role;
  const canManage = !!role && CAN_MANAGE.includes(role);

  const nameOf = (email: string) => users.find((u) => u.email === email)?.name ?? email;
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;

  const orderList = useMemo(
    () => (user ? visibleOrders(orders, user) : []),
    [orders, user]
  );

  const allocByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allocations) {
      if (a.status === "cancelled") continue;
      m.set(a.orderId, (m.get(a.orderId) ?? 0) + a.quantity);
    }
    return m;
  }, [allocations]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: 0, pending: 0, confirmed: 0, ready: 0, delivered: 0, cancelled: 0 };
    for (const o of orderList) { c.all += 1; c[coordStatus(o)] = (c[coordStatus(o)] ?? 0) + 1; }
    return c;
  }, [orderList]);

  const awaiting = useMemo(() => orderList.filter((o) => o.confirmedOk && !o.deliverOk && o.status !== "refunded" && o.status !== "rejected"), [orderList]);
  const kpis = useMemo(() => {
    const byProduct = (p: string) => awaiting.filter((o) => o.product === p).reduce((s, o) => s + o.chicks, 0);
    return {
      tetra: byProduct("Tetra Super Harco"),
      ross: byProduct("Ross 308"),
      awaiting: awaiting.length,
      inStock: inventory.reduce((s, i) => s + i.availableCount, 0),
    };
  }, [awaiting, inventory]);

  const salespeople = useMemo(
    () => Array.from(new Set(orderList.map((o) => o.by))).sort(),
    [orderList]
  );

  const rows = useMemo(() => {
    return orderList
      .filter((o) => tab === "all" || coordStatus(o) === tab)
      .filter((o) => (dateF ? o.date === dateF : true))
      .filter((o) => (productF === "all" ? true : o.product === productF))
      .filter((o) => (payF === "all" ? true : payState(o).label.toLowerCase() === payF))
      .filter((o) => (salesF === "all" ? true : o.by === salesF))
      .filter((o) => (!q.trim() ? true : smartMatch(q, o.name, o.phone)))
      .slice()
      .sort((a, b) => (a.date === b.date ? a.plan - b.plan : a.date < b.date ? -1 : 1));
  }, [orderList, tab, dateF, productF, payF, salesF, q]);

  // Routes that carry orders — the trucks going out, with their manifest.
  const routeRows = useMemo(() => {
    const active = orders.filter((o) => o.status !== "refunded" && o.status !== "rejected");
    return routes
      .map((r) => {
        const list = active.filter((o) => o.routeId === r.id && o.confirmedOk);
        const chicks = list.reduce((s, o) => s + (o.deliveryChicks ?? toDeliver(o)), 0);
        const delivered = list.filter((o) => o.deliverOk).length;
        // Per product: ordered chicks + 2% extra + compensation.
        const byProduct = PRODUCTS.map((p) => {
          const ol = list.filter((o) => o.product === p);
          const ordered = ol.reduce((s, o) => s + (o.chicks || 0), 0);
          const extra = ol.reduce((s, o) => s + extra2(o), 0);
          const comp = ol.reduce((s, o) => s + (o.comp || 0), 0);
          return { product: p, ordered, extra, comp, total: ordered + extra + comp };
        }).filter((x) => x.total > 0);
        return { r, list, chicks, delivered, byProduct, date: r.date ?? list[0]?.date ?? "" };
      })
      .filter((x) => x.list.length > 0 && (!dateF || x.date === dateF))
      .sort((a, b) => (a.date < b.date ? 1 : -1));
  }, [routes, orders, dateF]);

  const deliveryDates = useMemo(
    () => Array.from(new Set(orderList.map((o) => o.date))).sort(),
    [orderList]
  );

  const selected = selectedId ? orderList.find((o) => o.id === selectedId) ?? null : null;

  if (!user) return null;

  // ---- actions -------------------------------------------------------------
  async function copyDriverLink(r: Route) {
    if (!r.driver?.trim()) return toast("This route has no driver name.", "info");
    if (sharedRoutes.has(r.id)) return toast("This link was already shared once — it can't be shared again.", "info");
    try {
      const { token, alreadyShared } = await shareRouteLink(r.id, r.driver.trim(), user!.name);
      const url = `${window.location.origin}/deliver/${token}`;
      setSharedRoutes((s) => new Set(s).add(r.id));
      if (alreadyShared) return toast("This link was already shared once — it can't be shared again.", "info");
      try { await navigator.clipboard.writeText(url); toast(`Driver link copied — send it to ${r.driver}. It can only be shared once.`); }
      catch { toast(`Driver link ready for ${r.driver}.`); }
    } catch { toast("Could not create the driver link.", "info"); }
  }

  async function showQr(r: Route) {
    if (!r.driver?.trim()) return toast("This route has no driver name.", "info");
    if (sharedRoutes.has(r.id)) return toast("This link was already shared once — it can't be shared again.", "info");
    try {
      const { token, alreadyShared } = await shareRouteLink(r.id, r.driver.trim(), user!.name);
      const url = `${window.location.origin}/deliver/${token}`;
      setSharedRoutes((s) => new Set(s).add(r.id));
      if (alreadyShared) return toast("This link was already shared once — it can't be shared again.", "info");
      setQrFor({ url, driver: r.driver });
    } catch { toast("Could not create the driver link.", "info"); }
  }

  function allocate(order: Order, batchId: string, qty: number) {
    const inv = inventory.find((i) => i.batchId === batchId);
    if (!inv || inv.availableCount < qty) return toast("Not enough available chicks in that batch.", "error");
    const a: Allocation = {
      id: newId("alloc"), orderId: order.id, batchId, quantity: qty, productType: order.product,
      status: "finalized", by: user!.email, finalizedBy: user!.email, on: nowISO(),
      history: [`${nowISO()} — Allocated ${qty} from ${batchNo(batchId)} (by ${user!.name})`],
    };
    upsertAllocation(a);
    const remaining = inv.availableCount - qty;
    upsertInventory({ ...inv, availableCount: remaining, updatedBy: user!.email, on: nowISO() });
    // Close the batch once every hatched chick has been allocated to customers.
    if (remaining <= 0) {
      const b = batches.find((x) => x.id === batchId);
      if (b && b.status === "active") {
        void upsertBatch({ ...b, status: "inactive", history: [...b.history, `${nowISO()} — Deactivated: all hatched chicks allocated to customers (by ${user!.name})`] });
      }
    }
    toast(`Allocated ${qty.toLocaleString()} chicks to ${order.name}.`);
    setAllocFor(null);
  }

  // Auto-allocate due orders (delivery date on/before today) from available
  // inventory — matching product, oldest hatch date first, partial fills allowed.
  function autoAllocate() {
    const today = todayISO();
    const targets = awaiting
      .filter((o) => isFullyPaid(o) && o.date <= today && (allocByOrder.get(o.id) ?? 0) < toDeliver(o))
      .sort((a, b) => (a.date < b.date ? 1 : -1)); // latest due date first (from today going back)

    const invLeft = new Map<string, number>(inventory.map((i) => [i.id, i.availableCount]));
    const plan: { order: Order; batchId: string; qty: number }[] = [];
    for (const o of targets) {
      let need = toDeliver(o) - (allocByOrder.get(o.id) ?? 0);
      const invs = inventory
        .filter((i) => i.productType === o.product && (invLeft.get(i.id) ?? 0) > 0)
        .sort((a, b) => (a.hatchDate < b.hatchDate ? -1 : 1));
      for (const inv of invs) {
        if (need <= 0) break;
        const take = Math.min(invLeft.get(inv.id) ?? 0, need);
        if (take <= 0) continue;
        plan.push({ order: o, batchId: inv.batchId, qty: take });
        invLeft.set(inv.id, (invLeft.get(inv.id) ?? 0) - take);
        need -= take;
      }
    }

    if (plan.length === 0) return toast("Nothing to auto-allocate — no due orders or no matching inventory.", "info");
    const totalChicks = plan.reduce((s, p) => s + p.qty, 0);
    const orderIds = new Set(plan.map((p) => p.order.id));
    if (!confirm(`Auto-allocate ${totalChicks.toLocaleString()} chicks to ${orderIds.size} order(s) due on/before ${formatDate(today)}?`)) return;

    for (const p of plan) {
      void upsertAllocation({
        id: newId("alloc"), orderId: p.order.id, batchId: p.batchId, quantity: p.qty, productType: p.order.product,
        status: "finalized", by: user!.email, finalizedBy: user!.email, on: nowISO(),
        history: [`${nowISO()} — Auto-allocated ${p.qty} from ${batchNo(p.batchId)} (by ${user!.name})`],
      });
    }
    for (const inv of inventory) {
      const left = invLeft.get(inv.id) ?? inv.availableCount;
      if (left !== inv.availableCount) void upsertInventory({ ...inv, availableCount: left, updatedBy: user!.email, on: nowISO() });
      if (left <= 0 && inv.availableCount > 0) {
        const b = batches.find((x) => x.id === inv.batchId);
        if (b && b.status === "active") void upsertBatch({ ...b, status: "inactive", history: [...b.history, `${nowISO()} — Deactivated: all hatched chicks allocated to customers (by ${user!.name})`] });
      }
    }
    // Mark orders now fully allocated as ready for delivery.
    for (const oid of orderIds) {
      const o = orders.find((x) => x.id === oid);
      const added = plan.filter((p) => p.order.id === oid).reduce((s, p) => s + p.qty, 0);
      if (o && !o.allocatedOk && (allocByOrder.get(oid) ?? 0) + added >= toDeliver(o)) {
        void upsertOrder(withHistory({ ...o, allocatedOk: true }, user!, "Marked ready for delivery (auto-allocated)"));
      }
    }
    toast(`Auto-allocated ${totalChicks.toLocaleString()} chicks to ${orderIds.size} order(s).`);
  }

  function markReady(o: Order) {
    const allocated = allocByOrder.get(o.id) ?? 0;
    if (allocated < toDeliver(o)) return toast(`Allocate all ${toDeliver(o).toLocaleString()} chicks first (currently ${allocated.toLocaleString()}).`, "info");
    upsertOrder(withHistory({ ...o, allocatedOk: true }, user!, "Marked ready for delivery"));
    toast(`${o.name} — ready for delivery.`);
  }

  function markDelivered(o: Order) {
    if (!o.allocatedOk) return toast("Mark it ready (fully allocated) first.", "info");
    if (!deliveryDateReached(o)) return toast(`Can't mark delivered before the delivery date (${o.date}).`, "info");
    // Approve the order's allocations and fulfil the order.
    allocations.filter((a) => a.orderId === o.id && a.status !== "cancelled" && a.status !== "approved")
      .forEach((a) => upsertAllocation({ ...a, status: "approved", approvedBy: user!.email, history: [...a.history, `${nowISO()} — Delivered (by ${user!.name})`] }));
    upsertOrder(fulfillOrder(o, user!, "Delivered (hatchery coordination)"));
    toast(`${o.name} — delivered.`);
  }

  function cancelOrder(o: Order, reason: string) {
    // Return any reserved chicks to inventory, then reject the order.
    allocations.filter((a) => a.orderId === o.id && a.status !== "cancelled").forEach((a) => {
      const inv = inventory.find((i) => i.batchId === a.batchId);
      if (inv) {
        const back = inv.availableCount + a.quantity;
        upsertInventory({ ...inv, availableCount: back, updatedBy: user!.email, on: nowISO() });
        // Reopen a closed batch if returned chicks make it available again.
        const b = batches.find((x) => x.id === a.batchId);
        if (b && b.status === "inactive" && back > 0) {
          void upsertBatch({ ...b, status: "active", history: [...b.history, `${nowISO()} — Reactivated: chicks returned to inventory (by ${user!.name})`] });
        }
      }
      upsertAllocation({ ...a, status: "cancelled", history: [...a.history, `${nowISO()} — Cancelled with order (by ${user!.name})`] });
    });
    upsertOrder(rejectOrder(o, reason, user!));
    toast(`${o.name}'s order cancelled.`, "info");
    setCancelFor(null);
    setSelectedId(null);
  }

  const dueOrders = awaiting.filter((o) => isFullyPaid(o) && o.date <= todayISO() && (allocByOrder.get(o.id) ?? 0) < toDeliver(o));
  const dueToAllocate = dueOrders.length;
  const paidCount = orderList.filter((o) => isFullyPaid(o) && coordStatus(o) !== "cancelled").length;
  const neededChicks = kpis.ross + kpis.tetra;
  const inventoryShort = kpis.inStock < neededChicks;
  function resetFilters() { setDateF(""); setProductF("all"); setPayF("all"); setSalesF("all"); setQ(""); }

  // Row action menu (kebab) — reuses the same handlers as the detail modal.
  function rowActions(o: Order): DropdownAction[] {
    const st = coordStatus(o);
    const need = toDeliver(o);
    const alloc = allocByOrder.get(o.id) ?? 0;
    const closed = st === "cancelled" || st === "delivered";
    return [
      { label: "View details", onClick: () => setSelectedId(o.id) },
      { label: "Payment details", onClick: () => setPayFor(o) },
      { label: "Allocate chicks", onClick: () => setAllocFor(o), hidden: !canManage || closed, disabled: alloc >= need, disabledReason: "Already fully allocated" },
      { label: "Mark as ready", onClick: () => markReady(o), hidden: !canManage || closed || o.allocatedOk, disabled: alloc < need, disabledReason: "Allocate all chicks first" },
      { label: "Mark as delivered", onClick: () => markDelivered(o), hidden: !canManage || closed || !o.allocatedOk },
      { label: "Cancel order", onClick: () => setCancelFor(o), danger: true, hidden: !canManage || closed },
    ];
  }

  const payTone = (o: Order) => { const t = payState(o).tone; return t === "green" ? "fulfilled" : t === "info" ? "info" : t === "red" ? "red" : "gold"; };
  const statTone = (o: Order) => { const t = STATUS_TONE[coordStatus(o)]; return t === "neutral" ? "pending" : t === "red" ? "red" : t === "green" ? "fulfilled" : t; };

  return (
    <div className="space-y-5">
      {/* Filters */}
      <Card>
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[0.72rem] font-bold uppercase tracking-[0.09em] text-muted"><IcoFilter />Filters</p>
          <Button size="sm" variant="ghost" className="gap-1.5" onClick={resetFilters}><IcoReset />Reset filters</Button>
        </div>
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
          <FilterChip icon={<IcoCal />} label="Delivery date">
            <select value={dateF} onChange={(e) => setDateF(e.target.value)} className={CHIP_SELECT}>
              <option value="">All dates</option>
              {deliveryDates.map((d) => <option key={d} value={d}>{formatDate(d)}</option>)}
            </select>
          </FilterChip>
          <FilterChip icon={<IcoTag />} label="Product">
            <select value={productF} onChange={(e) => setProductF(e.target.value)} className={CHIP_SELECT}>
              <option value="all">All products</option>
              {PRODUCTS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </FilterChip>
          <FilterChip icon={<IcoCard />} label="Payment status">
            <select value={payF} onChange={(e) => setPayF(e.target.value)} className={CHIP_SELECT}>
              <option value="all">All payment</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
              <option value="on debt">On debt</option>
            </select>
          </FilterChip>
          <FilterChip icon={<IcoUser />} label="Salesperson">
            <select value={salesF} onChange={(e) => setSalesF(e.target.value)} className={CHIP_SELECT}>
              <option value="all">All salespeople</option>
              {salespeople.map((s) => <option key={s} value={s}>{nameOf(s)}</option>)}
            </select>
          </FilterChip>
          <div className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3">
            <span className="shrink-0 text-muted"><IcoSearch /></span>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client name or phone…" className="w-full bg-transparent py-2.5 text-sm text-ink outline-none" />
          </div>
        </div>
      </Card>

      {/* Big KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <BigStat icon={<IcoHen />} tone="gold" label="Ross 308 to deliver" value={kpis.ross.toLocaleString()} unit="chicks" />
        <BigStat icon={<IcoChick />} tone="green" label="Tetra Super Harco to deliver" value={kpis.tetra.toLocaleString()} unit="chicks" />
        <BigStat icon={<IcoBox />} tone="blue" label="Orders awaiting delivery" value={String(kpis.awaiting)} unit="orders" />
        <BigStat icon={<IcoInv />} tone="purple" label="Chicks in inventory" value={kpis.inStock.toLocaleString()} unit="chicks" note={inventoryShort ? "Insufficient inventory" : undefined} />
      </div>

      {/* Secondary KPI cards */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <SmallStat icon={<IcoCheck2 />} tone="green" label="Paid orders" value={String(paidCount)} />
        <SmallStat icon={<IcoClock />} tone="gold" label="Ready for delivery" value={String(counts.ready ?? 0)} />
        <SmallStat icon={<IcoTruck />} tone="blue" label="Delivered" value={String(counts.delivered ?? 0)} />
        <SmallStat icon={<IcoX />} tone="red" label="Cancelled" value={String(counts.cancelled ?? 0)} />
      </div>

      {canManage && dueToAllocate > 0 && (
        <div className="flex flex-col gap-3 rounded-2xl border border-gold/40 bg-gold-bg/40 p-4 shadow-card sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-gold-bg text-gold-dark"><IcoWarn /></span>
            <div>
              <p className="text-[0.66rem] font-bold uppercase tracking-[0.09em] text-gold-dark">Action required</p>
              <p className="mt-0.5 text-sm text-ink"><strong>{dueToAllocate}</strong> fully-paid order(s) due on/before <strong>{formatDate(todayISO())}</strong> are awaiting chick allocation.</p>
            </div>
          </div>
          <div className="sm:text-right">
            {inventoryShort && (
              <>
                <p className="text-sm font-bold text-red">Inventory insufficient</p>
                <p className="mb-2 text-xs text-muted">Please allocate chicks to these paid orders.</p>
              </>
            )}
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button size="sm" onClick={() => dueOrders[0] && setAllocFor(dueOrders[0])}>Allocate Chicks</Button>
              <Button size="sm" variant="secondary" className="gap-1.5" onClick={autoAllocate}><IcoInv />Auto-allocate from inventory</Button>
            </div>
          </div>
        </div>
      )}

      {/* Delivery routes & manifests */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="flex items-center gap-2 text-[0.95rem] font-bold text-ink"><span className="text-gold-dark"><IcoTruck /></span>Delivery routes &amp; manifests <span className="ml-1 rounded-full bg-grey-bg px-2 py-0.5 text-xs font-bold text-muted">{routeRows.length}</span></p>
          {routeRows.length > 0 && <Button size="sm" variant="secondary" onClick={() => setShowRoutes((v) => !v)}>{showRoutes ? "Hide details" : "View all routes & manifests"}</Button>}
        </div>
        {routeRows.length === 0 ? (
          <p className="text-sm text-muted">No routes with orders {dateF ? "on this date" : "yet"}.</p>
        ) : !showRoutes ? (
          <div className="space-y-2">
            {routeRows.map(({ r, list, chicks, date }, i) => {
              const confirmed = !!r.pickupConfirmed;
              return (
                <button key={r.id} type="button" onClick={() => setViewRoute({ r, list, date })} className="flex w-full items-center gap-3 rounded-xl border border-line bg-paper px-3 py-2.5 text-left transition hover:border-gold">
                  <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-gold-bg text-xs font-extrabold tabular-nums text-gold-dark">{String(i + 1).padStart(2, "0")}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold text-ink">{r.name}</p>
                    <p className="text-xs text-muted">{list.length} client(s)</p>
                  </div>
                  <div className="hidden text-right sm:block"><p className="text-sm font-extrabold tabular-nums text-ink">{chicks.toLocaleString()}</p><p className="text-[0.58rem] uppercase text-muted">chicks</p></div>
                  <span className="hidden items-center gap-1.5 text-xs text-muted md:inline-flex"><IcoCal />{date ? formatDate(date) : "—"}</span>
                  <span className="hidden items-center gap-1.5 text-xs text-muted md:inline-flex"><IcoUser />{r.driver || "—"}</span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[0.6rem] font-bold", confirmed ? "bg-green-bg text-green" : "bg-gold-bg text-gold-dark")}>{confirmed ? "Confirmed" : "On schedule"}</span>
                  <span className="shrink-0 text-muted"><IcoChevron /></span>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {routeRows.map(({ r, list, chicks, delivered, byProduct, date }) => {
                const confirmed = !!r.pickupConfirmed;
                const shared = sharedRoutes.has(r.id);
                return (
                  <div key={r.id} className="flex flex-col rounded-xl border border-line bg-paper p-3 shadow-card">
                    {/* header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <span className="inline-flex items-center gap-1 text-[0.68rem] text-muted"><IcoCal />{date ? formatDate(date) : "—"}</span>
                        <h3 className="truncate text-sm font-bold text-ink">{r.name}</h3>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[0.66rem] text-muted">
                          <span className="inline-flex items-center gap-1"><IcoPin />{list.length} stop(s){delivered > 0 ? ` · ${delivered} done` : ""}</span>
                          <span className="inline-flex items-center gap-1"><IcoUser /><strong className="text-ink">{r.driver || "—"}</strong></span>
                        </div>
                      </div>
                      {confirmed
                        ? <span className="shrink-0 rounded-full bg-green-bg px-2 py-0.5 text-[0.56rem] font-bold uppercase tracking-wide text-green">✓ Confirmed</span>
                        : <span className="shrink-0 rounded-full bg-gold-bg px-2 py-0.5 text-[0.56rem] font-bold uppercase tracking-wide text-gold-dark">⚠ Pending</span>}
                    </div>

                    {/* chick load */}
                    <div className="mt-2 space-y-1.5">
                      {byProduct.map((p) => {
                        const isRoss = p.product === "Ross 308";
                        return (
                          <div key={p.product} className={`flex items-center gap-2 rounded-lg border-l-4 px-2 py-1.5 ${isRoss ? "border-blue bg-blue-bg/40" : "border-gold bg-gold-bg/40"}`}>
                            <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full ${isRoss ? "bg-blue-bg text-blue" : "bg-gold-bg text-gold-dark"}`}>{isRoss ? <IcoHen /> : <IcoChick />}</span>
                            <div className="min-w-0 flex-1">
                              <p className="text-[0.72rem] font-bold text-ink">{p.product === "Ross 308" ? "Ross 308" : "Tetra"}</p>
                              <p className="text-[0.58rem] text-muted">{p.ordered.toLocaleString()} + {p.extra.toLocaleString()} (2%) + {p.comp.toLocaleString()} comp</p>
                            </div>
                            <p className="shrink-0 text-sm font-extrabold tabular-nums text-ink">{p.total.toLocaleString()}</p>
                          </div>
                        );
                      })}
                    </div>

                    {/* total + confirm status */}
                    <div className="mt-2 flex items-center justify-between rounded-lg bg-cream/60 px-2 py-1.5">
                      <span className="text-[0.56rem] font-bold uppercase tracking-wide text-muted">Total</span>
                      <span><strong className="text-sm font-extrabold tabular-nums text-green">{chicks.toLocaleString()}</strong> <span className="text-[0.54rem] uppercase text-muted">chicks</span></span>
                    </div>
                    <p className="mt-1.5 text-[0.6rem]">
                      {confirmed
                        ? <span className="text-green">✓ Confirmed by {r.pickupConfirmed!.by} · {formatDate(r.pickupConfirmed!.at.slice(0, 10))}</span>
                        : <span className="text-gold-dark">⏳ Awaiting driver confirmation</span>}
                    </p>

                    {/* actions */}
                    <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-line pt-2">
                      <Button size="sm" variant="ghost" onClick={() => setViewRoute({ r, list, date })}>View</Button>
                      {shared ? (
                        <span className="inline-flex items-center gap-1 text-[0.66rem] font-semibold text-green">✓ Link shared</span>
                      ) : (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => void copyDriverLink(r)} disabled={!r.driver}>Copy link</Button>
                          <Button size="sm" variant="ghost" onClick={() => void showQr(r)} disabled={!r.driver}>QR</Button>
                        </>
                      )}
                      <Button size="sm" variant="secondary" onClick={() => void manifestPDF(r, date ? formatDate(date) : "", list, dsrs)} disabled={list.length === 0}>Manifest PDF</Button>
                    </div>
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      {/* Orders */}
      <div>
        <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <h2 className="text-lg font-extrabold tracking-tight text-ink">Orders</h2>
          <div className="flex flex-wrap gap-1.5">
            {([["all", "All Orders"], ["pending", "Awaiting Payment"], ["confirmed", "Payment Confirmed"], ["ready", "Ready for Delivery"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]] as const).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={`rounded-full px-3 py-1.5 text-sm transition ${tab === key ? "bg-onyx text-white" : "border border-line bg-paper text-ink hover:border-gold"}`}
              >
                {label} <span className={tab === key ? "text-white/70" : "text-muted"}>{counts[key] ?? 0}</span>
              </button>
            ))}
          </div>
        </div>

        <Card>
          {/* Desktop table */}
          <div className="hidden sm:block">
            <TableWrap>
              <thead>
                <tr>
                  <Th>Delivery date</Th><Th>Client</Th><Th>Product</Th><Th className="text-right">Qty (chicks)</Th>
                  <Th>Payment</Th><Th>Status</Th><Th>Salesperson</Th><Th className="text-right">Action</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <EmptyRow colSpan={8} text="No orders match these filters." />
                ) : rows.map((o) => {
                  const ps = payState(o);
                  const st = coordStatus(o);
                  return (
                    <tr key={o.id} className="hover:bg-cream/40">
                      <Td className="whitespace-nowrap">{formatDate(o.date)}</Td>
                      <Td className="font-medium"><button type="button" onClick={() => setSelectedId(o.id)} className="text-gold-dark hover:text-gold">{o.name}</button><div className="text-xs text-muted">{o.phone}</div></Td>
                      <Td>{o.product}</Td>
                      <Td className="text-right tabular-nums">{o.chicks.toLocaleString()}</Td>
                      <Td><Pill tone={payTone(o)}>{ps.label}</Pill></Td>
                      <Td><Pill tone={statTone(o)}>{STATUS_LABEL[st]}</Pill></Td>
                      <Td className="whitespace-nowrap text-muted">{nameOf(o.by)}</Td>
                      <Td>
                        <div className="flex items-center justify-end gap-1">
                          <Button size="sm" variant="ghost" onClick={() => setSelectedId(o.id)}>View</Button>
                          <ActionsDropdown label="⋮" actions={rowActions(o)} />
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2.5 sm:hidden">
            {rows.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted">No orders match these filters.</p>
            ) : rows.map((o) => {
              const ps = payState(o);
              const st = coordStatus(o);
              return (
                <div key={o.id} className="rounded-2xl border border-line bg-paper p-3.5 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <button type="button" onClick={() => setSelectedId(o.id)} className="block truncate font-semibold text-gold-dark">{o.name}</button>
                      <div className="text-xs text-muted">{o.phone}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1">
                      <Pill tone={statTone(o)}>{STATUS_LABEL[st]}</Pill>
                      <Pill tone={payTone(o)}>{ps.label}</Pill>
                    </div>
                  </div>
                  <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                    <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Delivery</p><p className="font-medium text-ink">{formatDate(o.date)}</p></div>
                    <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Product</p><p className="font-medium text-ink">{o.product}</p></div>
                    <div><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Qty (chicks)</p><p className="font-medium tabular-nums text-ink">{o.chicks.toLocaleString()}</p></div>
                    <div className="min-w-0"><p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Salesperson</p><p className="truncate font-medium text-ink">{nameOf(o.by)}</p></div>
                  </div>
                  <div className="mt-2.5 flex items-center justify-end gap-1 border-t border-line pt-2.5">
                    <Button size="sm" variant="ghost" onClick={() => setSelectedId(o.id)}>View</Button>
                    <ActionsDropdown label="⋮" actions={rowActions(o)} />
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      {/* Order detail modal */}
      {selected && (
        <Modal open onClose={() => setSelectedId(null)} title={`Order — ${selected.name}`} className="max-w-md">
          <DetailPanel
            order={selected}
            allocated={allocByOrder.get(selected.id) ?? 0}
            batchName={(() => {
              const a = allocations.find((x) => x.orderId === selected.id && x.status !== "cancelled");
              return a ? batchNo(a.batchId) : "—";
            })()}
            nameOf={nameOf}
            canManage={canManage}
            onAllocate={() => setAllocFor(selected)}
            onReady={() => markReady(selected)}
            onDelivered={() => markDelivered(selected)}
            onCancel={() => setCancelFor(selected)}
            onPayment={() => setPayFor(selected)}
          />
        </Modal>
      )}

      {allocFor && (
        <AllocateModal
          order={allocFor}
          allocated={allocByOrder.get(allocFor.id) ?? 0}
          inventory={inventory.filter((i) => i.productType === allocFor.product && i.availableCount > 0)}
          batchName={batchNo}
          onClose={() => setAllocFor(null)}
          onSave={(batchId, qty) => allocate(allocFor, batchId, qty)}
        />
      )}
      {cancelFor && (
        <CancelModal order={cancelFor} onClose={() => setCancelFor(null)} onSave={(reason) => cancelOrder(cancelFor, reason)} />
      )}
      {payFor && <PaymentModal order={payFor} nameOf={nameOf} onClose={() => setPayFor(null)} />}

      {viewRoute && (
        <Modal open onClose={() => setViewRoute(null)} title={`${viewRoute.r.name}${viewRoute.date ? ` — ${formatDate(viewRoute.date)}` : ""}`} className="max-w-2xl" footer={<Button variant="ghost" onClick={() => setViewRoute(null)}>Close</Button>}>
          <p className="mb-2 text-sm text-muted">Driver: <strong className="text-ink">{viewRoute.r.driver || "—"}</strong> · {viewRoute.list.length} stop(s)</p>
          <TableWrap>
            <thead><tr><Th>Customer</Th><Th>Product</Th><Th className="text-right">Chicks</Th><Th>Pickup</Th><Th>Status</Th></tr></thead>
            <tbody>
              {viewRoute.list.map((o) => (
                <tr key={o.id}>
                  <Td className="font-medium">{o.name}<div className="text-xs text-muted">{o.phone}</div></Td>
                  <Td className="whitespace-nowrap"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: o.product === "Ross 308" ? "#1565c0" : "#b8860b" }} />{o.product}</span></Td>
                  <Td className="text-right tabular-nums">{(o.deliveryChicks ?? toDeliver(o)).toLocaleString()}</Td>
                  <Td>{o.pickupLocation ?? "—"}</Td>
                  <Td>{o.deliverOk ? <Pill tone="green">Delivered</Pill> : o.allocatedOk ? <Pill tone="info">Ready</Pill> : <Pill tone="gold">To allocate</Pill>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Modal>
      )}

      {qrFor && <QRModal url={qrFor.url} driver={qrFor.driver} onClose={() => setQrFor(null)} />}
    </div>
  );
}

function QRModal({ url, driver, onClose }: { url: string; driver: string; onClose: () => void }) {
  const [img, setImg] = useState("");
  useEffect(() => {
    let active = true;
    QRCode.toDataURL(url, { width: 256, margin: 1 }).then((d) => { if (active) setImg(d); }).catch(() => {});
    return () => { active = false; };
  }, [url]);
  return (
    <Modal open onClose={onClose} title={`Driver QR — ${driver}`} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="flex flex-col items-center gap-3 text-center">
        {img ? (
          // eslint-disable-next-line @next/next/no-img-element -- generated QR data URL
          <img src={img} alt={`QR code for ${driver}'s route`} className="h-56 w-56 rounded-lg border border-line" />
        ) : (
          <p className="py-16 text-sm text-muted">Generating QR…</p>
        )}
        <p className="text-sm text-muted">Ask {driver} to scan this to open the route on their phone — no link needed.</p>
        <code className="max-w-full truncate rounded bg-ink/5 px-2 py-1 text-xs text-muted">{url}</code>
      </div>
    </Modal>
  );
}

// ---- route card icons -----------------------------------------------------
const IcoCal = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="16" rx="2" /><path d="M3.5 9h17M8 3v3M16 3v3" /></svg>;
const IcoPin = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z" /><circle cx="12" cy="10" r="2.4" /></svg>;
const IcoUser = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="8" r="3.5" /><path d="M5 20a7 7 0 0 1 14 0" /></svg>;
const IcoChick = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="13.5" rx="6" ry="7" /><path d="M12 6.5V4" /><circle cx="10" cy="12" r=".6" fill="currentColor" /></svg>;
const IcoHen = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 20c0-5 3-8 7-8 2 0 3 1 3 1l3-4-1 5c1 1 1 3 0 4" /><path d="M13 12l-1-3 3 1" /></svg>;

// ---------------------------------------------------------------------------

function DetailPanel({
  order: o, allocated, batchName, nameOf, canManage,
  onAllocate, onReady, onDelivered, onCancel, onPayment,
}: {
  order: Order; allocated: number; batchName: string; nameOf: (e: string) => string; canManage: boolean;
  onAllocate: () => void; onReady: () => void; onDelivered: () => void; onCancel: () => void; onPayment: () => void;
}) {
  const st = coordStatus(o);
  const need = toDeliver(o);
  const pay = mainPayment(o);
  const closed = st === "cancelled" || st === "delivered";
  return (
    <div>
      <span className="mb-1 inline-block"><Pill tone={STATUS_TONE[st] === "neutral" ? "pending" : STATUS_TONE[st] === "red" ? "red" : STATUS_TONE[st] === "green" ? "fulfilled" : STATUS_TONE[st]}>{STATUS_LABEL[st]}</Pill></span>

      <Section title="Client">
        <Row k="Name" v={o.name} />
        <Row k="Phone" v={o.phone} />
        <Row k="District" v={`${o.clientDistrict ?? o.district}`} />
        <Row k="Pickup" v={o.pickupLocation ?? "—"} />
      </Section>

      <Section title="Order">
        <Row k="Product" v={o.product} />
        <Row k="Quantity" v={`${o.chicks.toLocaleString()} chicks`} />
        <Row k="Delivery date" v={formatDate(o.date)} />
        <Row k="Salesperson" v={nameOf(o.by)} />
        <Row k="Order time" v={formatDateTime(o.createdAt)} />
      </Section>

      <Section title="Payment">
        <Row k="Amount" v={formatRWF(orderTotal(o))} />
        <Row k="Paid" v={formatRWF(paidAmount(o))} />
        <Row k="Balance" v={formatRWF(balance(o))} />
        {pay && <Row k="Method" v={`${pay.method ?? "—"}${pay.bankName ? ` · ${pay.bankName}` : ""}`} />}
        {pay?.ref && <Row k="Transaction ID" v={pay.ref} />}
        {pay?.verifiedBy && <Row k="Verified by" v={nameOf(pay.verifiedBy)} />}
        {pay?.verifiedOn && <Row k="Verified on" v={formatDateTime(pay.verifiedOn)} />}
      </Section>

      <Section title="Allocation">
        <Row k="Allocated" v={`${allocated.toLocaleString()} / ${need.toLocaleString()}`} />
        <Row k="Batch" v={batchName} />
      </Section>

      {canManage && !closed && (
        <div className="mt-3 space-y-2">
          <Button className="w-full" onClick={onAllocate} disabled={allocated >= need}>Allocate chicks</Button>
          {!o.allocatedOk && <Button variant="secondary" className="w-full" onClick={onReady} disabled={allocated < need}>Mark as ready</Button>}
          {o.allocatedOk && <Button className="w-full" onClick={onDelivered}>Mark as delivered</Button>}
          <Button variant="ghost" className="w-full text-status-refunded" onClick={onCancel}>Cancel order</Button>
        </div>
      )}
      <Button variant="ghost" className="mt-2 w-full" onClick={onPayment}>View payment details</Button>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-line py-2.5">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted">{k}</span>
      <span className="text-right font-medium text-ink">{v}</span>
    </div>
  );
}

function AllocateModal({
  order, allocated, inventory, batchName, onClose, onSave,
}: {
  order: Order; allocated: number;
  inventory: { batchId: string; availableCount: number }[];
  batchName: (id: string) => string;
  onClose: () => void; onSave: (batchId: string, qty: number) => void;
}) {
  const remaining = Math.max(0, toDeliver(order) - allocated);
  const [batchId, setBatchId] = useState(inventory[0]?.batchId ?? "");
  const [qty, setQty] = useState(String(remaining || ""));
  const [err, setErr] = useState<string | null>(null);
  const inv = inventory.find((i) => i.batchId === batchId);
  return (
    <Modal open onClose={onClose} title={`Allocate chicks — ${order.name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => {
          const n = Number(qty) || 0;
          if (inventory.length === 0) return setErr("No batch has available chicks for this product.");
          if (!batchId) return setErr("Choose a batch.");
          if (n <= 0) return setErr("Enter a quantity.");
          if (inv && n > inv.availableCount) return setErr(`Only ${inv.availableCount.toLocaleString()} available in that batch.`);
          onSave(batchId, n);
        }}>Allocate</Button>
      </>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">{order.product} · need <strong className="text-ink">{toDeliver(order).toLocaleString()}</strong>, allocated <strong className="text-ink">{allocated.toLocaleString()}</strong>, remaining <strong className="text-gold-dark">{remaining.toLocaleString()}</strong>.</p>
        <Field label="Batch">
          {inventory.length === 0 ? <p className="text-status-refunded">No available chicks for {order.product}.</p> : (
            <Select value={batchId} onChange={(e) => setBatchId(e.target.value)}
              options={inventory.map((i) => ({ value: i.batchId, label: `${batchName(i.batchId)} — ${i.availableCount.toLocaleString()} available` }))} />
          )}
        </Field>
        <Field label="Quantity"><Input type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
        {err && <p className="text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

function CancelModal({ order, onClose, onSave }: { order: Order; onClose: () => void; onSave: (reason: string) => void }) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Cancel order — ${order.name}`}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Keep order</Button>
        <Button className="!bg-status-refunded" onClick={() => { if (!reason.trim()) return setErr("Enter a reason."); onSave(reason.trim()); }}>Cancel order</Button>
      </>}>
      <div className="space-y-3 text-sm">
        <p className="text-muted">Cancelling rejects the order and returns any reserved chicks to inventory. This can&apos;t be undone.</p>
        <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is it cancelled?" /></Field>
        {err && <p className="text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

function PaymentModal({ order, nameOf, onClose }: { order: Order; nameOf: (e: string) => string; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Payments — ${order.name}`} footer={<Button variant="ghost" onClick={onClose}>Close</Button>}>
      <TableWrap>
        <thead><tr><Th className="text-right">Amount</Th><Th>Method</Th><Th>Reference</Th><Th>Status</Th><Th>When</Th></tr></thead>
        <tbody>
          {order.payments.length === 0 ? <EmptyRow colSpan={5} text="No payments recorded." /> : order.payments.map((p, i) => (
            <tr key={i}>
              <Td className="text-right">{formatRWF(p.amt)}</Td>
              <Td>{p.method ?? "—"}{p.bankName ? ` · ${p.bankName}` : ""}</Td>
              <Td className="font-mono text-xs">{p.ref}</Td>
              <Td><Pill tone={p.voided ? "red" : p.verified ? "fulfilled" : "gold"}>{p.voided ? "Voided" : p.verified ? "Verified" : "Unverified"}</Pill></Td>
              <Td className="text-xs text-muted">{p.verifiedOn ? `verified ${formatDateTime(p.verifiedOn)}${p.verifiedBy ? ` by ${nameOf(p.verifiedBy)}` : ""}` : formatDateTime(p.on)}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Modal>
  );
}

// ---- redesign helpers: filter chips + stat cards --------------------------

const CHIP_SELECT = "w-full cursor-pointer bg-transparent text-sm font-medium text-ink outline-none";

const TONE_CHIP: Record<string, string> = {
  gold: "bg-gold-bg text-gold-dark",
  green: "bg-green-bg text-green",
  blue: "bg-blue-bg text-blue",
  purple: "bg-[#efe7fb] text-[#7c3aed]",
  red: "bg-red-bg text-red",
};
const TONE_VAL: Record<string, string> = {
  gold: "text-gold-dark", green: "text-green", blue: "text-blue", purple: "text-[#7c3aed]", red: "text-red",
};

function FilterChip({ icon, label, children }: { icon: React.ReactNode; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border border-line bg-paper px-3 py-1.5">
      <span className="shrink-0 text-muted">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[0.54rem] font-bold uppercase tracking-wide text-muted">{label}</p>
        {children}
      </div>
    </div>
  );
}

function BigStat({ icon, tone, label, value, unit, note }: { icon: React.ReactNode; tone: string; label: string; value: string; unit: string; note?: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 shadow-card">
      <div className="flex items-start gap-3">
        <span className={cn("grid h-11 w-11 shrink-0 place-items-center rounded-full", TONE_CHIP[tone])}>{icon}</span>
        <p className="mt-0.5 text-[0.6rem] font-bold uppercase leading-tight tracking-[0.08em] text-muted">{label}</p>
      </div>
      <p className={cn("mt-3 text-[1.9rem] font-extrabold leading-none tabular-nums", TONE_VAL[tone])}>{value}</p>
      <p className="mt-1 text-xs text-muted">{unit}</p>
      {note && <p className="mt-1 text-xs font-semibold text-red">{note}</p>}
    </div>
  );
}

function SmallStat({ icon, tone, label, value }: { icon: React.ReactNode; tone: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper p-4 shadow-card">
      <span className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", TONE_CHIP[tone])}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[0.6rem] font-bold uppercase tracking-wide text-muted">{label}</p>
        <p className="text-2xl font-extrabold leading-none tabular-nums text-ink">{value}</p>
      </div>
    </div>
  );
}

const cic = (children: React.ReactNode, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoFilter = () => cic(<path d="M3 5h18l-7 8v5l-4 2v-7z" />, 15);
const IcoReset = () => cic(<><path d="M4 10a8 8 0 1 1 1 4" /><path d="M4 5v5h5" /></>, 14);
const IcoTag = () => cic(<><path d="M4 6.5 10 4l6 2.5v7L10 16l-6-2.5z" /><path d="M4 6.5 10 9l6-2.5M10 9v7" /></>);
const IcoCard = () => cic(<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>);
const IcoSearch = () => cic(<><circle cx="10.5" cy="10.5" r="6" /><path d="m20 20-4.5-4.5" /></>, 15);
const IcoChevron = () => cic(<path d="m9 6 6 6-6 6" />, 16);
const IcoBox = () => cic(<><path d="M4 8l8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /></>);
const IcoInv = () => cic(<><rect x="4" y="7" width="16" height="13" rx="2" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></>, 15);
const IcoCheck2 = () => cic(<><circle cx="12" cy="12" r="9" /><path d="m8.5 12 2.5 2.5 4.5-5" /></>);
const IcoClock = () => cic(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
const IcoTruck = () => cic(<><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>);
const IcoX = () => cic(<><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></>);
const IcoWarn = () => cic(<><path d="M12 4 3 19h18z" /><path d="M12 10v4M12 17h.01" /></>);

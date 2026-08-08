"use client";

import { useMemo, useState } from "react";

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
import { StatTile } from "@/components/dashboard/DashKit";

import { visibleOrders } from "@/lib/permissions";
import { smartMatch } from "@/lib/search";
import { formatRWF } from "@/lib/config";
import { nowISO, formatDate, formatDateTime } from "@/lib/format";
import { withHistory, fulfillOrder, rejectOrder } from "@/lib/orders";
import type { Allocation } from "@/lib/hatchery/types";
import {
  PRODUCTS, balance, paidAmount, orderTotal, toDeliver, isFullyPaid,
  type Order, type Payment,
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
  const { orders, users, upsertOrder } = useData();
  const { batches, inventory, allocations, upsertAllocation, upsertInventory, upsertBatch, newId } = useHatchery();
  const { toast } = useToast();

  const [tab, setTab] = useState<"all" | CoordStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [allocFor, setAllocFor] = useState<Order | null>(null);
  const [cancelFor, setCancelFor] = useState<Order | null>(null);
  const [payFor, setPayFor] = useState<Order | null>(null);

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
    const c: Record<string, number> = { all: 0, confirmed: 0, ready: 0, delivered: 0, cancelled: 0 };
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

  const deliveryDates = useMemo(
    () => Array.from(new Set(orderList.map((o) => o.date))).sort(),
    [orderList]
  );

  const selected = selectedId ? orderList.find((o) => o.id === selectedId) ?? null : null;

  if (!user) return null;

  // ---- actions -------------------------------------------------------------
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

  function markReady(o: Order) {
    const allocated = allocByOrder.get(o.id) ?? 0;
    if (allocated < toDeliver(o)) return toast(`Allocate all ${toDeliver(o).toLocaleString()} chicks first (currently ${allocated.toLocaleString()}).`, "info");
    upsertOrder(withHistory({ ...o, allocatedOk: true }, user!, "Marked ready for delivery"));
    toast(`${o.name} — ready for delivery.`);
  }

  function markDelivered(o: Order) {
    if (!o.allocatedOk) return toast("Mark it ready (fully allocated) first.", "info");
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

  return (
    <div className="space-y-5">
      {/* Filters + search — compact row at the top of the page */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="w-full sm:w-44"><Select value={dateF} onChange={(e) => setDateF(e.target.value)} options={[{ value: "", label: "All delivery dates" }, ...deliveryDates.map((d) => ({ value: d, label: formatDate(d) }))]} /></div>
        <div className="w-full sm:w-40"><Select value={productF} onChange={(e) => setProductF(e.target.value)} options={[{ value: "all", label: "All products" }, ...PRODUCTS.map((p) => ({ value: p, label: p }))]} /></div>
        <div className="w-full sm:w-36"><Select value={payF} onChange={(e) => setPayF(e.target.value)} options={[{ value: "all", label: "All payment" }, { value: "paid", label: "Paid" }, { value: "partial", label: "Partial" }, { value: "unpaid", label: "Unpaid" }, { value: "on debt", label: "On debt" }]} /></div>
        <div className="w-full sm:w-44"><Select value={salesF} onChange={(e) => setSalesF(e.target.value)} options={[{ value: "all", label: "All salespeople" }, ...salespeople.map((s) => ({ value: s, label: nameOf(s) }))]} /></div>
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search client name or phone…" className="w-full sm:w-56" />
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Tetra Super Harco to deliver" value={kpis.tetra.toLocaleString()} tone="gold" />
        <StatTile label="Ross 308 to deliver" value={kpis.ross.toLocaleString()} tone="gold" />
        <StatTile label="Orders awaiting delivery" value={String(kpis.awaiting)} />
        <StatTile label="Chicks in inventory" value={kpis.inStock.toLocaleString()} tone={kpis.inStock ? "green" : "default"} />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* Tabs */}
          <div className="flex flex-wrap gap-1.5">
            {([["all", "All Orders"], ["confirmed", "Payment Confirmed"], ["ready", "Ready for Delivery"], ["delivered", "Delivered"], ["cancelled", "Cancelled"]] as const).map(([key, label]) => (
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

          <Card>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Delivery date</Th><Th>Client</Th><Th>Product</Th><Th className="text-right">Chicks</Th>
                  <Th>Payment</Th><Th className="text-right">Balance</Th><Th className="text-right">Allocated</Th><Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 ? (
                  <EmptyRow colSpan={8} text="No orders match these filters." />
                ) : rows.map((o) => {
                  const ps = payState(o);
                  const st = coordStatus(o);
                  const bal = balance(o);
                  const alloc = allocByOrder.get(o.id) ?? 0;
                  return (
                    <tr
                      key={o.id}
                      onClick={() => setSelectedId(o.id)}
                      className={`cursor-pointer ${selectedId === o.id ? "bg-gold-bg/40" : "hover:bg-cream/40"}`}
                    >
                      <Td>{formatDate(o.date)}</Td>
                      <Td className="font-medium">{o.name}</Td>
                      <Td>{o.product}</Td>
                      <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                      <Td><Pill tone={ps.tone === "green" ? "fulfilled" : ps.tone === "info" ? "info" : ps.tone === "red" ? "red" : "gold"}>{ps.label}</Pill></Td>
                      <Td className="text-right">{bal > 0 ? `${bal.toLocaleString()} RWF` : "—"}</Td>
                      <Td className="text-right tabular-nums">{alloc.toLocaleString()}/{toDeliver(o).toLocaleString()}</Td>
                      <Td><Pill tone={STATUS_TONE[st] === "neutral" ? "pending" : STATUS_TONE[st] === "red" ? "red" : STATUS_TONE[st] === "green" ? "fulfilled" : STATUS_TONE[st]}>{STATUS_LABEL[st]}</Pill></Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </Card>
        </div>

        {/* Detail panel */}
        <div className="lg:sticky lg:top-4 lg:self-start">
          {selected ? (
            <DetailPanel
              order={selected}
              allocated={allocByOrder.get(selected.id) ?? 0}
              batchName={(() => {
                const a = allocations.find((x) => x.orderId === selected.id && x.status !== "cancelled");
                return a ? batchNo(a.batchId) : "—";
              })()}
              nameOf={nameOf}
              canManage={canManage}
              onClose={() => setSelectedId(null)}
              onAllocate={() => setAllocFor(selected)}
              onReady={() => markReady(selected)}
              onDelivered={() => markDelivered(selected)}
              onCancel={() => setCancelFor(selected)}
              onPayment={() => setPayFor(selected)}
            />
          ) : (
            <Card><p className="text-sm text-muted">Select an order to see its details and actions.</p></Card>
          )}
        </div>
      </div>

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
    </div>
  );
}

// ---------------------------------------------------------------------------

function DetailPanel({
  order: o, allocated, batchName, nameOf, canManage,
  onClose, onAllocate, onReady, onDelivered, onCancel, onPayment,
}: {
  order: Order; allocated: number; batchName: string; nameOf: (e: string) => string; canManage: boolean;
  onClose: () => void; onAllocate: () => void; onReady: () => void; onDelivered: () => void; onCancel: () => void; onPayment: () => void;
}) {
  const st = coordStatus(o);
  const need = toDeliver(o);
  const pay = mainPayment(o);
  const closed = st === "cancelled" || st === "delivered";
  return (
    <Card>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">Order</p>
          <p className="font-bold text-ink">{o.name}</p>
          <span className="mt-1 inline-block"><Pill tone={STATUS_TONE[st] === "neutral" ? "pending" : STATUS_TONE[st] === "red" ? "red" : STATUS_TONE[st] === "green" ? "fulfilled" : STATUS_TONE[st]}>{STATUS_LABEL[st]}</Pill></span>
        </div>
        <button type="button" onClick={onClose} className="text-muted hover:text-ink">✕</button>
      </div>

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
    </Card>
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

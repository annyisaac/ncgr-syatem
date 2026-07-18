"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";

import { visibleOrders } from "@/lib/permissions";
import { nowISO, formatDate } from "@/lib/format";
import { withHistory, fulfillOrder } from "@/lib/orders";
import { markStep } from "@/lib/hatchery/lifecycle";
import type { Allocation, Dispatch } from "@/lib/hatchery/types";
import { PRODUCTS, balance, isFullyPaid, type Order as SalesOrder } from "@/lib/types";

/** Delivery payment state for the coordination view. */
function payState(o: SalesOrder): { label: string; tone: "green" | "gold" | "red" | "info" } {
  if (isFullyPaid(o)) return { label: "Paid", tone: "green" };
  if (o.debtOk) return { label: "On debt", tone: "info" };
  if (o.payments.some((p) => p.amt > 0)) return { label: "Partial", tone: "gold" };
  return { label: "Unpaid", tone: "red" };
}

const CAN_PROPOSE = ["Admin", "Hatchery Manager", "Hatchery Sales & Coordination Officer"];
const CAN_FINALIZE = ["Admin", "Hatchery Manager"];
const CAN_APPROVE = ["Admin", "Operations Manager"];
const CAN_DISPATCH = ["Admin", "Hatchery Manager", "Hatchery Sales & Coordination Officer"];

export default function CoordinationPage() {
  const { user } = useAuth();
  const { orders, upsertOrder } = useData();
  const {
    batches, inventory, allocations, dispatches,
    upsertAllocation, upsertInventory, upsertBatch, upsertDispatch, newId,
  } = useHatchery();
  const { toast } = useToast();

  const [allocFor, setAllocFor] = useState<SalesOrder | null>(null);
  const [dispatchFor, setDispatchFor] = useState<Allocation | null>(null);

  const role = user?.role;
  const canPropose = !!role && CAN_PROPOSE.includes(role);
  const canFinalize = !!role && CAN_FINALIZE.includes(role);
  const canApprove = !!role && CAN_APPROVE.includes(role);
  const canDispatch = !!role && CAN_DISPATCH.includes(role);

  const orderList = useMemo(() => {
    if (!user) return [];
    return visibleOrders(orders, user).filter(
      (o) => o.confirmedOk && o.status !== "refunded" && o.status !== "rejected"
    );
  }, [orders, user]);

  const allocByOrder = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of allocations) {
      if (a.status === "cancelled") continue;
      m.set(a.orderId, (m.get(a.orderId) ?? 0) + a.quantity);
    }
    return m;
  }, [allocations]);

  // Sales demand: confirmed orders still awaiting delivery — this is what the
  // hatchery must ship out. Sorted by delivery date + route order (the plan).
  const toDeliver = useMemo(
    () => orderList
      .filter((o) => !o.deliverOk)
      .slice()
      .sort((a, b) => (a.date === b.date ? a.plan - b.plan : a.date < b.date ? -1 : 1)),
    [orderList]
  );
  const demandByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of toDeliver) m.set(o.product, (m.get(o.product) ?? 0) + o.chicks);
    return m;
  }, [toDeliver]);
  const chicksInStock = useMemo(() => inventory.reduce((s, i) => s + i.availableCount, 0), [inventory]);

  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;
  const orderName = (id?: string) => (id ? orders.find((o) => o.id === id)?.name ?? id : "—");

  if (!user) return null;

  function proposeAllocation(order: SalesOrder, batchId: string, qty: number) {
    const inv = inventory.find((i) => i.batchId === batchId);
    if (!inv || inv.availableCount < qty) {
      toast("Not enough available chicks in that batch.", "error");
      return;
    }
    const a: Allocation = {
      id: newId("alloc"),
      orderId: order.id,
      batchId,
      quantity: qty,
      productType: order.product,
      status: "proposed",
      by: user!.email,
      on: nowISO(),
      history: [`${nowISO()} — Proposed ${qty} from ${batchNo(batchId)} (by ${user!.name})`],
    };
    upsertAllocation(a);
    upsertInventory({ ...inv, availableCount: inv.availableCount - qty, updatedBy: user!.email, on: nowISO() });
    toast(`Allocated ${qty} chicks to ${order.name}.`);
    setAllocFor(null);
  }

  function setAllocStatus(a: Allocation, status: Allocation["status"], note: string) {
    upsertAllocation({
      ...a,
      status,
      ...(status === "finalized" ? { finalizedBy: user!.email } : {}),
      ...(status === "approved" ? { approvedBy: user!.email } : {}),
      history: [...a.history, `${nowISO()} — ${note} (by ${user!.name})`],
    });
    toast(note + ".");
  }

  function cancelAllocation(a: Allocation) {
    // restore inventory
    const inv = inventory.find((i) => i.batchId === a.batchId);
    if (inv) upsertInventory({ ...inv, availableCount: inv.availableCount + a.quantity, updatedBy: user!.email, on: nowISO() });
    setAllocStatus(a, "cancelled", "Cancelled allocation");
  }

  function doDispatch(a: Allocation, pickupLocation: string, carrier: string, carrierType: Dispatch["carrierType"]) {
    const d: Dispatch = {
      id: newId("disp"),
      orderId: a.orderId,
      batchId: a.batchId,
      quantity: a.quantity,
      pickupLocation,
      carrier,
      carrierType,
      dispatchedAt: nowISO(),
      by: user!.email,
    };
    upsertDispatch(d);
    // Move batch to dispatched + mark the dispatch step.
    const b = batches.find((x) => x.id === a.batchId);
    if (b) {
      const nb = b.steps["dispatch"] ? b : markStep(b, "dispatch", user!);
      upsertBatch({ ...nb, status: "dispatched" });
    }
    // Update the shared sales order's tracking.
    const so = orders.find((o) => o.id === a.orderId);
    if (so) {
      upsertOrder(
        withHistory(so, user!, `Dispatched from hatchery — batch ${batchNo(a.batchId)}, ${carrierType} ${carrier} (pickup ${pickupLocation})`)
      );
    }
    setAllocStatus(a, "approved", `Dispatched (${carrier})`);
    toast(`Dispatched ${a.quantity} chicks for ${orderName(a.orderId)}.`);
    setDispatchFor(null);
  }

  function confirmDelivery(d: Dispatch) {
    const on = nowISO();
    upsertDispatch({ ...d, deliveredAt: on });
    const b = batches.find((x) => x.id === d.batchId);
    if (b) {
      // Once every chick is delivered and the batch's inventory is drained to
      // zero, close the batch (inactive). Otherwise it stays "delivered".
      const batchDisp = dispatches.map((x) => (x.id === d.id ? { ...x, deliveredAt: on } : x)).filter((x) => x.batchId === d.batchId);
      const allDelivered = batchDisp.length > 0 && batchDisp.every((x) => x.deliveredAt);
      const avail = inventory.find((i) => i.batchId === d.batchId)?.availableCount ?? 0;
      const closed = allDelivered && avail <= 0;
      const nb = markStep(b, "delivery", user!);
      upsertBatch(
        closed
          ? { ...nb, status: "inactive", history: [...nb.history, `${on} — Batch inactivated: all chicks delivered (by ${user!.name})`] }
          : { ...nb, status: "delivered" }
      );
    }
    const so = orders.find((o) => o.id === d.orderId);
    if (so && !so.deliverOk) upsertOrder(fulfillOrder(so, user!, "Delivered (confirmed at hatchery dispatch)"));
    toast(`Delivery confirmed for ${orderName(d.orderId)}.`);
  }

  const activeDispatches = dispatches.filter((d) => !d.deliveredAt);

  return (
    <div className="space-y-5">

      {/* Delivery demand from sales — per product, payment status, delivery plan */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {PRODUCTS.map((p) => (
          <div key={p} className="rounded-xl border border-line bg-paper p-3.5">
            <p className="text-xs text-muted">{p} to deliver</p>
            <p className="text-xl font-bold text-gold-dark">{(demandByProduct.get(p) ?? 0).toLocaleString()}</p>
          </div>
        ))}
        <div className="rounded-xl border border-line bg-paper p-3.5">
          <p className="text-xs text-muted">Orders awaiting delivery</p>
          <p className="text-xl font-bold text-ink">{toDeliver.length.toLocaleString()}</p>
        </div>
        <div className="rounded-xl border border-line bg-paper p-3.5">
          <p className="text-xs text-muted">Chicks in inventory</p>
          <p className={`text-xl font-bold ${chicksInStock > 0 ? "text-green" : "text-ink"}`}>{chicksInStock.toLocaleString()}</p>
        </div>
      </div>

      <Card>
        <CardHeader title={`Chicks to deliver — sales delivery plan (${toDeliver.length})`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Delivery date</Th>
              <Th>Client</Th>
              <Th>Product</Th>
              <Th className="text-right">Chicks</Th>
              <Th>Payment</Th>
              <Th className="text-right">Balance</Th>
              <Th className="text-right">Allocated</Th>
            </tr>
          </thead>
          <tbody>
            {toDeliver.length === 0 ? (
              <EmptyRow colSpan={7} text="Nothing awaiting delivery." />
            ) : (
              toDeliver.map((o) => {
                const ps = payState(o);
                const bal = balance(o);
                const allocated = allocByOrder.get(o.id) ?? 0;
                return (
                  <tr key={o.id}>
                    <Td>{formatDate(o.date)}</Td>
                    <Td>{o.name}</Td>
                    <Td>{o.product}</Td>
                    <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                    <Td><Pill tone={ps.tone}>{ps.label}</Pill></Td>
                    <Td className="text-right">{bal > 0 ? `${bal.toLocaleString()} RWF` : "—"}</Td>
                    <Td className="text-right">
                      {allocated >= o.chicks
                        ? <Pill tone="green">ready</Pill>
                        : <span className="text-muted">{allocated.toLocaleString()}/{o.chicks.toLocaleString()}</span>}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {/* Orders needing chicks */}
      <Card>
        <CardHeader title="Confirmed orders — match to batches" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Delivery</Th>
              <Th>Client</Th>
              <Th>Product</Th>
              <Th className="text-right">Chicks</Th>
              <Th className="text-right">Allocated</Th>
              <Th className="text-right">Remaining</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {orderList.length === 0 ? (
              <EmptyRow colSpan={7} text="No confirmed orders awaiting chicks." />
            ) : (
              orderList.map((o) => {
                const allocated = allocByOrder.get(o.id) ?? 0;
                const remaining = Math.max(0, o.chicks - allocated);
                return (
                  <tr key={o.id}>
                    <Td>{formatDate(o.date)}</Td>
                    <Td>{o.name}</Td>
                    <Td>{o.product}</Td>
                    <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                    <Td className="text-right">{allocated.toLocaleString()}</Td>
                    <Td className="text-right">{remaining.toLocaleString()}</Td>
                    <Td>
                      {remaining > 0 ? (
                        canPropose ? (
                          <Button size="sm" onClick={() => setAllocFor(o)}>Allocate</Button>
                        ) : (
                          <span className="text-xs text-muted">—</span>
                        )
                      ) : (
                        <Pill tone="green">Fully allocated</Pill>
                      )}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {/* Allocations */}
      <Card>
        <CardHeader title="Allocations" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Batch</Th>
              <Th>Product</Th>
              <Th className="text-right">Qty</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {allocations.length === 0 ? (
              <EmptyRow colSpan={6} text="No allocations yet." />
            ) : (
              allocations
                .slice()
                .sort((a, b) => (a.on < b.on ? 1 : -1))
                .map((a) => (
                  <tr key={a.id}>
                    <Td>{orderName(a.orderId)}</Td>
                    <Td>{batchNo(a.batchId)}</Td>
                    <Td>{a.productType}</Td>
                    <Td className="text-right">{a.quantity.toLocaleString()}</Td>
                    <Td>
                      <Pill
                        tone={
                          a.status === "approved" ? "green"
                          : a.status === "finalized" ? "gold"
                          : a.status === "cancelled" ? "red"
                          : "info"
                        }
                      >
                        {a.status}
                      </Pill>
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {a.status === "proposed" && canFinalize && (
                          <Button size="sm" onClick={() => setAllocStatus(a, "finalized", "Finalized allocation")}>Finalize</Button>
                        )}
                        {a.status === "finalized" && canApprove && (
                          <Button size="sm" onClick={() => setAllocStatus(a, "approved", "Approved allocation")}>Approve</Button>
                        )}
                        {a.status === "approved" && canDispatch && (
                          <Button size="sm" variant="secondary" onClick={() => setDispatchFor(a)}>Dispatch</Button>
                        )}
                        {a.status !== "cancelled" && a.status !== "approved" && canFinalize && (
                          <Button size="sm" variant="ghost" onClick={() => cancelAllocation(a)}>Cancel</Button>
                        )}
                      </div>
                    </Td>
                  </tr>
                ))
            )}
          </tbody>
        </TableWrap>
      </Card>

      {/* Dispatch tracking */}
      <Card>
        <CardHeader title="Dispatch & delivery" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Client</Th>
              <Th>Batch</Th>
              <Th className="text-right">Qty</Th>
              <Th>Pickup</Th>
              <Th>Carrier</Th>
              <Th>Dispatched</Th>
              <Th>Status</Th>
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {dispatches.length === 0 ? (
              <EmptyRow colSpan={8} text="No dispatches yet." />
            ) : (
              dispatches
                .slice()
                .sort((a, b) => (a.dispatchedAt < b.dispatchedAt ? 1 : -1))
                .map((d) => (
                  <tr key={d.id}>
                    <Td>{orderName(d.orderId)}</Td>
                    <Td>{batchNo(d.batchId)}</Td>
                    <Td className="text-right">{d.quantity.toLocaleString()}</Td>
                    <Td>{d.pickupLocation}</Td>
                    <Td>{d.carrier} <span className="text-xs text-muted">({d.carrierType})</span></Td>
                    <Td>{formatDate(d.dispatchedAt)}</Td>
                    <Td>
                      {d.deliveredAt ? <Pill tone="fulfilled">Delivered</Pill> : <Pill tone="gold">In transit</Pill>}
                    </Td>
                    <Td>
                      {!d.deliveredAt && canDispatch && (
                        <Button size="sm" onClick={() => confirmDelivery(d)}>Confirm delivery</Button>
                      )}
                    </Td>
                  </tr>
                ))
            )}
          </tbody>
        </TableWrap>
        {activeDispatches.length > 0 && (
          <p className="mt-2 text-xs text-muted">{activeDispatches.length} in transit.</p>
        )}
      </Card>

      {allocFor && (
        <AllocateModal
          order={allocFor}
          inventory={inventory.filter((i) => i.productType === allocFor.product && i.availableCount > 0)}
          batchNo={batchNo}
          remaining={Math.max(0, allocFor.chicks - (allocByOrder.get(allocFor.id) ?? 0))}
          onClose={() => setAllocFor(null)}
          onSave={proposeAllocation}
        />
      )}
      {dispatchFor && (
        <DispatchModal
          allocation={dispatchFor}
          onClose={() => setDispatchFor(null)}
          onSave={(pickup, carrier, carrierType) => doDispatch(dispatchFor, pickup, carrier, carrierType)}
        />
      )}
    </div>
  );
}

function AllocateModal({
  order, inventory, batchNo, remaining, onClose, onSave,
}: {
  order: SalesOrder;
  inventory: { batchId: string; availableCount: number }[];
  batchNo: (id: string) => string;
  remaining: number;
  onClose: () => void;
  onSave: (order: SalesOrder, batchId: string, qty: number) => void;
}) {
  const [batchId, setBatchId] = useState(inventory[0]?.batchId ?? "");
  const [qty, setQty] = useState(String(remaining));
  const [err, setErr] = useState<string | null>(null);
  const avail = inventory.find((i) => i.batchId === batchId)?.availableCount ?? 0;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Allocate chicks — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const n = Number(qty);
              if (!batchId) return setErr("Select a batch.");
              if (!(n > 0)) return setErr("Enter a quantity.");
              if (n > avail) return setErr(`Only ${avail} available in that batch.`);
              if (n > remaining) return setErr(`Order only needs ${remaining} more.`);
              onSave(order, batchId, n);
            }}
          >
            Allocate
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">{order.product} · needs {remaining.toLocaleString()} more chicks</p>
        {inventory.length === 0 ? (
          <p className="text-status-refunded">No available {order.product} chicks in inventory yet.</p>
        ) : (
          <>
            <Field label="Batch (available inventory)">
              <Select
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                options={inventory.map((i) => ({ value: i.batchId, label: `${batchNo(i.batchId)} · ${i.availableCount} available` }))}
              />
            </Field>
            <Field label="Quantity">
              <Input type="number" min={1} max={Math.min(avail, remaining)} value={qty} onChange={(e) => setQty(e.target.value)} />
            </Field>
          </>
        )}
        {err && <p className="text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

function DispatchModal({
  allocation, onClose, onSave,
}: {
  allocation: Allocation;
  onClose: () => void;
  onSave: (pickupLocation: string, carrier: string, carrierType: Dispatch["carrierType"]) => void;
}) {
  const [pickup, setPickup] = useState("");
  const [carrier, setCarrier] = useState("");
  const [carrierType, setCarrierType] = useState<Dispatch["carrierType"]>("vehicle");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="Dispatch chicks"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => {
            if (!pickup.trim()) return setErr("Enter the pickup location.");
            if (!carrier.trim()) return setErr(`Enter the ${carrierType}.`);
            onSave(pickup.trim(), carrier.trim(), carrierType);
          }}>Dispatch</Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-muted">{allocation.quantity.toLocaleString()} chicks · {allocation.productType}</p>
        <Field label="Pickup location">
          <Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="e.g. Hatchery gate / Kigali depot" />
        </Field>
        <Field label="Taken by">
          <Select value={carrierType} onChange={(e) => setCarrierType(e.target.value as Dispatch["carrierType"])}
            options={[{ value: "vehicle", label: "Vehicle" }, { value: "person", label: "Person" }]} />
        </Field>
        <Field label={carrierType === "vehicle" ? "Vehicle (plate)" : "Person"}>
          <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder={carrierType === "vehicle" ? "e.g. RAD 123 A" : "e.g. John Uwera"} />
        </Field>
        {err && <p className="text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

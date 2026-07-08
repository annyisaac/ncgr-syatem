"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { ActionsDropdown, type DropdownAction } from "@/components/ui/Dropdown";

import type { Order, Payment, User } from "@/lib/types";
import {
  allVerified,
  balance,
  isFullyPaid,
  orderTotal,
  paidAmount,
  toDeliver,
} from "@/lib/types";
import { formatRWF } from "@/lib/config";
import { formatDate, nowISO } from "@/lib/format";
import { visibleOrders } from "@/lib/permissions";
import { ordersPDF } from "@/lib/reports";
import {
  canAddPayment,
  canApproveDebt,
  canConfirm,
  canFulfill,
  confirmOrder,
  fulfillOrder,
  isDebtApproved,
  paymentCheckState,
  refundOrder,
  reorderPlan,
  withHistory,
} from "@/lib/orders";

type ModalState =
  | { type: "pay"; order: Order }
  | { type: "reschedule"; order: Order }
  | { type: "edit"; order: Order }
  | { type: "refund"; order: Order }
  | { type: "request"; order: Order }
  | { type: "requestDebt"; order: Order }
  | { type: "approveReq"; order: Order }
  | null;

const CHECK_LABEL: Record<string, string> = {
  none: "No payment",
  awaiting: "Awaiting checker",
  partial: "Partially checked",
  checked: "Checked ✓",
};

function OrdersInner() {
  const { user } = useAuth();
  const { orders, upsertOrder, setOrders } = useData();
  const { toast } = useToast();
  const search = useSearchParams();
  const tile = search.get("tile") ?? "all";
  const dateParam = search.get("date") ?? "";

  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState(dateParam);
  const [modal, setModal] = useState<ModalState>(null);

  // Keep the date filter in sync when arriving from the Deliveries calendar
  // (React's "adjust state during render" pattern — no effect needed).
  const [prevDateParam, setPrevDateParam] = useState(dateParam);
  if (prevDateParam !== dateParam) {
    setPrevDateParam(dateParam);
    setDateFilter(dateParam);
  }

  const role = user?.role;
  const isAdmin = role === "Admin";
  const isSales = role === "Tetra Zone Manager" || role === "Ross Order Receiver";
  const isChecker = role === "Tetra Payment Checker" || role === "Ross Payment Checker";
  const canAct = isAdmin || isSales;

  const rows = useMemo(() => {
    if (!user) return [];
    let list = visibleOrders(orders, user);

    // Only confirmed orders reach the payment checker (Admin sees all).
    if (isChecker) list = list.filter((o) => o.confirmedOk);

    // Dashboard tile filter.
    if (tile === "pending") list = list.filter((o) => o.status === "pending");
    else if (tile === "fulfilled") list = list.filter((o) => o.status === "fulfilled");
    else if (tile === "outstanding")
      list = list.filter((o) => o.status !== "refunded" && balance(o) > 0);
    else if (tile === "collected")
      list = list.filter((o) => allVerified(o));

    if (statusFilter !== "all") list = list.filter((o) => o.status === statusFilter);

    // Delivery-date filter (set when opened from the Deliveries calendar).
    if (dateFilter) list = list.filter((o) => o.date === dateFilter);

    const q = query.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (o) =>
          o.name.toLowerCase().includes(q) ||
          o.phone.toLowerCase().includes(q) ||
          o.payments.some((p) => p.ref.toLowerCase().includes(q))
      );
    }

    // When viewing a single delivery date, order by the delivery plan so
    // "Move up / down" is meaningful; otherwise newest delivery first.
    return list
      .slice()
      .sort((a, b) =>
        dateFilter
          ? a.plan - b.plan
          : a.date < b.date
            ? 1
            : a.date > b.date
              ? -1
              : a.plan - b.plan
      );
  }, [orders, user, isChecker, tile, statusFilter, dateFilter, query]);

  if (!user) return null;

  // ---- Action handlers -----------------------------------------------------
  function act(next: Order, message: string) {
    upsertOrder(next);
    toast(message);
  }

  function doConfirm(o: Order) {
    act(confirmOrder(o, user!), `Order confirmed for ${o.name}.`);
  }
  function doFulfill(o: Order, note?: string) {
    act(fulfillOrder(o, user!, note), `Order delivered for ${o.name}.`);
  }
  function doApproveDebt(o: Order) {
    act(
      fulfillOrder(o, user!, "Delivered — Debt approved"),
      `Delivered with debt approved for ${o.name}.`
    );
  }
  function doReorder(o: Order, dir: -1 | 1) {
    setOrders(reorderPlan(orders, o.id, dir));
  }

  function buildActions(o: Order): DropdownAction[] {
    // Payment checkers can record payments (they receive them), nothing else.
    if (isChecker) {
      const r = canAddPayment(o);
      return [
        {
          label: "Add payment",
          disabled: !!r,
          disabledReason: r ?? "",
          onClick: () => setModal({ type: "pay", order: o }),
        },
      ];
    }
    if (!canAct) return [];
    const acts: DropdownAction[] = [];

    if (!o.confirmedOk && o.status !== "refunded") {
      const r = canConfirm(o, isAdmin);
      acts.push({
        label:
          o.payments.length === 0 && isAdmin
            ? "Confirm order (no payment)"
            : "Confirm order",
        disabled: !!r,
        disabledReason: r ?? "",
        onClick: () => doConfirm(o),
      });
    }

    {
      const r = canAddPayment(o);
      acts.push({
        label: "Add payment",
        disabled: !!r,
        disabledReason: r ?? "",
        onClick: () => setModal({ type: "pay", order: o }),
      });
    }

    if (!o.deliverOk && o.status !== "refunded") {
      const r = canFulfill(o);
      if (r === null) {
        acts.push({ label: "Fulfill (deliver)", onClick: () => doFulfill(o) });
      } else if (isAdmin && isFullyPaid(o) && !allVerified(o)) {
        acts.push({
          label: "Deliver — override unchecked",
          onClick: () => doFulfill(o, "Delivered — override (payments unchecked)"),
        });
      }
      if (isAdmin && canApproveDebt(o) === null) {
        acts.push({ label: "Approve debt (deliver)", onClick: () => doApproveDebt(o) });
      }
    }

    if (!o.deliverOk && o.status !== "refunded") {
      acts.push({ label: "Reschedule", onClick: () => setModal({ type: "reschedule", order: o }) });
      acts.push({ label: "Edit", onClick: () => setModal({ type: "edit", order: o }) });
    }

    if (isAdmin && o.status !== "refunded") {
      acts.push({
        label: "Refund",
        danger: true,
        onClick: () => setModal({ type: "refund", order: o }),
      });
    }

    if (isSales && o.status !== "refunded" && !o.request) {
      acts.push({
        label: "Request refund / compensation",
        onClick: () => setModal({ type: "request", order: o }),
      });
      // Salespeople cannot deliver on debt themselves — they ask the Admin.
      if (o.confirmedOk && !o.deliverOk && balance(o) > 0) {
        acts.push({
          label: "Request delivery on debt",
          onClick: () => setModal({ type: "requestDebt", order: o }),
        });
      }
    }

    if (isAdmin && o.request?.status === "open") {
      acts.push({
        label: "Approve request",
        onClick: () => setModal({ type: "approveReq", order: o }),
      });
      acts.push({
        label: "Reject request",
        danger: true,
        onClick: () => {
          act(
            withHistory({ ...o, request: { ...o.request!, status: "rejected" } }, user!, "Rejected request"),
            "Request rejected."
          );
        },
      });
    }

    acts.push({ label: "Move up in plan", onClick: () => doReorder(o, -1) });
    acts.push({ label: "Move down in plan", onClick: () => doReorder(o, 1) });

    return acts;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">
          {role === "Tetra Zone Manager" ? "Zone Orders" : "Orders"}
        </h1>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() =>
              rows.length
                ? ordersPDF(rows, tile === "all" ? "All orders" : tile)
                : toast("Nothing to export.", "info")
            }
          >
            Download PDF
          </Button>
          {canAct && (
            <Link href="/orders/new">
              <Button>New Order</Button>
            </Link>
          )}
        </div>
      </div>

      {(tile !== "all" || dateFilter) && (
        <div className="flex flex-wrap items-center gap-2">
          {tile !== "all" && <Pill tone="info">Filtered: {tile}</Pill>}
          {dateFilter && (
            <Pill tone="gold">Delivery date: {formatDate(dateFilter)}</Pill>
          )}
          <button
            type="button"
            onClick={() => setDateFilter("")}
            className="text-xs text-gold-dark underline"
          >
            {dateFilter ? "Show all dates" : ""}
          </button>
          {tile !== "all" && (
            <Link href="/orders" className="text-xs text-gold-dark underline">
              Clear filter
            </Link>
          )}
        </div>
      )}

      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grow">
            <Field label="Search (client, phone, or transaction ID)">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to search…"
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Status">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={[
                  { value: "all", label: "All statuses" },
                  { value: "pending", label: "Pending" },
                  { value: "fulfilled", label: "Fulfilled" },
                  { value: "refunded", label: "Refunded" },
                ]}
              />
            </Field>
          </div>
          <div className="w-44">
            <Field label="Delivery date">
              <Input
                type="date"
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
              />
            </Field>
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader title={`${rows.length} order(s)`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Delivery</Th>
              <Th>Product</Th>
              <Th>Client</Th>
              <Th>District / Sector</Th>
              <Th>DSR</Th>
              <Th className="text-right">Chicks</Th>
              <Th className="text-right">To deliver</Th>
              <Th className="text-right">Total</Th>
              <Th className="text-right">Paid</Th>
              <Th className="text-right">Balance</Th>
              <Th>Status</Th>
              <Th>Payment Check</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={13} text="No orders match." />
            ) : (
              rows.map((o) => {
                const cs = paymentCheckState(o);
                return (
                  <tr key={o.id}>
                    <Td>{formatDate(o.date)}</Td>
                    <Td>{o.product}</Td>
                    <Td>
                      <div className="font-medium">{o.name}</div>
                      <div className="text-xs text-ink/50">{o.phone}</div>
                    </Td>
                    <Td>
                      {o.district}
                      <div className="text-xs text-ink/50">{o.sector}</div>
                    </Td>
                    <Td>{o.dsr ?? "—"}</Td>
                    <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                    <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                    <Td className="text-right">{formatRWF(orderTotal(o))}</Td>
                    <Td className="text-right">{formatRWF(paidAmount(o))}</Td>
                    <Td className="text-right">{formatRWF(balance(o))}</Td>
                    <Td>
                      <div className="flex flex-col gap-1">
                        <Pill
                          tone={
                            o.status === "fulfilled"
                              ? "fulfilled"
                              : o.status === "refunded"
                                ? "refunded"
                                : o.confirmedOk
                                  ? "gold"
                                  : "pending"
                          }
                        >
                          {o.status === "pending" && !o.confirmedOk
                            ? "Not confirmed"
                            : o.status === "pending"
                              ? "Confirmed"
                              : o.status}
                        </Pill>
                        {isDebtApproved(o) && <Pill tone="refunded">Debt approved</Pill>}
                        {o.request?.status === "open" && (
                          <Pill tone="info">Request: {o.request.kind}</Pill>
                        )}
                      </div>
                    </Td>
                    <Td>
                      {CHECK_LABEL[cs.state]}
                      {cs.state === "partial" && ` (${cs.verified}/${cs.total})`}
                    </Td>
                    <Td>
                      {canAct || isChecker ? (
                        <ActionsDropdown actions={buildActions(o)} />
                      ) : (
                        <span className="text-xs text-ink/40">View only</span>
                      )}
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {/* Modals */}
      {modal?.type === "pay" && (
        <PayModal
          order={modal.order}
          user={user}
          onClose={() => setModal(null)}
          onSave={(payment) => {
            act(
              withHistory(
                { ...modal.order, payments: [...modal.order.payments, payment] },
                user,
                `Recorded payment ${payment.amt.toLocaleString()} RWF (ref ${payment.ref})`
              ),
              "Payment added."
            );
            setModal(null);
          }}
        />
      )}

      {modal?.type === "reschedule" && (
        <RescheduleModal
          order={modal.order}
          onClose={() => setModal(null)}
          onSave={(date) => {
            act(
              withHistory({ ...modal.order, date, created: date }, user, `Rescheduled to ${date}`),
              "Order rescheduled."
            );
            setModal(null);
          }}
        />
      )}

      {modal?.type === "edit" && (
        <EditModal
          order={modal.order}
          onClose={() => setModal(null)}
          onSave={(patch) => {
            act(withHistory({ ...modal.order, ...patch }, user, "Edited order"), "Order updated.");
            setModal(null);
          }}
        />
      )}

      {modal?.type === "refund" && (
        <ReasonModal
          title="Refund order"
          label="Reason for refund"
          confirmLabel="Refund order"
          danger
          onClose={() => setModal(null)}
          onSave={(reason) => {
            act(refundOrder(modal.order, reason, user), "Order refunded.");
            setModal(null);
          }}
        />
      )}

      {modal?.type === "request" && (
        <RequestModal
          onClose={() => setModal(null)}
          onSave={(kind, reason) => {
            act(
              withHistory(
                { ...modal.order, request: { kind, reason, by: user.email, on: nowISO(), status: "open" } },
                user,
                `Requested ${kind} — ${reason}`
              ),
              "Request submitted for Admin approval."
            );
            setModal(null);
          }}
        />
      )}

      {modal?.type === "requestDebt" && (
        <ReasonModal
          title="Request delivery on debt"
          label="Reason (why deliver before full payment?)"
          confirmLabel="Send request to Admin"
          onClose={() => setModal(null)}
          onSave={(reason) => {
            act(
              withHistory(
                { ...modal.order, request: { kind: "debt", reason, by: user.email, on: nowISO(), status: "open" } },
                user,
                `Requested delivery on debt — ${reason}`
              ),
              "Debt-delivery request sent to Admin."
            );
            setModal(null);
          }}
        />
      )}

      {modal?.type === "approveReq" && modal.order.request && (
        <ApproveRequestModal
          order={modal.order}
          onClose={() => setModal(null)}
          onApprove={(extraChicks) => {
            const o = modal.order;
            const req = o.request!;
            if (req.kind === "refund") {
              act(refundOrder(o, `Approved refund — ${req.reason}`, user), "Refund approved.");
            } else if (req.kind === "debt") {
              const delivered = fulfillOrder(o, user, "Delivered — Debt approved (requested)");
              act(
                { ...delivered, request: { ...req, status: "approved" } },
                "Delivery on debt approved."
              );
            } else {
              act(
                withHistory(
                  {
                    ...o,
                    comp: o.comp + extraChicks,
                    request: { ...req, status: "approved" },
                  },
                  user,
                  `Approved compensation of ${extraChicks} free chicks — ${req.reason}`
                ),
                "Compensation approved."
              );
            }
            setModal(null);
          }}
        />
      )}
    </div>
  );
}

export default function OrdersPage() {
  return (
    <Suspense fallback={<div className="text-ink/60">Loading…</div>}>
      <OrdersInner />
    </Suspense>
  );
}

// ---------------------------------------------------------------------------
// Modals
// ---------------------------------------------------------------------------

function PayModal({
  order,
  user,
  onClose,
  onSave,
}: {
  order: Order;
  user: User;
  onClose: () => void;
  onSave: (p: Payment) => void;
}) {
  const [amt, setAmt] = useState("");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Add payment — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const n = Number(amt);
              if (!n || n <= 0) return setErr("Enter an amount greater than zero.");
              if (!ref.trim()) return setErr("Enter the transaction ID.");
              onSave({ amt: n, ref: ref.trim(), on: nowISO(), by: user.email, verified: false });
            }}
          >
            Save payment
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink/60">
          Balance: <strong>{formatRWF(balance(order))}</strong>
        </p>
        <Field label="Amount (RWF)">
          <Input type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} />
        </Field>
        <Field label="Transaction ID">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} />
        </Field>
        {err && <p className="text-sm text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

function RescheduleModal({
  order,
  onClose,
  onSave,
}: {
  order: Order;
  onClose: () => void;
  onSave: (date: string) => void;
}) {
  const [date, setDate] = useState(order.date);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reschedule — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => date && onSave(date)}>Save new date</Button>
        </>
      }
    >
      <Field label="New delivery date">
        <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      </Field>
    </Modal>
  );
}

function EditModal({
  order,
  onClose,
  onSave,
}: {
  order: Order;
  onClose: () => void;
  onSave: (patch: Partial<Order>) => void;
}) {
  const [name, setName] = useState(order.name);
  const [phone, setPhone] = useState(order.phone);
  const [chicks, setChicks] = useState(String(order.chicks));
  const [comp, setComp] = useState(String(order.comp));
  const [price, setPrice] = useState(String(order.price));
  return (
    <Modal
      open
      onClose={onClose}
      title={`Edit order — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() =>
              onSave({
                name: name.trim(),
                phone: phone.trim(),
                chicks: Number(chicks) || order.chicks,
                comp: Number(comp) || 0,
                price: Number(price) || order.price,
              })
            }
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Client name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
        <Field label="Chicks"><Input type="number" value={chicks} onChange={(e) => setChicks(e.target.value)} /></Field>
        <Field label="Compensated chicks"><Input type="number" value={comp} onChange={(e) => setComp(e.target.value)} /></Field>
        <Field label="Unit price"><Input type="number" value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}

function ReasonModal({
  title,
  label,
  confirmLabel,
  danger,
  onClose,
  onSave,
}: {
  title: string;
  label: string;
  confirmLabel: string;
  danger?: boolean;
  onClose: () => void;
  onSave: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            variant={danger ? "danger" : "primary"}
            onClick={() => (reason.trim() ? onSave(reason.trim()) : setErr("A reason is required."))}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <Field label={label}>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      {err && <p className="mt-2 text-sm text-status-refunded">{err}</p>}
    </Modal>
  );
}

function RequestModal({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (kind: "refund" | "compensation", reason: string) => void;
}) {
  const [kind, setKind] = useState<"refund" | "compensation">("compensation");
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title="Request refund / compensation"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => (reason.trim() ? onSave(kind, reason.trim()) : setErr("A reason is required."))}>
            Submit request
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="Request type">
          <Select
            value={kind}
            onChange={(e) => setKind(e.target.value as "refund" | "compensation")}
            options={[
              { value: "compensation", label: "Compensation (extra free chicks)" },
              { value: "refund", label: "Refund" },
            ]}
          />
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {err && <p className="text-sm text-status-refunded">{err}</p>}
        <p className="text-xs text-ink/50">Only Admin can approve this request.</p>
      </div>
    </Modal>
  );
}

function ApproveRequestModal({
  order,
  onClose,
  onApprove,
}: {
  order: Order;
  onClose: () => void;
  onApprove: (extraChicks: number) => void;
}) {
  const req = order.request!;
  const [extra, setExtra] = useState("");
  const isComp = req.kind === "compensation";
  const isDebt = req.kind === "debt";
  return (
    <Modal
      open
      onClose={onClose}
      title={`Approve ${req.kind}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onApprove(isComp ? Number(extra) || 0 : 0)}>
            Approve {req.kind}
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p className="text-ink/70">
          Requested by {req.by}. Reason: <em>{req.reason}</em>
        </p>
        {isComp ? (
          <Field label="Extra free chicks to add">
            <Input type="number" min={0} value={extra} onChange={(e) => setExtra(e.target.value)} />
          </Field>
        ) : isDebt ? (
          <p className="font-semibold text-gold-dark">
            Approving will deliver this order now, before it is fully paid. The
            outstanding balance stays recorded and it will be tagged
            &ldquo;Debt approved&rdquo;.
          </p>
        ) : (
          <p className="text-status-refunded">
            Approving will refund this order. This cannot be undone.
          </p>
        )}
      </div>
    </Modal>
  );
}

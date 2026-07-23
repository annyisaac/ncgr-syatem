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
import { SearchTimeBar } from "@/components/dashboard/DashKit";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { presetToRange, type PeriodPreset } from "@/lib/period";

import type { Order, Payment, User } from "@/lib/types";
import {
  allVerified,
  balance,
  customerCredit,
  isFullyPaid,
  orderTotal,
  paidAmount,
  toDeliver,
} from "@/lib/types";
import { formatRWF } from "@/lib/config";
import { formatDate, formatDateTime, nowISO, todayISO } from "@/lib/format";
import { visibleOrders } from "@/lib/permissions";
import { clientKey } from "@/lib/clients";
import { ordersPDF, invoicePDF, paymentProofPDF } from "@/lib/reports";
import {
  approveDebt,
  canAddPayment,
  canApproveDebt,
  canConfirm,
  canFulfill,
  canReject,
  confirmOrder,
  fulfillOrder,
  isClosed,
  isDebtApproved,
  paymentCheckState,
  refundOrder,
  rejectOrder,
  reorderPlan,
  rescheduleOrder,
  shortDeliver,
  withHistory,
} from "@/lib/orders";

type ModalState =
  | { type: "pay"; order: Order }
  | { type: "fulfill"; order: Order }
  | { type: "reschedule"; order: Order }
  | { type: "edit"; order: Order }
  | { type: "refund"; order: Order }
  | { type: "reject"; order: Order }
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
  const { orders, availability, upsertOrder, removeOrder, newId } = useData();
  const { toast } = useToast();
  const search = useSearchParams();
  const tile = search.get("tile") ?? "all";
  const dateParam = search.get("date") ?? "";
  // Deep-link from a notification: show just that one order.
  const orderParam = search.get("order") ?? "";

  // ?q= prefills the search (the dashboard's search bar hands off to here).
  const [query, setQuery] = useState(search.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState(dateParam);
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const range = presetToRange(preset, custom, todayISO());
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
  // Payment checkers now get the same order privileges as a seller (add + edit).
  const canSell = isSales || isChecker;
  const canAct = isAdmin || canSell;
  // Roles that see more than one zone need each order's zone spelled out.
  const showZone = isAdmin || role === "Tetra Payment Checker" || role === "Accountant";

  const rows = useMemo(() => {
    if (!user) return [];
    let list = visibleOrders(orders, user);

    // Arrived from a notification — show only that order, ignoring other filters.
    if (orderParam) return list.filter((o) => o.id === orderParam);

    // A pure payment checker only needs confirmed orders (payments follow
    // confirmation). The Tetra Payment Checker also acts as a zone manager, so
    // they see every order like a manager — including not-yet-confirmed ones,
    // which is what a creation notification links them to.
    if (role === "Ross Payment Checker") list = list.filter((o) => o.confirmedOk);

    // Dashboard tile filter.
    if (tile === "pending") list = list.filter((o) => o.status === "pending");
    else if (tile === "fulfilled") list = list.filter((o) => o.status === "fulfilled");
    else if (tile === "outstanding")
      list = list.filter((o) => !isClosed(o) && balance(o) > 0);
    else if (tile === "collected")
      list = list.filter((o) => allVerified(o));

    // One dropdown covers both the order status and the payment status.
    if (statusFilter !== "all") {
      list = list.filter((o) => {
        switch (statusFilter) {
          case "pending":
          case "fulfilled":
          case "refunded":
          case "rejected":
            return o.status === statusFilter;
          case "paid":
            return isFullyPaid(o);
          case "partial":
            return !isFullyPaid(o) && paidAmount(o) > 0;
          case "unpaid":
            return paidAmount(o) === 0;
          case "debt":
            return isDebtApproved(o) || !!o.debtOk;
          case "payrejected":
            return o.payments.some((p) => p.voided);
          default:
            return true;
        }
      });
    }
    if (productFilter !== "all") list = list.filter((o) => o.product === productFilter);

    // Delivery-date filter (a single date, set when opened from the Deliveries
    // calendar). The period dropdown filters by range when no single date is set.
    if (dateFilter) list = list.filter((o) => o.date === dateFilter);
    else if (range.from || range.to) list = list.filter((o) => inRange(o.date, range));

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
    // "Move up / down" is meaningful; otherwise oldest order (by creation
    // time) first.
    return list
      .slice()
      .sort((a, b) =>
        dateFilter
          ? a.plan - b.plan
          : a.createdAt < b.createdAt
            ? -1
            : a.createdAt > b.createdAt
              ? 1
              : 0
      );
  }, [orders, user, role, tile, statusFilter, productFilter, dateFilter, range, query, orderParam]);

  // Delivery dates the Admin has opened, for the delivery-date filter.
  const deliveryDateOptions = useMemo(
    () => [
      { value: "", label: "All delivery dates" },
      ...availability
        .slice()
        .sort((a, b) => (a.id < b.id ? -1 : 1))
        .map((a) => ({ value: a.id, label: formatDate(a.date) })),
    ],
    [availability]
  );

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
  function doDeliver(o: Order, delivered: number, nextDate: string) {
    // Full delivery — the ordinary path.
    if (delivered >= o.chicks) {
      doFulfill(o);
      return;
    }
    // Short delivery — bill what was given, carry the rest to a backorder.
    const { order, backorder } = shortDeliver(o, delivered, nextDate, user!, orders, newId);
    upsertOrder(order);
    upsertOrder(backorder);
    const carried = o.chicks - delivered;
    toast(
      `Delivered ${delivered.toLocaleString()} of ${o.chicks.toLocaleString()} — backorder for ${carried.toLocaleString()} created${backorder.creditApplied ? " (paid from credit)" : ""}.`
    );
  }
  function doApproveDebt(o: Order) {
    act(
      approveDebt(o, user!, "Approved delivery on debt"),
      `${o.name} approved for delivery on debt — it can now be allocated.`
    );
  }
  function doReorder(o: Order, dir: -1 | 1) {
    // Only the reordered rows change — save those, never the whole collection
    // (a full replace deletes orders this tab hasn't loaded yet).
    const next = reorderPlan(orders, o.id, dir);
    const before = new Map(orders.map((x) => [x.id, x]));
    next.filter((x) => before.get(x.id) !== x).forEach((x) => void upsertOrder(x));
  }

  function buildActions(o: Order): DropdownAction[] {
    if (!canAct) return [];
    const acts: DropdownAction[] = [];

    // Documents — a branded invoice for any order, and a proof for its most
    // recent verified payment. Available to every role that reaches this menu.
    acts.push({ label: "Download invoice", onClick: () => void invoicePDF(o) });
    const lastVerified = [...o.payments].reverse().find((p) => p.verified);
    if (lastVerified) acts.push({ label: "Payment proof", onClick: () => void paymentProofPDF(o, lastVerified) });

    if (!o.confirmedOk && !isClosed(o)) {
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

    if (!o.deliverOk && !isClosed(o)) {
      const r = canFulfill(o);
      if (r === null) {
        acts.push({ label: "Fulfill (deliver)", onClick: () => setModal({ type: "fulfill", order: o }) });
      } else if (isAdmin && isFullyPaid(o) && !allVerified(o)) {
        acts.push({
          label: "Deliver — override unchecked",
          onClick: () => doFulfill(o, "Delivered — override (payments unchecked)"),
        });
      }
      if (isAdmin && !o.debtOk && canApproveDebt(o) === null) {
        acts.push({ label: "Approve delivery on debt", onClick: () => doApproveDebt(o) });
      }
    }

    if (!o.deliverOk && !isClosed(o)) {
      acts.push({ label: "Reschedule", onClick: () => setModal({ type: "reschedule", order: o }) });
      acts.push({ label: "Edit", onClick: () => setModal({ type: "edit", order: o }) });
    }

    // Reject/cancel a pending order — Admin, Zone Manager, or Ross receiver.
    {
      const r = canReject(o);
      if (r === null) {
        acts.push({
          label: "Reject order",
          danger: true,
          onClick: () => setModal({ type: "reject", order: o }),
        });
      }
    }

    if (isAdmin && o.status !== "refunded" && o.status !== "rejected") {
      acts.push({
        label: "Refund",
        danger: true,
        onClick: () => setModal({ type: "refund", order: o }),
      });
    }

    // Admin only, irreversible — the row and its history are gone for good.
    if (isAdmin) {
      acts.push({
        label: "Delete order",
        danger: true,
        onClick: () => {
          if (
            !confirm(
              `Permanently delete ${o.name}'s order (${o.chicks.toLocaleString()} ${o.product}, ${formatDate(o.date)})?\n\n` +
                `This cannot be undone and its history is lost. To cancel an order instead, use Reject or Refund.`
            )
          )
            return;
          void removeOrder(o.id);
          toast(`Order for ${o.name} deleted.`);
        },
      });
    }

    if (canSell && !isClosed(o) && !o.request) {
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
      <div className="flex flex-wrap items-center justify-end gap-2">
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

      {orderParam && (
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone="gold">Showing one order from a notification</Pill>
          <Link href="/orders" className="text-xs text-gold-dark underline">Show all orders</Link>
        </div>
      )}

      {!orderParam && (tile !== "all" || dateFilter) && (
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

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <SearchTimeBar q={query} setQ={setQuery} placeholder="Search — client, phone, or transaction ID…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} />
        </div>
        {isAdmin && (
          <div className="w-44">
            <Select
              value={productFilter}
              onChange={(e) => setProductFilter(e.target.value)}
              options={[
                { value: "all", label: "All products" },
                { value: "Tetra Super Harco", label: "Tetra Super Harco" },
                { value: "Ross 308", label: "Ross 308" },
              ]}
            />
          </div>
        )}
        <div className="w-52">
          <Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            options={[
              { value: "all", label: "All statuses" },
              { value: "pending", label: "Pending" },
              { value: "fulfilled", label: "Fulfilled" },
              { value: "refunded", label: "Refunded" },
              { value: "rejected", label: "Rejected" },
              { value: "paid", label: "Payment: Fully paid" },
              { value: "partial", label: "Payment: Partially paid" },
              { value: "unpaid", label: "Payment: Unpaid" },
              { value: "debt", label: "Payment: On debt" },
              { value: "payrejected", label: "Payment: Rejected" },
            ]}
          />
        </div>
        <div className="w-48">
          <Select
            value={dateFilter}
            onChange={(e) => setDateFilter(e.target.value)}
            options={deliveryDateOptions}
          />
        </div>
      </div>

      <Card>
        <CardHeader title={`${rows.length} order(s)`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Delivery</Th>
              <Th>Product</Th>
              <Th>Client</Th>
              <Th>District / Sector</Th>
              <Th className="text-right">Chicks</Th>
              <Th className="text-right">Amount</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={8} text="No orders match." />
            ) : (
              rows.map((o) => {
                const cs = paymentCheckState(o);
                return (
                  <tr key={o.id}>
                    <Td>
                      {formatDate(o.date)}
                      <div className="text-xs text-ink/50">Ordered {formatDateTime(o.createdAt)}</div>
                    </Td>
                    <Td>
                      <Pill tone={o.product === "Ross 308" ? "info" : "gold"}>
                        {o.product === "Ross 308" ? "Ross" : "Tetra"}
                      </Pill>
                    </Td>
                    <Td>
                      <Link
                        href={`/clients/${encodeURIComponent(clientKey(o))}`}
                        className="font-medium text-gold-dark underline underline-offset-2 hover:text-gold"
                      >
                        {o.name}
                      </Link>
                      <div className="text-xs text-ink/50">{o.phone}</div>
                      {o.dsr && <div className="text-xs text-ink/50">DSR: {o.dsr}</div>}
                      {(() => {
                        const credit = customerCredit(orders, o);
                        return credit > 0 ? (
                          <div className="text-xs font-medium text-green">Credit: {formatRWF(credit)}</div>
                        ) : null;
                      })()}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <span>{o.district}</span>
                        {showZone && o.product === "Tetra Super Harco" && (
                          <Pill tone={o.zone === "Zone 2" ? "gold" : "info"}>{o.zone}</Pill>
                        )}
                      </div>
                      <div className="text-xs text-ink/50">{o.sector}</div>
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      {o.chicks.toLocaleString()}
                      {o.delivered != null && o.delivered !== o.chicks ? (
                        <div className="text-xs font-medium text-gold-dark">Delivered {o.delivered.toLocaleString()}</div>
                      ) : (
                        <div className="text-xs text-ink/50">→ {toDeliver(o).toLocaleString()} to deliver</div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <div className={`font-medium ${isFullyPaid(o) ? "text-green" : "text-ink"}`}>
                        {formatRWF(orderTotal(o))}
                      </div>
                      <div className="text-xs text-ink/50">
                        Paid {paidAmount(o).toLocaleString()} · Bal{" "}
                        <span className={balance(o) > 0 ? "font-semibold text-red" : ""}>
                          {balance(o).toLocaleString()}
                        </span>
                      </div>
                      {!!o.creditApplied && (
                        <div className="text-xs text-green">Credit applied {o.creditApplied.toLocaleString()}</div>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-col gap-1">
                        <Pill
                          tone={
                            o.status === "fulfilled"
                              ? "fulfilled"
                              : o.status === "refunded"
                                ? "refunded"
                                : o.status === "rejected"
                                  ? "red"
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
                        {o.backorderOf && <Pill tone="purple">Backorder</Pill>}
                        {o.debtOk && !o.deliverOk && <Pill tone="info">On debt</Pill>}
                        {isDebtApproved(o) && <Pill tone="refunded">Debt approved</Pill>}
                        {o.request?.status === "open" && (
                          <Pill tone="info">Request: {o.request.kind}</Pill>
                        )}
                        <span className="text-xs text-ink/50">
                          Check: {CHECK_LABEL[cs.state]}
                          {cs.state === "partial" && ` (${cs.verified}/${cs.total})`}
                        </span>
                      </div>
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

      {modal?.type === "fulfill" && (
        <FulfillModal
          order={modal.order}
          availability={availability}
          onClose={() => setModal(null)}
          onSave={(delivered, nextDate) => {
            doDeliver(modal.order, delivered, nextDate);
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
              rescheduleOrder(modal.order, date, user, orders),
              "Order rescheduled — placed first for that day."
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

      {modal?.type === "reject" && (
        <ReasonModal
          title="Reject order"
          label="Reason for rejecting this order"
          confirmLabel="Reject order"
          danger
          onClose={() => setModal(null)}
          onSave={(reason) => {
            act(rejectOrder(modal.order, reason, user), "Order rejected.");
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
              const cleared = approveDebt(o, user, "Approved delivery on debt (requested)");
              act(
                { ...cleared, request: { ...req, status: "approved" } },
                "Delivery on debt approved — order can now be allocated."
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

function FulfillModal({
  order,
  availability,
  onClose,
  onSave,
}: {
  order: Order;
  availability: { id: string; date: string; ross: number; tetra: number }[];
  onClose: () => void;
  onSave: (delivered: number, nextDate: string) => void;
}) {
  const [delivered, setDelivered] = useState(String(order.chicks));
  const openDates = useMemo(
    () =>
      availability
        .slice()
        .filter((a) => a.ross > 0 || a.tetra > 0)
        .sort((a, b) => (a.date < b.date ? -1 : 1)),
    [availability]
  );
  const [nextDate, setNextDate] = useState(openDates[0]?.id ?? order.date);
  const [err, setErr] = useState<string | null>(null);

  const n = Number(delivered) || 0;
  const short = n > 0 && n < order.chicks;
  const remaining = Math.max(0, order.chicks - n);

  return (
    <Modal
      open
      onClose={onClose}
      title={`Deliver — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (n <= 0) return setErr("Enter how many chicks were delivered.");
              if (n > order.chicks) return setErr(`Cannot deliver more than the ${order.chicks.toLocaleString()} ordered.`);
              if (short && !nextDate) return setErr("Pick a delivery date for the remaining chicks.");
              onSave(n, nextDate);
            }}
          >
            {short ? "Deliver & create backorder" : "Confirm delivery"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink/60">
          Ordered <strong>{order.chicks.toLocaleString()}</strong> chicks. Enter how
          many were actually delivered — if fewer, the rest carries to a backorder.
        </p>
        <Field label="Chicks delivered now">
          <Input type="number" min={1} max={order.chicks} value={delivered} onChange={(e) => setDelivered(e.target.value)} />
        </Field>
        {short && (
          <div className="space-y-3 rounded-lg border border-line p-3">
            <p className="text-sm">
              Remaining <strong className="text-gold-dark">{remaining.toLocaleString()}</strong> chicks →
              backorder. Any money already paid above {formatRWF(order.price * n)} is
              kept as the customer&apos;s credit and applied to it.
            </p>
            <Field label="Backorder delivery date">
              {openDates.length === 0 ? (
                <p className="text-sm text-status-refunded">No open dates — the backorder keeps this order&apos;s date until you reschedule it.</p>
              ) : (
                <Select
                  value={nextDate}
                  onChange={(e) => setNextDate(e.target.value)}
                  options={openDates.map((a) => ({ value: a.id, label: formatDate(a.date) }))}
                />
              )}
            </Field>
          </div>
        )}
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
            Approving clears this order for delivery on debt: it can be allocated
            to a route and sent out before it is fully paid. The outstanding
            balance stays recorded and the driver delivers it like any other stop.
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

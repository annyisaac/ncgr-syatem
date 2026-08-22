"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { uploadPaymentSlip } from "@/lib/db";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { ActionsDropdown, type DropdownAction } from "@/components/ui/Dropdown";
import { Pagination } from "@/components/ui/Pagination";
import { SearchTimeBar } from "@/components/dashboard/DashKit";
import { Kpi } from "@/components/dashboard/Kpi";
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
  settledAmount,
  toDeliver,
} from "@/lib/types";
import { formatRWF, formatMoney } from "@/lib/config";
import { formatDate, formatDateTime, nowISO, todayISO, isValidMomoRef, normalizePhone } from "@/lib/format";
import { visibleOrders, productForRole, dateHasProduct } from "@/lib/permissions";
import { smartMatch, suggest } from "@/lib/search";
import { clientKey } from "@/lib/clients";
import { ordersPDF, dsrOrdersPDF, invoicePDF, paymentProofPDF } from "@/lib/reports";
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
  oversoldGroups,
  oversoldKeys,
  paymentCheckState,
  refundOrder,
  rejectOrder,
  reverseRejection,
  reorderPlan,
  rescheduleOrder,
  shortDeliver,
  withHistory,
} from "@/lib/orders";

type ModalState =
  | { type: "pay"; order: Order }
  | { type: "fulfill"; order: Order }
  | { type: "reschedule"; order: Order }
  | { type: "requestReschedule"; order: Order }
  | { type: "fixPayment"; order: Order }
  | { type: "deletePayment"; order: Order }
  | { type: "edit"; order: Order }
  | { type: "refund"; order: Order }
  | { type: "reject"; order: Order }
  | { type: "reverseReject"; order: Order }
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

// Small inline icons for the header buttons and toolbar (no icon library).
const ico = {
  width: 16, height: 16, viewBox: "0 0 20 20", fill: "none",
  stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const,
};
const DownloadIcon = () => <svg {...ico}><path d="M10 3v9m0 0 3-3m-3 3-3-3M4 15.5h12" /></svg>;
const ListIcon = () => <svg {...ico}><path d="M7 6h9M7 10h9M7 14h9M3.5 6h.01M3.5 10h.01M3.5 14h.01" /></svg>;
const PlusIcon = () => <svg {...ico}><path d="M10 4v12M4 10h12" /></svg>;
const BoxIcon = () => <svg {...ico} width={14} height={14}><path d="M4 6.5 10 4l6 2.5v7L10 16l-6-2.5v-7Z M4 6.5 10 9l6-2.5M10 9v7" /></svg>;

function OrdersInner() {
  const { user } = useAuth();
  const { orders, availability, upsertOrder, removeOrder, newId, reload } = useData();
  const { toast } = useToast();
  const search = useSearchParams();
  const tile = search.get("tile") ?? "all";
  const dateParam = search.get("date") ?? "";
  // Deep-link from a notification: show just that one order.
  const orderParam = search.get("order") ?? "";
  // Deep-link from the "Payments to correct" card: open the correction modal.
  const fixParam = search.get("fix") ?? "";
  // Deep-link from a client's "Record payment": open the Add-payment modal.
  const payParam = search.get("pay") ?? "";

  // ?q= prefills the search (the dashboard's search bar hands off to here).
  const [query, setQuery] = useState(search.get("q") ?? "");
  const [statusFilter, setStatusFilter] = useState("all");
  // Clickable stat-card filter (Total / Fulfilled / Confirmed / Pending / Cancelled).
  const [cardFilter, setCardFilter] = useState<"all" | "fulfilled" | "confirmed" | "pending" | "cancelled">("all");
  const [productFilter, setProductFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState(dateParam);
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const range = presetToRange(preset, custom, todayISO());
  const [modal, setModal] = useState<ModalState>(null);
  // Admin bulk reschedule: selected order ids + the target delivery date.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDate, setBulkDate] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Keep the date filter in sync when arriving from the Deliveries calendar
  // (React's "adjust state during render" pattern — no effect needed).
  const [prevDateParam, setPrevDateParam] = useState(dateParam);
  if (prevDateParam !== dateParam) {
    setPrevDateParam(dateParam);
    setDateFilter(dateParam);
  }

  // Arriving with ?order=…&fix=1 → open the "Correct payment ID" modal straight
  // away (once the order is loaded), so "Correct" on the dashboard is one click.
  const [prevFix, setPrevFix] = useState("");
  if (fixParam && orderParam && prevFix !== orderParam) {
    const o = orders.find((x) => x.id === orderParam);
    if (o) {
      setPrevFix(orderParam);
      setModal({ type: "fixPayment", order: o });
    }
  }

  // Arriving with ?order=…&pay=1 (from a client's "Record payment") → open the
  // Add-payment modal for that order once it's loaded.
  const [prevPay, setPrevPay] = useState("");
  if (payParam && orderParam && prevPay !== orderParam) {
    const o = orders.find((x) => x.id === orderParam);
    if (o && o.status !== "rejected" && o.status !== "refunded") {
      setPrevPay(orderParam);
      setModal({ type: "pay", order: o });
    }
  }

  // Any filter change sends the table back to the first page.
  const filterSig = `${tile}|${cardFilter}|${statusFilter}|${productFilter}|${dateFilter}|${preset}|${custom.from}|${custom.to}|${query}|${orderParam}`;
  const [prevSig, setPrevSig] = useState(filterSig);
  if (prevSig !== filterSig) {
    setPrevSig(filterSig);
    setPage(1);
  }

  const role = user?.role;
  const isAdmin = role === "Admin";
  const isSales = role === "Tetra Zone Manager" || role === "Ross Order Receiver";
  const isChecker = role === "Tetra Payment Checker" || role === "Ross Payment Checker";
  const isAccountant = role === "Accountant";
  // The DSR-list export is hidden for the Ross seller and Ross payment checker.
  const canDsrList = role !== "Ross Order Receiver" && role !== "Ross Payment Checker";
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

    // Payment checkers see every order for their product — including
    // not-yet-confirmed ones — so they can record a payment and confirm it.

    // Dashboard tile filter.
    if (tile === "pending") list = list.filter((o) => o.status === "pending");
    else if (tile === "fulfilled") list = list.filter((o) => o.status === "fulfilled");
    else if (tile === "outstanding")
      list = list.filter((o) => !isClosed(o) && balance(o) > 0);
    else if (tile === "collected")
      list = list.filter((o) => allVerified(o));

    // Clickable stat-card filter — same classification the KPI counts use.
    if (cardFilter !== "all") {
      list = list.filter((o) => {
        const c =
          o.status === "refunded" || o.status === "rejected" ? "cancelled"
          : o.status === "fulfilled" ? "fulfilled"
          : o.confirmedOk ? "confirmed" : "pending";
        return c === cardFilter;
      });
    }

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
          case "backorder":
            return !!o.backorderOf;
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

    if (query.trim()) {
      list = list.filter((o) =>
        smartMatch(query, o.name, o.phone, o.district, o.sector, o.payments.map((p) => p.ref).join(" "))
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
  }, [orders, user, tile, cardFilter, statusFilter, productFilter, dateFilter, range, query, orderParam]);

  // As-you-type client-name suggestions from the orders this user can see.
  const searchSuggestions = useMemo(
    () => (user ? suggest(query, visibleOrders(orders, user), (o) => o.name, 6) : []),
    [query, orders, user]
  );

  // Oversold delivery dates: a date+product whose ordered chicks exceed the
  // number the admin made available (e.g. after they lowered it). Computed from
  // every order this user can see, not just the filtered rows.
  const oversold = useMemo(() => {
    if (!user) return { groups: [], keys: new Set<string>() };
    const vis = visibleOrders(orders, user);
    return { groups: oversoldGroups(vis, availability), keys: oversoldKeys(vis, availability) };
  }, [orders, availability, user]);

  // Delivery dates the Admin has opened, for the delivery-date filter — scoped to
  // the role's product (Ross roles see only Ross dates, Tetra roles only Tetra).
  const deliveryDateOptions = useMemo(() => {
    const prod = role ? productForRole(role) : undefined;
    // Open delivery dates from availability, plus any date that actually has
    // orders this user can see — so a date whose availability row was removed
    // (but still carries orders) stays filterable instead of disappearing.
    const dates = new Set<string>();
    for (const a of availability) if (dateHasProduct(a, prod)) dates.add(a.id);
    const vis = user ? visibleOrders(orders, user) : [];
    for (const o of vis) if (o.date && (!prod || o.product === prod)) dates.add(o.date);
    return [
      { value: "", label: "All delivery dates" },
      ...[...dates].sort().map((d) => ({ value: d, label: formatDate(d) })),
    ];
  }, [availability, role, orders, user]);

  // KPI aggregates over every order this user can see (all time, unfiltered).
  const stats = useMemo(() => {
    const all = user ? visibleOrders(orders, user) : [];
    let fulfilled = 0, confirmed = 0, pending = 0, cancelled = 0, value = 0;
    for (const o of all) {
      value += orderTotal(o);
      if (o.status === "refunded" || o.status === "rejected") cancelled++;
      else if (o.status === "fulfilled") fulfilled++;
      else if (o.confirmedOk) confirmed++;
      else pending++;
    }
    const total = all.length;
    const pct = (n: number) => (total ? `${((n / total) * 100).toFixed(1)}%` : "0%");
    return { total, fulfilled, confirmed, pending, cancelled, value, pct };
  }, [orders, user]);

  if (!user) return null;

  // The current page of rows (client-side pagination over the filtered set).
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = rows.slice((safePage - 1) * pageSize, safePage * pageSize);

  // ---- Action handlers -----------------------------------------------------
  function act(next: Order, message: string) {
    // Optimistic save; on a server rejection (e.g. a payment reference already
    // used on another order) tell the user and resync with the true DB state.
    upsertOrder(next)
      .then(() => toast(message))
      .catch((err) => {
        const m = err instanceof Error ? err.message : "";
        if (m.includes("DUPLICATE_PAYMENT_REF")) {
          const ref = m.split("DUPLICATE_PAYMENT_REF:")[1]?.trim();
          toast(`That transaction reference${ref ? ` (${ref})` : ""} is already recorded on another order — it can't be used twice.`, "error");
        } else if (m.includes("DUPLICATE_CUSTOMER")) {
          toast("This customer already has an order for that product and delivery date.", "error");
        } else {
          toast("Could not save — please try again.", "error");
        }
        void reload();
      });
  }

  // --- Admin bulk reschedule ------------------------------------------------
  function toggleSel(id: string) {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }
  const allRowsSelected = rows.length > 0 && rows.every((o) => selected.has(o.id));
  function toggleSelAll() {
    setSelected(allRowsSelected ? new Set() : new Set(rows.map((o) => o.id)));
  }
  function bulkReschedule() {
    if (!user || !bulkDate) return toast("Pick a new delivery date.", "error");
    const targets = [...selected]
      .map((id) => orders.find((o) => o.id === id))
      .filter((o): o is Order => !!o && o.status !== "refunded" && o.status !== "rejected");
    if (targets.length === 0) return toast("Nothing to reschedule (rejected/refunded orders are skipped).", "info");
    Promise.allSettled(targets.map((o) => upsertOrder(rescheduleOrder(o, bulkDate, user!, orders)))).then((res) => {
      const ok = res.filter((r) => r.status === "fulfilled").length;
      const failed = res.length - ok;
      if (failed) void reload();
      toast(
        failed ? `Rescheduled ${ok} order(s); ${failed} could not be saved.` : `Rescheduled ${ok} order(s) to ${formatDate(bulkDate)}.`,
        failed ? "error" : "success"
      );
    });
    setSelected(new Set());
    setBulkDate("");
  }
  function bulkDelete() {
    if (!user) return;
    const targets = [...selected].filter((id) => orders.some((o) => o.id === id));
    if (targets.length === 0) return;
    const withPay = orders.filter((o) => selected.has(o.id) && (o.payments?.length ?? 0) > 0).length;
    const warn = withPay > 0 ? `\n\nWARNING: ${withPay} of them have recorded payments.` : "";
    if (!confirm(`Permanently delete ${targets.length} selected order(s)?${warn}\n\nThis cannot be undone.`)) return;
    Promise.allSettled(targets.map((id) => removeOrder(id))).then((res) => {
      const ok = res.filter((r) => r.status === "fulfilled").length;
      const failed = res.length - ok;
      if (failed) void reload();
      toast(failed ? `Deleted ${ok} order(s); ${failed} failed.` : `Deleted ${ok} order(s).`, failed ? "error" : "success");
    });
    setSelected(new Set());
  }

  function deletePayment(order: Order, payIndex: number) {
    const p = order.payments[payIndex];
    const payments = order.payments.filter((_, i) => i !== payIndex);
    act(
      withHistory({ ...order, payments }, user!, `Deleted payment ${p.ref} (${formatRWF(p.amt)})`),
      "Payment deleted."
    );
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
    const acts: DropdownAction[] = [];

    // A checker couldn't find a transaction id in the statement and returned it
    // to be corrected, then re-verified. Open to the sellers/zone managers, the
    // Admin AND the accountant — even the accountant, who otherwise only views
    // orders here, gets this one action when a payment is waiting to be fixed.
    if ((isSales || isAdmin || isAccountant) && o.payments.some((p) => p.returnedForFix && !p.verified)) {
      acts.push({ label: "Correct payment ID", onClick: () => setModal({ type: "fixPayment", order: o }) });
    }

    if (!canAct) return acts;

    // Documents — a branded invoice for any order, and a proof for its most
    // recent verified payment. Available to every role that reaches this menu.
    acts.push({ label: "Download invoice", onClick: () => void invoicePDF(o) });
    const lastVerified = [...o.payments].reverse().find((p) => p.verified);
    if (lastVerified) acts.push({ label: "Payment proof", onClick: () => void paymentProofPDF(o, lastVerified) });

    // Remove a payment recorded in error. Available to whoever manages the
    // order's money here — sellers, zone managers, payment checkers, Admin.
    if (o.payments.length > 0) {
      acts.push({ label: "Delete payment", danger: true, onClick: () => setModal({ type: "deletePayment", order: o }) });
    }

    if (!o.confirmedOk && !isClosed(o)) {
      const r = canConfirm(o, isAdmin || isChecker);
      acts.push({
        label:
          o.payments.length === 0 && (isAdmin || isChecker)
            ? "Confirm order (no payment)"
            : "Confirm order",
        disabled: !!r,
        disabledReason: r ?? "",
        onClick: () => doConfirm(o),
      });
    }

    // A fulfilled order only keeps "Add payment" while it still owes money
    // (delivered on debt); once fully paid there is nothing more to record.
    if (!o.deliverOk || !isFullyPaid(o)) {
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
      // An order can only be changed by the person who created it — except the
      // Admin, who can change any order. Backorders remain Admin-only for Edit.
      const isMine = !!user?.email && o.by === user.email;
      if (isAdmin || isMine) {
        acts.push({ label: "Reschedule", onClick: () => setModal({ type: "reschedule", order: o }) });
      }
      if (isAdmin || (isMine && !o.backorderOf)) {
        acts.push({ label: "Edit", onClick: () => setModal({ type: "edit", order: o }) });
      }
    }

    // Admin can still correct an already-delivered (fulfilled) order.
    if (isAdmin && o.deliverOk && !isClosed(o)) {
      acts.push({ label: "Edit order", onClick: () => setModal({ type: "edit", order: o }) });
    }

    // Once delivered the date can't be changed outright — a reschedule goes
    // through Admin approval (one pending request at a time).
    if (o.deliverOk && !isClosed(o) && !o.request) {
      acts.push({ label: "Request reschedule", onClick: () => setModal({ type: "requestReschedule", order: o }) });
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

    // Admin can undo a rejection — restore the order to the live (pending) list.
    if (isAdmin && o.status === "rejected") {
      acts.push({
        label: "Reverse rejection",
        onClick: () => setModal({ type: "reverseReject", order: o }),
      });
    }

    // Refund stays for open orders and for fulfilled orders that still owe
    // money (delivered on debt); a fully-paid delivered order is settled.
    if (isAdmin && o.status !== "refunded" && o.status !== "rejected" && (!o.deliverOk || !isFullyPaid(o))) {
      acts.push({
        label: "Refund",
        danger: true,
        onClick: () => setModal({ type: "refund", order: o }),
      });
    }

    // Admin only, irreversible — the row and its history are gone for good.
    // Not offered once delivered: a fulfilled order must stay on record.
    if (isAdmin && !o.deliverOk) {
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

    // Admin handles every request kind; reschedule requests also go to the
    // sales owners of the channel — Zone Managers and Ross sellers.
    const openReq = o.request?.status === "open" ? o.request : null;
    const canDecide = openReq && (isAdmin || (openReq.kind === "reschedule" && isSales));
    if (canDecide) {
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

  // A human label of the active filters, so an exported file names its scope.
  const filterLabel = [
    tile !== "all" ? tile : null,
    statusFilter !== "all" ? statusFilter : null,
    productFilter !== "all" ? productFilter : null,
    dateFilter ? `date ${formatDate(dateFilter)}` : null,
    query.trim() ? `"${query.trim()}"` : null,
  ].filter(Boolean).join(", ") || "All orders";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="secondary"
          className="gap-2"
          onClick={() => (rows.length ? ordersPDF(rows, filterLabel) : toast("Nothing to export.", "info"))}
        >
          <DownloadIcon /> Download PDF
        </Button>
        {canDsrList && (
          <Button
            variant="secondary"
            className="gap-2"
            onClick={() => (rows.length ? dsrOrdersPDF(rows, filterLabel) : toast("Nothing to export.", "info"))}
          >
            <ListIcon /> DSR list (PDF)
          </Button>
        )}
        {canAct && (
          <Link href="/orders/new">
            <Button className="gap-2"><PlusIcon /> New Order</Button>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi compact icon="orders" tone="gold" value={stats.total.toLocaleString()} label="Total Orders" sub="All time" active={cardFilter === "all"} onClick={() => setCardFilter("all")} />
        <Kpi compact icon="check" tone="green" value={stats.fulfilled.toLocaleString()} label="Fulfilled" sub={stats.pct(stats.fulfilled)} active={cardFilter === "fulfilled"} onClick={() => setCardFilter((f) => (f === "fulfilled" ? "all" : "fulfilled"))} />
        <Kpi compact icon="orders" tone="blue" value={stats.confirmed.toLocaleString()} label="Confirmed" sub={stats.pct(stats.confirmed)} active={cardFilter === "confirmed"} onClick={() => setCardFilter((f) => (f === "confirmed" ? "all" : "confirmed"))} />
        <Kpi compact icon="pending" tone="amber" value={stats.pending.toLocaleString()} label="Pending" sub={stats.pct(stats.pending)} active={cardFilter === "pending"} onClick={() => setCardFilter((f) => (f === "pending" ? "all" : "pending"))} />
        <Kpi compact icon="cross" tone="red" value={stats.cancelled.toLocaleString()} label="Cancelled" sub={stats.pct(stats.cancelled)} active={cardFilter === "cancelled"} onClick={() => setCardFilter((f) => (f === "cancelled" ? "all" : "cancelled"))} />
        <Kpi compact icon="money" tone="purple" value={formatRWF(stats.value)} label="Total Order Value" sub="All time" />
      </div>

      {oversold.groups.length > 0 && (
        <div className="rounded-xl border border-red/30 bg-red-bg px-4 py-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 text-red" aria-hidden>⚠</span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-red">
                {oversold.groups.length} delivery {oversold.groups.length === 1 ? "date is" : "dates are"} oversold — orders exceed what&apos;s available.
              </p>
              <ul className="mt-1 space-y-0.5 text-ink">
                {oversold.groups.map((g) => (
                  <li key={`${g.date}|${g.product}`}>
                    <button type="button" onClick={() => setDateFilter(g.date)} className="font-medium text-gold-dark hover:underline">
                      {formatDate(g.date)}
                    </button>
                    {" · "}{g.product} — ordered {g.ordered.toLocaleString()} vs available {g.cap.toLocaleString()}{" "}
                    <span className="font-semibold text-red">(over by {g.over.toLocaleString()})</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

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

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:gap-3 sticky top-16 z-20 -mx-4 md:-mx-8 border-b border-line bg-cream/95 px-4 md:px-8 py-2.5 backdrop-blur">
        <div className="min-w-0 sm:flex-1">
          <SearchTimeBar q={query} setQ={setQuery} placeholder="Search — client, phone, district, or transaction ID…" preset={preset} setPreset={setPreset} custom={custom} setCustom={setCustom} suggestions={searchSuggestions} />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center sm:gap-3">
          {isAdmin && (
            <div className="w-full sm:w-44">
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
          <div className="w-full sm:w-52">
            <Select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              options={[
                { value: "all", label: "All statuses" },
                { value: "pending", label: "Pending" },
                { value: "fulfilled", label: "Fulfilled" },
                { value: "refunded", label: "Refunded" },
                { value: "rejected", label: "Rejected" },
                { value: "backorder", label: "Backorders" },
                { value: "paid", label: "Payment: Fully paid" },
                { value: "partial", label: "Payment: Partially paid" },
                { value: "unpaid", label: "Payment: Unpaid" },
                { value: "debt", label: "Payment: On debt" },
                { value: "payrejected", label: "Payment: Rejected" },
              ]}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              options={deliveryDateOptions}
            />
          </div>
        </div>
      </div>

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-gold-bg text-gold-dark"><BoxIcon /></span>
          <h3 className="text-[0.8rem] font-bold uppercase tracking-wide text-ink">{rows.length.toLocaleString()} order(s)</h3>
        </div>

        {isAdmin && selected.size > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-gold bg-gold-bg/30 p-3">
            <span className="text-sm font-semibold text-ink">{selected.size} selected</span>
            <label className="text-sm text-muted" htmlFor="bulk-reschedule-date">Reschedule to</label>
            <Input id="bulk-reschedule-date" type="date" value={bulkDate} onChange={(e) => setBulkDate(e.target.value)} className="w-auto" />
            <Button size="sm" onClick={bulkReschedule} disabled={!bulkDate}>Reschedule {selected.size} order(s)</Button>
            <span className="h-5 w-px bg-gold/40" aria-hidden />
            <Button size="sm" variant="danger" onClick={bulkDelete}>Delete {selected.size} order(s)</Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>Clear</Button>
          </div>
        )}
        <div className="hidden sm:block">
        <TableWrap>
          <thead>
            <tr>
              {isAdmin && (
                <Th className="w-8">
                  <input type="checkbox" checked={allRowsSelected} onChange={toggleSelAll} aria-label="Select all orders" className="h-4 w-4 accent-gold" />
                </Th>
              )}
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
              <EmptyRow colSpan={isAdmin ? 9 : 8} text="No orders match." />
            ) : (
              pageRows.map((o) => {
                const cs = paymentCheckState(o);
                return (
                  <tr key={o.id}>
                    {isAdmin && (
                      <Td>
                        <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSel(o.id)} aria-label={`Select ${o.name}`} className="h-4 w-4 accent-gold" />
                      </Td>
                    )}
                    <Td>
                      {formatDate(o.date)}
                      <div className="text-xs text-ink/50">Ordered {formatDateTime(o.createdAt)}</div>
                      {oversold.keys.has(`${o.date}|${o.product}`) && (
                        <div className="mt-1"><Pill tone="red">Oversold day</Pill></div>
                      )}
                    </Td>
                    <Td>
                      <Pill tone={o.product === "Ross 308" ? "info" : "gold"}>
                        {o.product === "Ross 308" ? "Ross" : "Tetra"}
                      </Pill>
                    </Td>
                    <Td>
                      <Link
                        href={`/clients/${encodeURIComponent(clientKey(o))}`}
                        className="font-medium text-gold-dark hover:text-gold"
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
                        {/* The customer's own district/sector — for DSR orders this differs from the DSR's location. */}
                        <span>{o.clientDistrict || o.district}</span>
                        {showZone && o.product === "Tetra Super Harco" && (
                          <Pill tone={o.zone === "Zone 2" ? "gold" : "info"}>{o.zone}</Pill>
                        )}
                      </div>
                      <div className="text-xs text-ink/50">{o.clientSector || o.sector}</div>
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
                        {formatMoney(orderTotal(o), o.currency)}
                      </div>
                      <div className="text-xs text-ink/50">
                        Paid {settledAmount(o).toLocaleString()} · Bal{" "}
                        <span className={balance(o) > 0 ? "font-semibold text-red" : ""}>
                          {Math.max(0, balance(o)).toLocaleString()}
                        </span>
                      </div>
                      {!!o.creditApplied && (
                        <div className="text-xs text-green">incl. {o.creditApplied.toLocaleString()} credit</div>
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
        </div>

        {/* Mobile: each order as a compact card — the wide table can't fit a phone. */}
        <div className="space-y-2.5 sm:hidden">
          {pageRows.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted">No orders match.</p>
          ) : pageRows.map((o) => {
            const cs = paymentCheckState(o);
            const tone = o.status === "fulfilled" ? "fulfilled" : o.status === "refunded" ? "refunded" : o.status === "rejected" ? "red" : o.confirmedOk ? "gold" : "pending";
            const label = o.status === "pending" && !o.confirmedOk ? "Not confirmed" : o.status === "pending" ? "Confirmed" : o.status;
            return (
              <div key={o.id} className="rounded-2xl border border-line bg-paper p-3.5 shadow-card">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-start gap-2">
                    {isAdmin && (
                      <input type="checkbox" checked={selected.has(o.id)} onChange={() => toggleSel(o.id)} aria-label={`Select ${o.name}`} className="mt-0.5 h-4 w-4 shrink-0 accent-gold" />
                    )}
                    <div className="min-w-0">
                      <Link href={`/clients/${encodeURIComponent(clientKey(o))}`} className="block truncate font-semibold text-gold-dark">{o.name}</Link>
                      <div className="text-xs text-ink/50">{o.phone}</div>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Pill tone={o.product === "Ross 308" ? "info" : "gold"}>{o.product === "Ross 308" ? "Ross" : "Tetra"}</Pill>
                    <Pill tone={tone}>{label}</Pill>
                  </div>
                </div>
                <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
                  <div>
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Delivery</p>
                    <p className="font-medium text-ink">{formatDate(o.date)}</p>
                  </div>
                  <div className="min-w-0">
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">District / Sector</p>
                    <p className="truncate font-medium text-ink">{o.clientDistrict || o.district}</p>
                    <p className="truncate text-xs text-ink/50">{o.clientSector || o.sector}</p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Chicks</p>
                    <p className="font-medium tabular-nums text-ink">{o.chicks.toLocaleString()}</p>
                    <p className="text-xs text-ink/50">→ {toDeliver(o).toLocaleString()} to deliver</p>
                  </div>
                  <div>
                    <p className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted">Amount</p>
                    <p className={`font-medium tabular-nums ${isFullyPaid(o) ? "text-green" : "text-ink"}`}>{formatMoney(orderTotal(o), o.currency)}</p>
                    <p className="text-xs text-ink/50">Bal <span className={balance(o) > 0 ? "font-semibold text-red" : ""}>{Math.max(0, balance(o)).toLocaleString()}</span></p>
                  </div>
                </div>
                {(() => { const credit = customerCredit(orders, o); return credit > 0 ? <p className="mt-2 text-xs font-medium text-green">Customer credit: {formatRWF(credit)}</p> : null; })()}
                <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5">
                  <span className="text-xs text-ink/50">Check: {CHECK_LABEL[cs.state]}{cs.state === "partial" && ` (${cs.verified}/${cs.total})`}</span>
                  {canAct || isChecker ? <ActionsDropdown actions={buildActions(o)} /> : <span className="text-xs text-ink/40">View only</span>}
                </div>
              </div>
            );
          })}
        </div>

        {rows.length > 0 && (
          <div className="mt-4 border-t border-line pt-4">
            <Pagination
              page={safePage}
              pageSize={pageSize}
              total={rows.length}
              noun="orders"
              onPageChange={setPage}
              onPageSizeChange={(s) => { setPageSize(s); setPage(1); }}
            />
          </div>
        )}
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
                `Recorded payment ${payment.amt.toLocaleString()} ${modal.order.currency ?? "RWF"}${payment.method ? ` via ${payment.method}` : ""} (ref ${payment.ref})`
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

      {modal?.type === "requestReschedule" && (
        <RescheduleModal
          order={modal.order}
          request
          onClose={() => setModal(null)}
          onSave={(date, reason) => {
            act(
              withHistory(
                { ...modal.order, request: { kind: "reschedule", reason, by: user.email, on: nowISO(), status: "open", date } },
                user,
                `Requested reschedule to ${formatDate(date)}${reason ? ` — ${reason}` : ""}`
              ),
              "Reschedule request submitted for Admin approval."
            );
            setModal(null);
          }}
        />
      )}

      {modal?.type === "fixPayment" && (
        <FixPaymentModal
          order={modal.order}
          onClose={() => setModal(null)}
          onSave={(fixes) => {
            const order = modal.order;
            const on = nowISO();
            // A reused-payment dispute (sent back by the Admin) must return to the
            // Admin to approve — the seller/checker can't finalize it.
            const dispute = fixes.some((f) => order.payments[f.index]?.reusedDispute);
            const payments = order.payments.map((p, i) => {
              const fx = fixes.find((f) => f.index === i);
              if (!fx) return p;
              if (p.reusedDispute) {
                return {
                  ...p, ref: fx.ref, refFixed: true, returnedForFix: undefined, verified: false,
                  pendingApproval: { by: user.email, on, refs: [fx.ref], note: "Corrected reused-payment reference — awaiting Admin approval." },
                  flag: "Reused payment corrected — awaiting Admin approval",
                };
              }
              return { ...p, ref: fx.ref, refFixed: true, returnedForFix: undefined, flag: undefined };
            });
            act(
              withHistory({ ...order, payments }, user, `Corrected returned payment id(s): ${fixes.map((f) => f.ref).join(", ")}`),
              dispute ? "Payment corrected — sent to the Admin to approve." : "Payment reference corrected — sent back to the checker to verify."
            );
            setModal(null);
          }}
        />
      )}

      {modal?.type === "deletePayment" && (
        <DeletePaymentModal
          order={rows.find((o) => o.id === modal.order.id) ?? modal.order}
          onClose={() => setModal(null)}
          onDelete={(payIndex) => deletePayment(rows.find((o) => o.id === modal.order.id) ?? modal.order, payIndex)}
        />
      )}

      {modal?.type === "edit" && (
        <EditModal
          order={modal.order}
          isAdmin={isAdmin}
          onClose={() => setModal(null)}
          onSave={(patch) => {
            const o = modal.order;
            // Changing the delivery date moves the order (re-slots its plan) like a
            // reschedule; the other field edits are merged on top.
            const base = patch.date && patch.date !== o.date ? rescheduleOrder(o, patch.date, user, orders) : o;
            let next = withHistory({ ...base, ...patch }, user, "Edited order");
            // Keep an allocated order's delivery count in step with the edit until
            // it's delivered, so availability (ordered) and delivery planning
            // (allocated) never drift apart after an edit.
            if (next.deliveryChicks != null && !next.deliverOk) {
              const td = toDeliver(next);
              if (td !== next.deliveryChicks) next = { ...next, deliveryChicks: td };
            }
            act(next, "Order updated.");
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

      {modal?.type === "reverseReject" && (
        <ReasonModal
          title="Reverse rejection"
          label="Reason for restoring this order"
          confirmLabel="Restore order"
          onClose={() => setModal(null)}
          onSave={(reason) => {
            const o = modal.order;
            // Restoring re-enters the one-live-order-per-customer-per-date rule,
            // so block if another live order already holds this customer's slot
            // for that date (the DB guard would reject it anyway).
            const key = normalizePhone(o.phone);
            const clash = orders.find(
              (x) =>
                x.id !== o.id &&
                x.date === o.date &&
                !isClosed(x) &&
                (key
                  ? normalizePhone(x.phone) === key
                  : o.name.trim() !== "" && x.name.trim().toLowerCase() === o.name.trim().toLowerCase())
            );
            if (clash) {
              toast(`${o.name} already has a live order for ${formatDate(o.date)}. Cancel or reschedule it before restoring this one.`, "error");
              return;
            }
            act(reverseRejection(o, reason, user), "Rejection reversed — order restored.");
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
            } else if (req.kind === "reschedule") {
              const moved = rescheduleOrder(o, req.date!, user, orders);
              act(
                { ...moved, request: { ...req, status: "approved" } },
                `Reschedule approved — moved to ${formatDate(req.date!)}.`
              );
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
  const cur = order.currency ?? "RWF";
  const [amt, setAmt] = useState("");
  const [ref, setRef] = useState("");
  const [method, setMethod] = useState<"MoMo" | "Bank">("MoMo");
  const [bankName, setBankName] = useState("");
  const [slipFile, setSlipFile] = useState<File | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const n = Number(amt);
    if (!n || n <= 0) return setErr("Enter an amount greater than zero.");
    if (!ref.trim()) return setErr("Enter the transaction ID.");
    if (method === "MoMo" && !isValidMomoRef(ref)) return setErr("MoMo transaction ID must be exactly 11 digits.");
    if (method === "Bank" && !bankName.trim()) return setErr("Enter the bank name.");
    if (method === "Bank" && !slipFile) return setErr("Upload the bank payment slip.");
    setSaving(true);
    let slipPath: string | undefined;
    if (method === "Bank" && slipFile) {
      try {
        slipPath = await uploadPaymentSlip(slipFile);
      } catch {
        setSaving(false);
        return setErr("Could not upload the slip — please try again.");
      }
    }
    onSave({
      amt: n,
      ref: ref.trim(),
      on: nowISO(),
      by: user.email,
      verified: false,
      method,
      ...(method === "Bank" ? { bankName: bankName.trim() } : {}),
      ...(slipPath ? { slipPath } : {}),
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Add payment — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save payment"}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-ink/60">
          Balance: <strong>{formatMoney(balance(order), cur)}</strong>
        </p>
        <Field label="Payment method">
          <Select
            value={method}
            onChange={(e) => setMethod(e.target.value as "MoMo" | "Bank")}
            options={[{ value: "MoMo", label: "Mobile Money (MoMo)" }, { value: "Bank", label: "Bank transfer" }]}
          />
        </Field>
        <Field label={`Amount (${cur})`}>
          <Input type="number" min={0} step={cur === "RWF" ? "1" : "0.01"} value={amt} onChange={(e) => setAmt(e.target.value)} />
        </Field>
        <Field label="Transaction ID">
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={method === "Bank" ? "Bank transfer reference" : "MoMo transaction ID"} />
        </Field>
        {method === "Bank" && (
          <>
            <Field label="Bank name">
              <Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. Bank of Kigali" />
            </Field>
            <Field label="Payment slip (image/PDF)">
              <Input type="file" accept="image/*,application/pdf" onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)} />
            </Field>
          </>
        )}
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
                // No open availability dates — still require a chosen date so the
                // backorder is moved to it (not left on the original date).
                <Input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
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
  request = false,
  onClose,
  onSave,
}: {
  order: Order;
  /** Post-delivery flow: collect a reason and submit for Admin approval. */
  request?: boolean;
  onClose: () => void;
  onSave: (date: string, reason: string) => void;
}) {
  const [date, setDate] = useState(order.date);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`${request ? "Request reschedule" : "Reschedule"} — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (!date) return;
              if (request && !reason.trim()) return setErr("Give a reason for the reschedule.");
              onSave(date, reason.trim());
            }}
          >
            {request ? "Send request to Admin" : "Save new date"}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <Field label="New delivery date">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        {request && (
          <Field label="Reason">
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why does this delivered order need a new date?" />
          </Field>
        )}
        {err && <p className="text-sm text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

function FixPaymentModal({
  order,
  onClose,
  onSave,
}: {
  order: Order;
  onClose: () => void;
  onSave: (fixes: { index: number; ref: string }[]) => void;
}) {
  const returned = order.payments
    .map((p, index) => ({ p, index }))
    .filter((x) => x.p.returnedForFix && !x.p.verified);
  const [refs, setRefs] = useState<Record<number, string>>(
    () => Object.fromEntries(returned.map((x) => [x.index, x.p.ref]))
  );
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Correct payment ID — ${order.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const fixes = returned.map((x) => ({ index: x.index, ref: (refs[x.index] ?? "").trim() }));
              if (fixes.some((f) => !f.ref)) return setErr("Enter the corrected transaction id for each payment.");
              onSave(fixes);
            }}
          >
            Send back to checker
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted">
          A payment checker couldn&apos;t find {returned.length > 1 ? "these transaction ids" : "this transaction id"} in the
          uploaded bank statement. Review and correct {returned.length > 1 ? "them" : "it"} — it goes back to the checker to re-verify.
        </p>
        {returned.map((x) => (
          <div key={x.index} className="rounded-md border border-line p-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-ink">{formatRWF(x.p.amt)}</span>
              <span className="text-xs text-muted">recorded {formatDate(x.p.on.slice(0, 10))}</span>
            </div>
            {x.p.flag && <p className="text-xs text-status-refunded">{x.p.flag}</p>}
            {x.p.returnedForFix?.note && <p className="text-xs text-muted">Checker note: {x.p.returnedForFix.note}</p>}
            <Field label="Transaction ID">
              <Input value={refs[x.index] ?? ""} onChange={(e) => setRefs({ ...refs, [x.index]: e.target.value })} />
            </Field>
          </div>
        ))}
        {err && <p className="text-sm text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

function DeletePaymentModal({
  order,
  onClose,
  onDelete,
}: {
  order: Order;
  onClose: () => void;
  onDelete: (payIndex: number) => void;
}) {
  const statusOf = (p: Payment) =>
    p.voided ? "Voided" : p.verified ? "Verified" : p.pendingApproval ? "Awaiting admin" : p.returnedForFix ? "Returned to seller" : "Unverified";
  return (
    <Modal
      open
      onClose={onClose}
      title={`Payments — ${order.name}`}
      footer={<Button variant="ghost" onClick={onClose}>Close</Button>}
    >
      <div className="space-y-2">
        <p className="text-sm text-muted">Delete a payment recorded in error — it is removed from the order and its paid total. This can&apos;t be undone.</p>
        {order.payments.length === 0 ? (
          <p className="text-sm text-muted">No payments on this order.</p>
        ) : (
          order.payments.map((p, i) => (
            <div key={i} className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2">
              <div className="text-sm">
                <div className="font-medium text-ink">{formatRWF(p.amt)} · <span className="font-mono text-xs">{p.ref}</span></div>
                <div className="text-xs text-muted">{statusOf(p)} · {formatDate(p.on.slice(0, 10))}{p.by ? ` · ${p.by}` : ""}</div>
              </div>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  if (confirm(`Delete this payment of ${formatRWF(p.amt)} (${p.ref})?\n\nThis removes it from the order and cannot be undone.`)) onDelete(i);
                }}
              >
                Delete
              </Button>
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

function EditModal({
  order,
  isAdmin,
  onClose,
  onSave,
}: {
  order: Order;
  isAdmin: boolean;
  onClose: () => void;
  onSave: (patch: Partial<Order>) => void;
}) {
  const cur = order.currency ?? "RWF";
  const [name, setName] = useState(order.name);
  const [phone, setPhone] = useState(order.phone);
  const [chicks, setChicks] = useState(String(order.chicks));
  const [comp, setComp] = useState(String(order.comp));
  const [price, setPrice] = useState(String(order.price));
  const [date, setDate] = useState(order.date);
  const [pickup, setPickup] = useState(order.pickupLocation ?? "");
  const [companyName, setCompanyName] = useState(order.companyName ?? "");
  const [companyTin, setCompanyTin] = useState(order.companyTin ?? "");
  const [consignee, setConsignee] = useState(order.consignee ?? "");
  const [consigneePhone, setConsigneePhone] = useState(order.consigneePhone ?? "");
  const [pays, setPays] = useState<string[]>(order.payments.map((p) => String(p.amt)));
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
                date: date || order.date,
                pickupLocation: pickup.trim() || undefined,
                companyName: companyName.trim() || undefined,
                companyTin: companyTin.trim() || undefined,
                consignee: consignee.trim() || undefined,
                consigneePhone: consigneePhone.trim() || undefined,
                ...(isAdmin && order.payments.length > 0
                  ? { payments: order.payments.map((p, i) => ({ ...p, amt: pays[i] !== undefined && pays[i] !== "" ? Number(pays[i]) : p.amt })) }
                  : {}),
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
        <Field label={`Unit price (${order.currency ?? "RWF"})`}><Input type="number" step={(order.currency ?? "RWF") === "RWF" ? "1" : "0.01"} value={price} onChange={(e) => setPrice(e.target.value)} /></Field>
        <Field label={order.backorderOf ? "Backorder delivery date" : "Delivery date"}><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Pickup location"><Input value={pickup} onChange={(e) => setPickup(e.target.value)} placeholder="e.g. Nyabugogo taxi park" /></Field>
      </div>
      <div className="mt-4 border-t border-line pt-3">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Company / business (optional — shown on invoice &amp; payment proof)</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Company name"><Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} /></Field>
          <Field label="Company TIN"><Input value={companyTin} onChange={(e) => setCompanyTin(e.target.value)} inputMode="numeric" /></Field>
          <Field label="Consignee"><Input value={consignee} onChange={(e) => setConsignee(e.target.value)} /></Field>
          <Field label="Consignee phone"><Input value={consigneePhone} onChange={(e) => setConsigneePhone(e.target.value)} /></Field>
        </div>
      </div>
      {isAdmin && order.payments.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Payments — edit amount ({cur})</p>
          <div className="space-y-2">
            {order.payments.map((p, i) => (
              <div key={i} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{p.ref || "—"}</p>
                  <p className="text-xs text-muted">
                    {p.method ?? "—"}{p.bankName ? ` · ${p.bankName}` : ""}
                    {p.voided ? " · Rejected" : p.verified ? " · Verified" : " · Unverified"}
                  </p>
                </div>
                <div className="w-32 shrink-0">
                  <Input type="number" min={0} step={cur === "RWF" ? "1" : "0.01"} value={pays[i] ?? ""} onChange={(e) => setPays((arr) => arr.map((v, j) => (j === i ? e.target.value : v)))} />
                </div>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Editing an amount corrects what was recorded — it does not change the customer&apos;s bank transaction.</p>
        </div>
      )}
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
  const isResched = req.kind === "reschedule";
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
        ) : isResched ? (
          <p className="font-semibold text-gold-dark">
            Approving moves this delivered order to{" "}
            {req.date ? formatDate(req.date) : "the requested date"} and places it
            first in that day&apos;s plan.
          </p>
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

"use client";

/**
 * Customer Care & Feedback.
 *
 * A post-delivery care board: delivered customers grouped by delivery date,
 * with KPI cards, filters, an expandable per-customer detail row (order +
 * follow-up timeline) and a customer profile panel. Payment checkers record
 * each customer's feedback on the follow-up call; a "needs vet" flag routes the
 * case to the hatchery vet, who follows it up to resolution.
 *
 * One feedback record per delivered order (keyed by the order id), carrying a
 * denormalized customer snapshot so the vet needs no access to sales orders.
 * Fields the sales data genuinely doesn't hold (e.g. delivery time) are omitted
 * rather than invented; derived fields (reference, payment status, amount) come
 * straight from the order.
 */

import { useMemo, useState } from "react";
import type { ReactNode, TextareaHTMLAttributes } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { cn } from "@/lib/cn";
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { visibleOrders } from "@/lib/permissions";
import { feedbackPDF, feedbackExcel, type FeedbackReportRow } from "@/lib/reports";
import {
  balance,
  orderTotal,
  paidAmount,
  sameCustomer,
  type CustomerFeedback,
  type FeedbackRating,
  type Order,
  type Role,
  type Route,
  type User,
  type VetFollowUpStatus,
} from "@/lib/types";

const CAN_RECORD: Role[] = ["Admin", "Tetra Payment Checker", "Ross Payment Checker"];
const CAN_VET: Role[] = ["Admin", "Hatchery Veterinary"];

type Tone = "gold" | "green" | "blue" | "amber" | "purple" | "red";
type CareStatus = "pending" | "called" | "vet" | "resolved";

const STATUS_LABEL: Record<CareStatus, string> = {
  pending: "Pending",
  called: "Called",
  vet: "Vet",
  resolved: "Resolved",
};
const STATUS_TONE: Record<CareStatus, "red" | "amber" | "info" | "green"> = {
  pending: "red",
  called: "amber",
  vet: "info",
  resolved: "green",
};
const RATING_LABEL: Record<FeedbackRating, string> = {
  satisfied: "Satisfied",
  neutral: "Neutral",
  unsatisfied: "Unsatisfied",
};
const RATING_ACTIVE: Record<FeedbackRating, string> = {
  satisfied: "border-green bg-green-bg text-green",
  neutral: "border-amber bg-amber-bg text-amber",
  unsatisfied: "border-red bg-red-bg text-red",
};
const RATING_SCORE: Record<FeedbackRating, number> = { satisfied: 5, neutral: 3, unsatisfied: 1 };
const VET_LABEL: Record<VetFollowUpStatus, string> = {
  pending: "Awaiting vet",
  in_progress: "Vet following up",
  resolved: "Resolved",
};
const TONE_BG: Record<Tone, string> = {
  gold: "bg-gold-bg text-gold-dark",
  green: "bg-green-bg text-green",
  blue: "bg-blue-bg text-blue",
  amber: "bg-amber-bg text-amber",
  purple: "bg-purple-bg text-purple",
  red: "bg-red-bg text-red",
};

/** Shared grid template so the column header and rows line up. Every flexible
 * track is minmax(0,…) so cells truncate instead of forcing the row wider than
 * its container — the board fits without a horizontal scroll. */
const COLS =
  "grid grid-cols-[minmax(0,1.6fr)_minmax(0,0.95fr)_minmax(0,0.5fr)_minmax(0,0.95fr)_minmax(0,1.2fr)_104px] items-center gap-2";

// --- small helpers ----------------------------------------------------------

function isDelivered(o: Order): boolean {
  return (o.status === "fulfilled" || o.deliverOk === true) && o.status !== "refunded" && o.status !== "rejected";
}
function careStatus(fb?: CustomerFeedback): CareStatus {
  if (!fb) return "pending";
  if (fb.needsVet) return (fb.vetStatus ?? "pending") === "resolved" ? "resolved" : "vet";
  return "called";
}
function qtyOf(o: Order): number {
  return o.delivered ?? o.chicks;
}
function rwf(n: number): string {
  return `RWF ${Math.round(n).toLocaleString()}`;
}
function refOf(o: Order): string {
  return `NCGR-${o.date.replace(/-/g, "").slice(2)}-${o.id.slice(-4).toUpperCase()}`;
}
function payOf(o: Order): { label: string; tone: "green" | "amber" | "red" } {
  if (orderTotal(o) > 0 && balance(o) <= 0) return { label: "Paid", tone: "green" };
  if (paidAmount(o) > 0) return { label: "Partial", tone: "amber" };
  return { label: "Unpaid", tone: "red" };
}
function timeOf(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}
function whenLabel(iso: string): string {
  const day = iso.slice(0, 10);
  return day === todayISO() ? `Today ${timeOf(iso)}` : `${formatDate(day)} ${timeOf(iso)}`;
}
function lastActionOf(fb?: CustomerFeedback): string {
  if (!fb) return "Not called yet";
  if (fb.needsVet) {
    const last = fb.vetUpdates?.[fb.vetUpdates.length - 1];
    return last ? `${VET_LABEL[last.status]} · ${whenLabel(last.on)}` : `Flagged for vet · ${whenLabel(fb.on)}`;
  }
  return `Called · ${whenLabel(fb.on)}`;
}
function initials(name: string): string {
  return name.trim().slice(0, 1).toUpperCase() || "?";
}

interface TLEvent { on: string; title: string; sub?: string; tone: Tone }
function timelineFor(o: Order, fb: CustomerFeedback | undefined): TLEvent[] {
  const evs: TLEvent[] = [{ on: `${o.date}T08:00:00`, title: "Chicks delivered", tone: "green" }];
  if (fb) {
    evs.push({ on: fb.on, title: `Called by ${fb.byName ?? "checker"}`, sub: fb.note, tone: "blue" });
    if (fb.needsVet) evs.push({ on: fb.on, title: "Issue reported", sub: fb.vetReason, tone: "amber" });
    for (const u of fb.vetUpdates ?? []) {
      evs.push({ on: u.on, title: `${VET_LABEL[u.status]}${fb.vetName ? ` · ${fb.vetName}` : ""}`, sub: u.note, tone: u.status === "resolved" ? "green" : "purple" });
    }
  }
  return evs.sort((a, b) => (a.on < b.on ? -1 : 1));
}

// ---------------------------------------------------------------------------

export default function FeedbackPage() {
  const { user } = useAuth();
  const { orders, routes, users, customerFeedback, upsertCustomerFeedback } = useData();

  // Active vets a needs-vet case can be assigned to.
  const vets = useMemo(
    () => users.filter((u) => u.role === "Hatchery Veterinary" && u.active !== false),
    [users]
  );

  const [q, setQ] = useState("");
  const [date, setDate] = useState("");
  const [status, setStatus] = useState<"" | CareStatus>(user?.role === "Hatchery Veterinary" ? "vet" : "");
  const [salesperson, setSalesperson] = useState("");
  const [product, setProduct] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [edit, setEdit] = useState<Order | null>(null);
  const [vetCase, setVetCase] = useState<CustomerFeedback | null>(null);
  const [history, setHistory] = useState<Order | null>(null);

  const canRecord = !!user && CAN_RECORD.includes(user.role);
  const canVet = !!user && CAN_VET.includes(user.role);

  // Captured once so KPI aggregation stays pure across re-renders.
  const [now] = useState(() => Date.now());

  const fbByOrder = useMemo(
    () => new Map(customerFeedback.map((f) => [f.orderId, f])),
    [customerFeedback]
  );

  const delivered = useMemo(
    () => (user ? visibleOrders(orders, user).filter(isDelivered) : []),
    [orders, user]
  );

  const salespeople = useMemo(
    () => [...new Set(delivered.map((o) => o.dsr).filter((d): d is string => !!d))].sort(),
    [delivered]
  );

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return delivered
      .filter((o) => !date || o.date === date)
      .filter((o) => !product || o.product === product)
      .filter((o) => !salesperson || o.dsr === salesperson)
      .filter((o) => !status || careStatus(fbByOrder.get(o.id)) === status)
      // A vet only sees needs-vet cases assigned to them (or not yet assigned);
      // Admin and recorders see everything.
      .filter((o) => {
        if (user?.role !== "Hatchery Veterinary") return true;
        const fb = fbByOrder.get(o.id);
        if (!fb?.needsVet) return false;
        return !fb.vetAssignedTo || fb.vetAssignedTo === user.email;
      })
      .filter((o) => !term || o.name.toLowerCase().includes(term) || o.phone.includes(term))
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : a.name.localeCompare(b.name)));
  }, [delivered, date, product, salesperson, status, q, fbByOrder, user]);

  const groups = useMemo(() => {
    const m = new Map<string, Order[]>();
    for (const o of rows) {
      const arr = m.get(o.date) ?? [];
      arr.push(o);
      m.set(o.date, arr);
    }
    return [...m.entries()];
  }, [rows]);

  // KPI aggregates over the visible delivered set.
  const kpi = useMemo(() => {
    const weekAgo = new Date(now - 7 * 864e5).toISOString();
    let pending = 0, calledToday = 0, vet = 0, due = 0, rated = 0, ratingSum = 0, complaints = 0;
    for (const o of delivered) {
      const fb = fbByOrder.get(o.id);
      if (!fb) { pending++; continue; }
      if (fb.on.slice(0, 10) === todayISO()) calledToday++;
      const active = fb.needsVet && (fb.vetStatus ?? "pending") !== "resolved";
      if (active) vet++;
      if (active || fb.rating === "unsatisfied") due++;
      if (fb.rating) { rated++; ratingSum += RATING_SCORE[fb.rating]; }
      if (fb.rating === "unsatisfied" && fb.on >= weekAgo) complaints++;
    }
    return {
      pending, calledToday, vet, due, complaints,
      satisfaction: rated ? (ratingSum / rated).toFixed(1) : "—",
    };
  }, [delivered, fbByOrder, now]);

  // Report over exactly what the filters currently show, so a downloaded
  // report matches the board on screen. Admin-only (owner oversight).
  const report = useMemo(() => {
    const reportRows: FeedbackReportRow[] = rows.map((o) => ({ order: o, fb: fbByOrder.get(o.id) }));
    let pending = 0, called = 0, vet = 0, complaints = 0, rated = 0, ratingSum = 0;
    for (const { fb } of reportRows) {
      const k = careStatus(fb);
      if (k === "pending") pending++;
      else if (k === "called") called++;
      else vet++; // vet + resolved cases both needed the vet
      if (fb?.rating === "unsatisfied") complaints++;
      if (fb?.rating) { rated++; ratingSum += RATING_SCORE[fb.rating]; }
    }
    const parts: string[] = [];
    if (date) parts.push(`Delivery ${formatDate(date)}`);
    if (product) parts.push(product);
    if (salesperson) parts.push(salesperson);
    if (status) parts.push(STATUS_LABEL[status]);
    if (q.trim()) parts.push(`“${q.trim()}”`);
    return {
      rows: reportRows,
      summary: {
        customers: reportRows.length,
        pending, called, vet, complaints,
        satisfaction: rated ? (ratingSum / rated).toFixed(1) : "—",
      },
      filterLabel: parts.length ? parts.join(" · ") : "All delivered customers",
    };
  }, [rows, fbByOrder, date, product, salesperson, status, q]);

  // The profile panel only appears once a customer is explicitly clicked.
  const selectedOrder = useMemo(
    () => (selectedId ? orders.find((o) => o.id === selectedId) : undefined),
    [selectedId, orders]
  );

  if (!user) return null;

  const toggle = (d: string) =>
    setOpen((prev) => {
      const n = new Set(prev);
      if (n.has(d)) n.delete(d); else n.add(d);
      return n;
    });
  // Groups start expanded (first load shows the newest date's customers).
  const isOpen = (d: string, i: number) => (open.size === 0 ? i === 0 : open.has(d));

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-ink">Customer Care &amp; Feedback</h1>
          <p className="text-sm text-muted">Manage customer follow-ups and feedback after delivery</p>
        </div>
        <div className="flex items-center gap-2">
          {user.role === "Admin" && (
            <>
              <Button variant="secondary" size="sm" onClick={() => void feedbackPDF(report.rows, report.summary, report.filterLabel)}>
                Report (PDF)
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void feedbackExcel(report.rows, report.filterLabel)}>
                Excel
              </Button>
            </>
          )}
          <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1.5 text-sm text-muted">
            <Ico name="calendar" className="h-4 w-4" /> Today: {formatDate(todayISO())}
          </span>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        <Kpi tone="gold" icon="phone" value={kpi.pending} label="Pending Calls" sub="Need to be called" />
        <Kpi tone="green" icon="phone" value={kpi.calledToday} label="Called Today" sub="Completed calls" />
        <Kpi tone="blue" icon="stethoscope" value={kpi.vet} label="Vet Cases" sub="Active cases" />
        <Kpi tone="amber" icon="clock" value={kpi.due} label="Follow-ups Due" sub="Require attention" />
        <Kpi tone="purple" icon="star" value={kpi.satisfaction} label="Satisfaction" sub="Average rating" />
        <Kpi tone="red" icon="alert" value={kpi.complaints} label="Complaints" sub="This week" />
      </div>

      {/* Filters */}
      <div className="sticky top-16 z-20 flex flex-wrap items-end gap-3 rounded-2xl border border-line bg-paper p-4 shadow-card">
        <div className="w-40"><Field label="Delivery Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field></div>
        <div className="w-40">
          <Field label="Status">
            <Select value={status} onChange={(e) => setStatus(e.target.value as "" | CareStatus)}
              options={[{ value: "", label: "All Status" }, { value: "pending", label: "Pending Call" }, { value: "called", label: "Called" }, { value: "vet", label: "Vet Case" }, { value: "resolved", label: "Resolved" }]} />
          </Field>
        </div>
        <div className="w-48">
          <Field label="Salesperson">
            <Select value={salesperson} onChange={(e) => setSalesperson(e.target.value)}
              options={[{ value: "", label: "All Salespersons" }, ...salespeople.map((s) => ({ value: s, label: s }))]} />
          </Field>
        </div>
        <div className="w-44">
          <Field label="Product">
            <Select value={product} onChange={(e) => setProduct(e.target.value)}
              options={[{ value: "", label: "All Products" }, { value: "Ross 308", label: "Ross 308" }, { value: "Tetra Super Harco", label: "Tetra Super Harco" }]} />
          </Field>
        </div>
        <div className="ml-auto min-w-[220px] flex-1">
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted"><Ico name="search" className="h-4 w-4" /></span>
            <Input className="pl-9" placeholder="Search customer name or phone…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
      </div>

      {/* Board + profile (the profile only appears once a customer is clicked) */}
      <div className={cn("grid grid-cols-1 gap-4", selectedOrder && "xl:grid-cols-[minmax(0,1fr)_340px]")}>
        <div className="min-w-0 space-y-3">
          {groups.length === 0 ? (
            <div className="rounded-2xl border border-line bg-paper p-6 text-sm text-muted shadow-card">No delivered customers match these filters.</div>
          ) : (
            groups.map(([d, os], i) => {
              const openG = isOpen(d, i);
              return (
                <div key={d} className="overflow-hidden rounded-2xl border border-line bg-paper shadow-card">
                  <button onClick={() => toggle(d)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
                    <Ico name={openG ? "chevronDown" : "chevronRight"} className="h-4 w-4 text-muted" />
                    <span className="text-sm font-bold uppercase tracking-wide text-ink">Delivery date: {formatDate(d)}</span>
                    <Pill tone="gold" className="ml-1">{os.length} customers</Pill>
                  </button>
                  {openG && (
                    <div>
                      <div className={cn(COLS, "bg-onyx px-4 py-2 text-[0.6rem] font-bold uppercase tracking-wide text-white/80")}>
                        <span>Customer</span><span>Product</span><span>Chicks</span><span>Status</span><span>Last action</span><span className="text-right">Action</span>
                      </div>
                      {os.map((o) => (
                        <CareRow
                          key={o.id}
                          o={o}
                          fb={fbByOrder.get(o.id)}
                          routes={routes}
                          expanded={open.has(`row:${o.id}`)}
                          selected={selectedOrder?.id === o.id}
                          canRecord={canRecord}
                          canVet={canVet}
                          onSelect={() => setSelectedId(o.id)}
                          onExpand={() => toggle(`row:${o.id}`)}
                          onRecord={() => setEdit(o)}
                          onVet={(f) => setVetCase(f)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        {selectedOrder && (
          <CustomerPanel
            order={selectedOrder}
            orders={user ? visibleOrders(orders, user) : []}
            fbByOrder={fbByOrder}
            onHistory={(o) => setHistory(o)}
            onClose={() => setSelectedId(null)}
          />
        )}
      </div>

      {edit && (
        <RecordModal order={edit} existing={fbByOrder.get(edit.id)} user={user} vets={vets} onClose={() => setEdit(null)} save={upsertCustomerFeedback} />
      )}
      {vetCase && (
        <VetModal fb={vetCase} user={user} vets={vets} isAdmin={user.role === "Admin"} onClose={() => setVetCase(null)} save={upsertCustomerFeedback} />
      )}
      {history && (
        <HistoryModal order={history} fb={fbByOrder.get(history.id)} onClose={() => setHistory(null)} />
      )}
    </div>
  );
}

// --- KPI card ---------------------------------------------------------------

function Kpi({ tone, icon, value, label, sub }: { tone: Tone; icon: IcoName; value: ReactNode; label: string; sub: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-4 shadow-card">
      <div className="flex items-center justify-between">
        <span className={cn("flex h-11 w-11 items-center justify-center rounded-xl", TONE_BG[tone])}>
          <Ico name={icon} className="h-5 w-5" />
        </span>
        <span className="text-3xl font-extrabold leading-none text-ink">{value}</span>
      </div>
      <p className="mt-3 text-sm font-bold text-ink">{label}</p>
      <p className="text-xs text-muted">{sub}</p>
    </div>
  );
}

// --- One customer row (+ expandable detail) ---------------------------------

function CareRow({
  o, fb, routes, expanded, selected, canRecord, canVet, onSelect, onExpand, onRecord, onVet,
}: {
  o: Order;
  fb?: CustomerFeedback;
  routes: Route[];
  expanded: boolean;
  selected: boolean;
  canRecord: boolean;
  canVet: boolean;
  onSelect: () => void;
  onExpand: () => void;
  onRecord: () => void;
  onVet: (fb: CustomerFeedback) => void;
}) {
  const st = careStatus(fb);
  const route = o.routeId ? routes.find((r) => r.id === o.routeId) : undefined;
  const pay = payOf(o);
  return (
    <div className={cn("border-t border-line", selected && "bg-gold-bg/30")}>
      <div className={cn(COLS, "px-4 py-2.5 text-sm")}>
        <button onClick={onSelect} className="min-w-0 text-left">
          <span className="block truncate font-semibold text-ink">{o.name}</span>
          <span className="block truncate text-xs text-muted">{o.phone}</span>
        </button>
        <span className="truncate">{o.product}</span>
        <span>{qtyOf(o).toLocaleString()}</span>
        <span className="min-w-0">
          <Pill tone={STATUS_TONE[st]}>{STATUS_LABEL[st]}</Pill>
          {fb?.needsVet && <span className="mt-0.5 block truncate text-[0.68rem] text-muted">{fb.vetAssignedName ?? fb.vetName ?? "Unassigned"}</span>}
        </span>
        <span className="truncate text-xs text-muted">{lastActionOf(fb)}</span>
        <span className="flex items-center justify-end gap-1">
          <a href={`tel:${o.phone}`} title="Call" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-green hover:bg-green-bg"><Ico name="phone" className="h-4 w-4" /></a>
          {canRecord && (
            <button onClick={onRecord} title={fb ? "Edit feedback" : "Record feedback"} className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-gold-dark hover:bg-gold-bg"><Ico name="edit" className="h-4 w-4" /></button>
          )}
          <button onClick={onExpand} title="Details" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted hover:bg-grey-bg"><Ico name={expanded ? "chevronUp" : "chevronDown"} className="h-4 w-4" /></button>
        </span>
      </div>

      {expanded && (
        <div className="border-t border-line bg-cream/40 px-4 py-4">
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm sm:grid-cols-4">
            <Detail label="Location" value={o.district || "—"} />
            <Detail label="Salesperson" value={o.dsr || "—"} />
            <Detail label="Reference" value={refOf(o)} />
            <Detail label="Payment" value={<Pill tone={pay.tone}>{pay.label}</Pill>} />
            <Detail label="Delivery date" value={formatDate(o.date)} />
            <Detail label="Delivered by" value={route ? route.driver || route.name : "—"} />
            <Detail label="Qty delivered" value={qtyOf(o).toLocaleString()} />
            <Detail label="Amount" value={rwf(orderTotal(o))} />
          </div>

          <Stepper events={timelineFor(o, fb)} />

          {canVet && fb?.needsVet && (
            <div className="mt-3 flex justify-end">
              <Button size="sm" onClick={() => onVet(fb)}>{(fb.vetStatus ?? "pending") === "resolved" ? "Add vet note" : "Update follow-up"}</Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}

function Stepper({ events }: { events: TLEvent[] }) {
  if (events.length === 0) return null;
  return (
    <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
      {events.map((e, i) => (
        <div key={i} className="flex min-w-[130px] flex-1 items-start gap-2">
          <div className="flex flex-col items-center">
            <span className={cn("flex h-7 w-7 items-center justify-center rounded-full", TONE_BG[e.tone])}><Ico name="check" className="h-3.5 w-3.5" /></span>
          </div>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-ink">{e.title}</p>
            {e.sub && <p className="truncate text-[0.7rem] text-muted">{e.sub}</p>}
            <p className="text-[0.66rem] text-muted">{whenLabel(e.on)}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Right-hand customer profile --------------------------------------------

function CustomerPanel({
  order, orders, fbByOrder, onHistory, onClose,
}: {
  order: Order;
  orders: Order[];
  fbByOrder: Map<string, CustomerFeedback>;
  onHistory: (o: Order) => void;
  onClose: () => void;
}) {
  const mine = orders.filter((o) => sameCustomer(o, order)).sort((a, b) => (a.date < b.date ? 1 : -1));
  const fbs = mine.map((o) => fbByOrder.get(o.id)).filter((f): f is CustomerFeedback => !!f);
  const rated = fbs.filter((f) => f.rating);
  const avg = rated.length ? rated.reduce((s, f) => s + RATING_SCORE[f.rating!], 0) / rated.length : 0;
  const complaints = fbs.filter((f) => f.rating === "unsatisfied").length;
  const vetCases = fbs.filter((f) => f.needsVet).length;
  const last = mine[0] ?? order;
  const pay = payOf(last);

  return (
    <div className="space-y-4 rounded-2xl border border-line bg-paper p-5 shadow-card">
      <div className="flex items-center gap-3">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold text-lg font-extrabold text-[#231b04]">{initials(order.name)}</span>
        <div className="min-w-0">
          <p className="truncate font-bold text-ink">{order.name}</p>
          <p className="text-xs text-muted">{order.phone}</p>
          {order.district && <p className="text-xs text-muted">{order.district} District</p>}
        </div>
        <a href={`tel:${order.phone}`} className="ml-auto flex h-9 w-9 items-center justify-center rounded-full bg-green-bg text-green"><Ico name="phone" className="h-4 w-4" /></a>
        <button onClick={onClose} title="Close" className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-muted hover:bg-grey-bg"><Ico name="close" className="h-4 w-4" /></button>
      </div>

      <div className="rounded-xl border border-line bg-cream/40 p-3">
        <div className="flex items-center justify-between">
          <div>
            <Stars value={avg} />
            <p className="mt-0.5 text-xs text-muted">Average rating</p>
          </div>
          <span className="text-2xl font-extrabold text-ink">{avg ? avg.toFixed(1) : "—"}</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          <Stat n={mine.length} label="Orders" />
          <Stat n={complaints} label="Complaints" />
          <Stat n={vetCases} label="Vet Cases" />
        </div>
      </div>

      <div>
        <p className="mb-1.5 text-[0.62rem] font-semibold uppercase tracking-wide text-muted">Last order summary</p>
        <dl className="space-y-1.5 text-sm">
          <Line k="Delivery date" v={formatDate(last.date)} />
          <Line k="Product" v={last.product} />
          <Line k="Quantity" v={`${qtyOf(last).toLocaleString()} chicks`} />
          <Line k="Amount" v={rwf(orderTotal(last))} />
          <Line k="Payment status" v={<Pill tone={pay.tone}>{pay.label}</Pill>} />
          <Line k="Salesperson" v={last.dsr || "—"} />
        </dl>
      </div>

      <div>
        <p className="mb-2 text-[0.62rem] font-semibold uppercase tracking-wide text-muted">Timeline</p>
        <ol className="space-y-2.5">
          {timelineFor(last, fbByOrder.get(last.id)).map((e, i) => (
            <li key={i} className="flex gap-2.5">
              <span className={cn("mt-0.5 h-2.5 w-2.5 shrink-0 rounded-full", TONE_BG[e.tone])} />
              <div className="min-w-0">
                <p className="text-xs font-semibold text-ink">{e.title}</p>
                {e.sub && <p className="text-[0.7rem] text-muted">{e.sub}</p>}
                <p className="text-[0.66rem] text-muted">{whenLabel(e.on)}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>

      <Button className="w-full" onClick={() => onHistory(last)}>View full history</Button>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className="rounded-lg bg-paper p-2">
      <p className="text-lg font-extrabold text-ink">{n}</p>
      <p className="text-[0.62rem] text-muted">{label}</p>
    </div>
  );
}
function Line({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="text-muted">{k}</dt>
      <dd className="font-medium text-ink">{v}</dd>
    </div>
  );
}
function Stars({ value }: { value: number }) {
  const full = Math.round(value);
  return (
    <span className="inline-flex gap-0.5 text-gold">
      {[1, 2, 3, 4, 5].map((i) => (
        <Ico key={i} name="star" className={cn("h-4 w-4", i <= full ? "text-gold" : "text-line")} />
      ))}
    </span>
  );
}

// --- Record & vet modals ----------------------------------------------------

function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-[80px] w-full rounded-[9px] border border-line bg-field px-3.5 py-2.5 text-[0.9rem] text-ink",
        "focus:outline-none focus-visible:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold",
        props.className
      )}
    />
  );
}

function RecordModal({
  order, existing, user, vets, onClose, save,
}: {
  order: Order;
  existing?: CustomerFeedback;
  user: User;
  vets: User[];
  onClose: () => void;
  save: (f: CustomerFeedback) => Promise<void>;
}) {
  const { toast } = useToast();
  const [rating, setRating] = useState<FeedbackRating | "">(existing?.rating ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [needsVet, setNeedsVet] = useState(existing?.needsVet ?? false);
  const [vetReason, setVetReason] = useState(existing?.vetReason ?? "");
  const [vetAssignedTo, setVetAssignedTo] = useState(existing?.vetAssignedTo ?? (vets.length === 1 ? vets[0].email : ""));
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setErr(null);
    const n = note.trim();
    if (!n) return setErr("Enter what the customer said on the call.");
    if (needsVet && !vetReason.trim()) return setErr("Say what the customer needs the vet for.");
    if (needsVet && !vetAssignedTo) return setErr("Assign this case to a vet.");
    const assignedName = vets.find((v) => v.email === vetAssignedTo)?.name;
    const fb: CustomerFeedback = {
      id: order.id,
      orderId: order.id,
      customerName: order.name,
      phone: order.phone,
      product: order.product,
      deliveryDate: order.date,
      chicks: qtyOf(order),
      district: order.clientDistrict ?? order.district,
      sector: order.clientSector ?? order.sector,
      dsr: order.dsr,
      note: n,
      rating: rating || undefined,
      by: user.email,
      byName: user.name,
      on: nowISO(),
      needsVet,
      vetReason: needsVet ? vetReason.trim() : undefined,
      vetStatus: needsVet ? existing?.vetStatus ?? "pending" : undefined,
      vetName: existing?.vetName,
      vetAssignedTo: needsVet ? vetAssignedTo : undefined,
      vetAssignedName: needsVet ? assignedName : undefined,
      vetUpdates: existing?.vetUpdates ?? [],
      history: [
        ...(existing?.history ?? []),
        `${nowISO()} — Feedback ${existing ? "updated" : "recorded"} by ${user.name}${needsVet ? ` · flagged for vet${assignedName ? ` → ${assignedName}` : ""}` : ""}`,
      ],
    };
    setSaving(true);
    try {
      await save(fb);
    } catch {
      setSaving(false);
      return setErr("Could not save — check your connection and try again.");
    }
    toast(needsVet ? "Feedback saved and flagged for the vet." : "Feedback saved.");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Feedback — ${order.name}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save feedback"}</Button></>}>
      <div className="space-y-3">
        <p className="text-xs text-muted">{order.product} · delivered {formatDate(order.date)} · {qtyOf(order).toLocaleString()} chicks · {order.phone}</p>
        <Field label="How was the customer?">
          <div className="flex flex-wrap gap-2">
            {(["satisfied", "neutral", "unsatisfied"] as FeedbackRating[]).map((r) => (
              <button key={r} type="button" onClick={() => setRating(rating === r ? "" : r)}
                className={cn("rounded-full border px-3 py-1 text-xs font-bold transition", rating === r ? RATING_ACTIVE[r] : "border-line text-muted hover:border-ink")}>
                {RATING_LABEL[r]}
              </button>
            ))}
          </div>
        </Field>
        <Field label="Customer feedback" required>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What the customer told you on the call…" />
        </Field>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={needsVet} onChange={(e) => setNeedsVet(e.target.checked)} className="h-4 w-4 accent-gold" />
          Customer needs veterinary attention
        </label>
        {needsVet && (
          <Field label="What do they need the vet for?" required>
            <Textarea value={vetReason} onChange={(e) => setVetReason(e.target.value)} placeholder="Symptoms or issue the customer described…" />
          </Field>
        )}
        {needsVet && (
          <Field label="Assign to vet" required>
            <Select value={vetAssignedTo} onChange={(e) => setVetAssignedTo(e.target.value)}
              placeholder={vets.length ? "Choose a vet" : "No vets available"}
              options={vets.map((v) => ({ value: v.email, label: v.name }))} />
          </Field>
        )}
        {err && <p className="text-sm text-red">{err}</p>}
      </div>
    </Modal>
  );
}

function VetModal({
  fb, user, vets, isAdmin, onClose, save,
}: {
  fb: CustomerFeedback;
  user: User;
  vets: User[];
  isAdmin: boolean;
  onClose: () => void;
  save: (f: CustomerFeedback) => Promise<void>;
}) {
  const { toast } = useToast();
  const [status, setStatus] = useState<VetFollowUpStatus>(fb.vetStatus === "resolved" ? "resolved" : "in_progress");
  const [note, setNote] = useState("");
  const [assignedTo, setAssignedTo] = useState(fb.vetAssignedTo ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    setErr(null);
    const n = note.trim();
    const newAssignee = isAdmin ? assignedTo : fb.vetAssignedTo ?? "";
    const reassigned = !!newAssignee && newAssignee !== fb.vetAssignedTo;
    if (!n && !reassigned) return setErr("Add a note on what you found, advised, or did.");
    const assignedName = vets.find((v) => v.email === newAssignee)?.name ?? fb.vetAssignedName;
    const updates = [...(fb.vetUpdates ?? [])];
    const hist = [...(fb.history ?? [])];
    if (n) {
      updates.push({ note: n, by: user.email, byName: user.name, on: nowISO(), status });
      hist.push(`${nowISO()} — Vet ${status === "resolved" ? "resolved the follow-up" : "updated the follow-up"} (${user.name})`);
    }
    if (reassigned) hist.push(`${nowISO()} — Reassigned to ${assignedName ?? newAssignee} by ${user.name}`);
    setSaving(true);
    try {
      await save({
        ...fb,
        vetStatus: n ? status : fb.vetStatus,
        vetName: n ? fb.vetName ?? user.name : fb.vetName,
        vetAssignedTo: newAssignee || fb.vetAssignedTo,
        vetAssignedName: assignedName,
        vetUpdates: updates,
        history: hist,
      });
    } catch {
      setSaving(false);
      return setErr("Could not save — check your connection and try again.");
    }
    toast(reassigned && !n ? "Case reassigned." : status === "resolved" ? "Follow-up resolved." : "Follow-up updated.");
    onClose();
  }

  return (
    <Modal open onClose={onClose} title={`Follow-up — ${fb.customerName}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving}>{saving ? "Saving…" : "Save update"}</Button></>}>
      <div className="space-y-3">
        <p className="text-xs text-muted">{fb.product} · delivered {formatDate(fb.deliveryDate)} · {fb.phone}</p>
        {fb.vetReason && <p className="text-sm"><span className="text-muted">Needs vet for: </span>{fb.vetReason}</p>}
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as VetFollowUpStatus)}
            options={[{ value: "in_progress", label: "Following up" }, { value: "resolved", label: "Resolved" }]} />
        </Field>
        {isAdmin && (
          <Field label="Assigned vet" hint="Admin can hand this case to another vet">
            <Select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}
              placeholder={vets.length ? "Choose a vet" : "No vets available"}
              options={vets.map((v) => ({ value: v.email, label: v.name }))} />
          </Field>
        )}
        <Field label="Update note" required>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you found, advised, or did for the customer…" />
        </Field>
        {err && <p className="text-sm text-red">{err}</p>}
      </div>
    </Modal>
  );
}

function HistoryModal({ order, fb, onClose }: { order: Order; fb?: CustomerFeedback; onClose: () => void }) {
  const lines = [...(order.history ?? []), ...(fb?.history ?? [])]
    .filter(Boolean)
    .sort((a, b) => (a < b ? -1 : 1));
  return (
    <Modal open onClose={onClose} title={`History — ${order.name}`}
      footer={<Button onClick={onClose}>Close</Button>}>
      {lines.length === 0 ? (
        <p className="text-sm text-muted">No history recorded yet.</p>
      ) : (
        <ol className="space-y-1.5 text-sm">
          {lines.map((l, i) => <li key={i} className="text-muted">{l}</li>)}
        </ol>
      )}
    </Modal>
  );
}

// --- Inline icons -----------------------------------------------------------

type IcoName =
  | "phone" | "stethoscope" | "clock" | "star" | "alert" | "edit" | "search"
  | "calendar" | "check" | "chevronDown" | "chevronUp" | "chevronRight" | "close";

function Ico({ name, className }: { name: IcoName; className?: string }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const svg = (children: ReactNode) => <svg viewBox="0 0 24 24" className={className} {...p}>{children}</svg>;
  switch (name) {
    case "phone": return svg(<path d="M6.6 10.8a12 12 0 0 0 5.6 5.6l1.9-1.9a1 1 0 0 1 1-.24 11 11 0 0 0 3.4.55 1 1 0 0 1 1 1V19a1 1 0 0 1-1 1A16 16 0 0 1 4 5a1 1 0 0 1 1-1h3.2a1 1 0 0 1 1 1c0 1.2.19 2.34.55 3.4a1 1 0 0 1-.24 1z" />);
    case "stethoscope": return svg(<><path d="M5 3v4a4 4 0 0 0 8 0V3" /><path d="M9 11v2a5 5 0 0 0 5 5 3 3 0 0 0 3-3v-1" /><circle cx="18" cy="12" r="2" /></>);
    case "clock": return svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
    case "star": return svg(<path d="M12 3l2.6 5.6 6 .8-4.4 4.2 1.1 6L12 16.9 6.7 19.6l1.1-6L3.4 9.4l6-.8z" fill="currentColor" stroke="none" />);
    case "alert": return svg(<><path d="M12 3l9.5 16.5H2.5z" /><path d="M12 10v4" /><path d="M12 17h.01" /></>);
    case "edit": return svg(<><path d="M4 20h4L18.5 9.5l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></>);
    case "search": return svg(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>);
    case "calendar": return svg(<><rect x="3" y="4.5" width="18" height="16" rx="2" /><path d="M3 9h18M8 3v3M16 3v3" /></>);
    case "check": return svg(<path d="M5 12l4.5 4.5L19 7" />);
    case "chevronDown": return svg(<path d="M6 9l6 6 6-6" />);
    case "chevronUp": return svg(<path d="M6 15l6-6 6 6" />);
    case "chevronRight": return svg(<path d="M9 6l6 6-6 6" />);
    case "close": return svg(<path d="M6 6l12 12M18 6L6 18" />);
  }
}

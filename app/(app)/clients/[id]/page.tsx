"use client";

import { useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { Kpi } from "@/components/dashboard/Kpi";
import { Avatar } from "@/components/ui/Avatar";
import { ClientFormModal } from "@/components/clients/ClientFormModal";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { visibleOrders, productForRole, canWriteClients } from "@/lib/permissions";
import { formatRWF } from "@/lib/config";
import { formatDate, formatDateTime, nowISO } from "@/lib/format";
import { clientById, clientPayments, nextClientCode, planVsActual } from "@/lib/clients";
import { clientStatementPDF } from "@/lib/reports";
import { balance, settledAmount, orderTotal, toDeliver, type Client, type CreditRefund, type Order } from "@/lib/types";

function deliveryStatus(o: Order, routeName?: string): { label: string; tone: "green" | "gold" | "info" | "neutral" | "red" } {
  if (o.status === "refunded") return { label: "Refunded", tone: "red" };
  if (o.status === "rejected") return { label: "Rejected", tone: "red" };
  if (o.deliverOk) return { label: "Delivered", tone: "green" };
  if (o.routeId) return { label: routeName ? `On route: ${routeName}` : "On a route", tone: "info" };
  if (o.confirmedOk) return { label: "Confirmed", tone: "gold" };
  return { label: "Not confirmed", tone: "neutral" };
}

/** A section card with the small gold marker + uppercase title and an action slot. */
function SectionCard({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-block h-3.5 w-3.5 rounded bg-gold" />
          <h2 className="text-[0.7rem] font-bold uppercase tracking-[0.09em] text-muted">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </Card>
  );
}

export default function ClientDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = decodeURIComponent(params.id);
  const { user } = useAuth();
  const { orders, routes, clients, upsertClient } = useData();
  const { toast } = useToast();
  const [editing, setEditing] = useState<Client | null>(null);
  const [refunding, setRefunding] = useState(false);
  const [refundAmt, setRefundAmt] = useState("");
  const [refundMethod, setRefundMethod] = useState("MoMo");
  const [planDate, setPlanDate] = useState("");
  const [planChicks, setPlanChicks] = useState("");

  const client = useMemo(
    () => (user ? clientById(visibleOrders(orders, user), id, clients) : undefined),
    [orders, user, id, clients]
  );
  const routeName = (routeId?: string) => routes.find((r) => r.id === routeId)?.name;

  if (!user) return null;
  if (!client) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-medium text-gold-dark">← Back</button>
        <Card><p className="text-sm text-muted">Client not found.</p></Card>
      </div>
    );
  }

  const canWrite = canWriteClients(user.role);
  const payments = clientPayments(client);
  const ordersSorted = client.orders.slice().sort((a, b) => (a.date < b.date ? 1 : -1));
  const totalOrdered = client.orders.reduce((s, o) => s + orderTotal(o), 0);
  const settledPaid = client.orders.reduce((s, o) => s + settledAmount(o), 0); // cash + applied credit
  const outstanding = Math.max(0, client.balance);
  const overpaid = Math.max(0, -client.balance);
  const refundedTotal = (client.record?.creditRefunds ?? []).reduce((s, r) => s + (r.amt || 0), 0);
  const availableCredit = Math.max(0, overpaid - refundedTotal);
  const canRefund = user.role === "Admin" || user.role === "Accountant";
  const location = [client.districts[0], client.sectors[0]].filter(Boolean).join(", ");
  const firstOrderDate = ordersSorted.length ? ordersSorted[ordersSorted.length - 1].date : "";
  const since = firstOrderDate || client.record?.on || "";
  const customerType = client.ordersCount >= 5 ? "VIP" : "Regular";
  const payOrder = ordersSorted.find((o) => balance(o) > 0) ?? ordersSorted[0];
  const recordHref = payOrder ? `/orders?order=${encodeURIComponent(payOrder.id)}&pay=1` : "/orders";

  const preferredProduct = (() => {
    const count = new Map<string, number>();
    for (const o of client.orders) count.set(o.product, (count.get(o.product) ?? 0) + 1);
    let best = client.product ?? "";
    let max = 0;
    for (const [p, n] of count) if (n > max) { max = n; best = p; }
    return best || "—";
  })();

  // Open the new-order form already knowing this customer (name/phone/district/
  // sector prefill on the other side).
  const newOrderHref =
    `/orders/new?phone=${encodeURIComponent(client.phone)}&name=${encodeURIComponent(client.name)}` +
    (preferredProduct === "Ross 308" || preferredProduct === "Tetra Super Harco" ? `&product=${encodeURIComponent(preferredProduct)}` : "");

  function openEdit() {
    if (!client || !user) return;
    const rec = client.record;
    setEditing(rec ?? {
      id: client.id, name: client.name, phone: client.phone,
      district: client.districts[0] ?? "", sector: client.sectors[0] ?? "",
      product: client.product ?? productForRole(user.role),
      zone: client.zone ?? (user.role === "Tetra Zone Manager" ? user.zone : undefined),
      active: client.active, by: user.email, on: nowISO(),
    });
  }

  async function downloadStatement() {
    if (!client) return;
    try {
      await clientStatementPDF(client);
      toast("Statement downloaded.");
    } catch {
      toast("Could not build the statement.", "error");
    }
  }

  function openRefund() {
    setRefundAmt(String(availableCredit));
    setRefunding(true);
  }
  async function doRefund() {
    if (!client || !user) return;
    const amt = Math.min(Math.round(Number(refundAmt) || 0), availableCredit);
    if (amt <= 0) { toast("Enter an amount up to the available credit.", "info"); return; }
    const entry: CreditRefund = { amt, on: nowISO(), by: user.email, method: refundMethod };
    const base: Client = client.record ?? {
      id: client.id, code: nextClientCode(clients), name: client.name, phone: client.phone,
      district: client.districts[0] ?? "", sector: client.sectors[0] ?? "",
      product: client.product, active: client.active, by: user.email, on: nowISO(),
    };
    const rec: Client = { ...base, creditRefunds: [...(base.creditRefunds ?? []), entry] };
    try {
      await upsertClient(rec);
      toast(`Refunded ${formatRWF(amt)} credit to ${client.name}.`);
      setRefunding(false);
      setRefundAmt("");
    } catch {
      toast("Could not record the refund.", "error");
    }
  }

  // The backing record for this client, synthesised when it has none yet.
  const baseRecord = (): Client =>
    client!.record ?? {
      id: client!.id, code: nextClientCode(clients), name: client!.name, phone: client!.phone,
      district: client!.districts[0] ?? "", sector: client!.sectors[0] ?? "",
      product: client!.product ?? productForRole(user!.role),
      zone: client!.zone ?? (user!.role === "Tetra Zone Manager" ? user!.zone : undefined),
      active: client!.active, by: user!.email, on: nowISO(),
    };

  const isSpecial = !!client.record?.special;
  const planLines = planVsActual(client);

  async function toggleSpecial() {
    const base = baseRecord();
    const now = !base.special;
    try {
      await upsertClient({ ...base, special: now, specialBy: now ? user!.email : base.specialBy, specialOn: now ? nowISO() : base.specialOn });
      toast(now ? "Marked as special ★" : "No longer a special client.");
    } catch { toast("Could not update the client.", "error"); }
  }

  async function addPlan() {
    const chicks = Math.round(Number(planChicks) || 0);
    if (!planDate || chicks <= 0) { toast("Pick a delivery date and a chick count.", "info"); return; }
    const base = baseRecord();
    // Replace any existing plan line for the same date, keep the rest.
    const plan = [...(base.plan ?? []).filter((p) => p.date !== planDate), { date: planDate, chicks }];
    try {
      await upsertClient({ ...base, special: true, plan }); // adding a plan implies special
      setPlanDate(""); setPlanChicks("");
      toast("Plan updated.");
    } catch { toast("Could not save the plan.", "error"); }
  }

  async function removePlan(date: string) {
    const base = baseRecord();
    try {
      await upsertClient({ ...base, plan: (base.plan ?? []).filter((p) => p.date !== date) });
      toast("Plan date removed.");
    } catch { toast("Could not update the plan.", "error"); }
  }

  const smsHref = client.phone ? `sms:${client.phone.replace(/\s+/g, "")}` : undefined;
  const infoRow = (label: string, value: React.ReactNode) => (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-muted">{label}</span>
      <span className="text-right text-sm font-medium text-ink">{value}</span>
    </div>
  );
  const qaBtn = "flex items-center justify-center gap-2 rounded-xl border border-line px-3 py-2.5 text-sm font-medium text-ink transition hover:border-gold hover:bg-gold-bg";

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => router.back()} className="inline-flex items-center gap-1.5 text-sm font-medium text-gold-dark">← Back</button>
        {canWrite && (
          <Link href={newOrderHref}>
            <Button size="sm">
              <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><path d="M10 4v12M4 10h12" /></svg>
              Create Order
            </Button>
          </Link>
        )}
      </div>

      {/* Identity header */}
      <div className="flex items-center gap-4">
        <Avatar user={{ name: client.name, avatar: undefined }} size={56} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-extrabold tracking-tight text-ink">{client.name}</h1>
            {client.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}
            {isSpecial && <Pill tone="gold">★ Special</Pill>}
            {canWrite && (
              <button
                type="button"
                onClick={toggleSpecial}
                className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold text-muted transition hover:border-gold hover:text-gold-dark"
              >
                {isSpecial ? "Unmark special" : "★ Mark special"}
              </button>
            )}
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
            <span>{client.phone || "no phone"}</span>
            {location && <><span aria-hidden>·</span><span>{location}</span></>}
          </p>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <Kpi icon="orders" tone="gold" label="Orders" value={String(client.ordersCount)} sub="Total orders" />
        <Kpi icon="chicks" tone="blue" label="Chicks ordered" value={client.chicks.toLocaleString()} sub="Total chicks ordered" />
        <Kpi icon="truck" tone="purple" label="To deliver" value={client.toDeliver.toLocaleString()} sub="Chicks to be delivered" />
        <Kpi icon="money" tone="amber" label="Order value" value={formatRWF(totalOrdered)} sub="Total order value" />
        <Kpi icon="money" tone="green" label="Paid" value={formatRWF(settledPaid)} sub="Cash + credit" />
        <Kpi icon="alert" tone={outstanding > 0 ? "red" : "green"} label="Balance" value={formatRWF(outstanding)} sub="Outstanding balance" />
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Left column */}
        <div className="space-y-5 lg:col-span-2">
          <SectionCard title={`Orders (${ordersSorted.length})`} action={<Link href="/orders" className="text-sm font-medium text-gold-dark">View all orders</Link>}>
            <TableWrap>
              <thead>
                <tr>
                  <Th>Delivery date</Th><Th>Product</Th><Th className="text-right">Chicks</Th>
                  <Th className="text-right">To deliver</Th><Th className="text-right">Total</Th>
                  <Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {ordersSorted.length === 0 ? <EmptyRow colSpan={8} text="No orders." /> : ordersSorted.map((o) => {
                  const st = deliveryStatus(o, routeName(o.routeId));
                  return (
                    <tr key={o.id}>
                      <Td>{formatDate(o.date)}</Td>
                      <Td>{o.product}</Td>
                      <Td className="text-right">{o.chicks.toLocaleString()}</Td>
                      <Td className="text-right">{toDeliver(o).toLocaleString()}</Td>
                      <Td className="text-right">{formatRWF(orderTotal(o))}</Td>
                      <Td className="text-right">{formatRWF(settledAmount(o))}</Td>
                      <Td className={`text-right ${balance(o) > 0 ? "font-semibold text-red" : ""}`}>{formatRWF(balance(o))}</Td>
                      <Td><Pill tone={st.tone}>{st.label}</Pill></Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          </SectionCard>

          {isSpecial && (
            <SectionCard title="Delivery plan" action={<span className="text-xs text-muted">Planned vs ordered</span>}>
              <TableWrap>
                <thead>
                  <tr>
                    <Th>Delivery date</Th>
                    <Th className="text-right">Planned</Th>
                    <Th className="text-right">Ordered</Th>
                    <Th>Status</Th>
                    {canWrite && <Th className="text-right">Remove</Th>}
                  </tr>
                </thead>
                <tbody>
                  {planLines.length === 0 ? (
                    <EmptyRow colSpan={canWrite ? 5 : 4} text="No plan dates yet — add the client's upcoming delivery dates below." />
                  ) : planLines.map((p) => {
                    const tone = p.status === "ordered" ? "green" : p.status === "partial" ? "gold" : p.status === "past" ? "red" : "info";
                    const label = p.status === "ordered" ? "Ordered" : p.status === "partial" ? "Partial" : p.status === "past" ? "Missed" : "Awaiting order";
                    return (
                      <tr key={p.date}>
                        <Td>{formatDate(p.date)}</Td>
                        <Td className="text-right">{p.planned.toLocaleString()}</Td>
                        <Td className="text-right">{p.ordered.toLocaleString()}</Td>
                        <Td><Pill tone={tone}>{label}</Pill></Td>
                        {canWrite && (
                          <Td className="text-right">
                            <button type="button" onClick={() => removePlan(p.date)} title="Remove plan date" className="text-muted transition hover:text-red">✕</button>
                          </Td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </TableWrap>
              {canWrite && (
                <div className="mt-3 flex flex-wrap items-end gap-2">
                  <Field label="Delivery date"><Input type="date" value={planDate} onChange={(e) => setPlanDate(e.target.value)} /></Field>
                  <Field label="Planned chicks"><Input type="number" min={1} value={planChicks} onChange={(e) => setPlanChicks(e.target.value)} placeholder="e.g. 500" /></Field>
                  <Button size="sm" onClick={addPlan}>Add / update</Button>
                </div>
              )}
            </SectionCard>
          )}

          <SectionCard
            title={`Payments (${payments.length})`}
            action={canWrite ? <Link href={recordHref} className="text-sm font-medium text-gold-dark">Record payment</Link> : undefined}
          >
            <TableWrap>
              <thead>
                <tr><Th>When</Th><Th>Product</Th><Th className="text-right">Amount</Th><Th>Reference</Th><Th>Verified</Th></tr>
              </thead>
              <tbody>
                {payments.length === 0 ? <EmptyRow colSpan={5} text="No payments recorded." /> : payments.map((p, i) => (
                  <tr key={i}>
                    <Td>{formatDateTime(p.on)}</Td>
                    <Td>{p.product}</Td>
                    <Td className="text-right">{formatRWF(p.amt)}</Td>
                    <Td>{p.ref || "—"}</Td>
                    <Td>{p.voided ? <Pill tone="red">Voided</Pill> : p.verified ? <Pill tone="green">Verified</Pill> : <Pill tone="gold">Pending</Pill>}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            <div className="mt-4 grid grid-cols-2 gap-3 rounded-xl bg-cream px-4 py-3 md:grid-cols-4">
              <div><p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Total order value</p><p className="mt-0.5 font-bold text-ink">{formatRWF(totalOrdered)}</p></div>
              <div><p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Total paid</p><p className="mt-0.5 font-bold text-green">{formatRWF(settledPaid)}</p></div>
              <div><p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Balance</p><p className={`mt-0.5 font-bold ${outstanding > 0 ? "text-red" : "text-ink"}`}>{formatRWF(outstanding)}</p></div>
              <div><p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Credit available</p><p className="mt-0.5 font-bold text-green">{formatRWF(availableCredit)}</p></div>
            </div>
            {refundedTotal > 0 && <p className="mt-2 text-xs text-muted">Credit refunded to date: {formatRWF(refundedTotal)}.</p>}
          </SectionCard>

          <SectionCard title="Order & delivery history" action={<Link href="/orders" className="text-sm font-medium text-gold-dark">View full history</Link>}>
            {ordersSorted.length === 0 ? (
              <p className="text-sm text-muted">No history yet.</p>
            ) : (
              <div className="space-y-2">
                {ordersSorted.slice(0, 5).map((o) => {
                  const st = deliveryStatus(o, routeName(o.routeId));
                  return (
                    <div key={o.id} className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border border-line px-4 py-3 text-sm">
                      <span className="font-semibold text-ink">{formatDate(o.date)}</span>
                      <span className="text-muted">{o.product}</span>
                      <span className="text-muted">{o.chicks.toLocaleString()} chicks</span>
                      <span className="text-muted">{toDeliver(o).toLocaleString()} to deliver</span>
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </div>
                  );
                })}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <SectionCard
            title="Client information"
            action={canWrite ? (
              <button type="button" onClick={openEdit} title="Edit client" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-muted transition hover:border-ink hover:text-ink">
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M13.5 3.5l3 3L7 16l-3.5.5L4 13z" /></svg>
              </button>
            ) : undefined}
          >
            <div className="divide-y divide-line">
              {infoRow("Customer ID", client.record?.code ? <span className="font-mono">{client.record.code}</span> : "—")}
              {infoRow("Full name", client.name)}
              {infoRow("Phone number", client.phone || "—")}
              {infoRow("District", client.districts[0] || "—")}
              {infoRow("Sector", client.sectors[0] || "—")}
              {infoRow("Customer since", since ? formatDate(since) : "—")}
              {infoRow("Customer type", <Pill tone={customerType === "VIP" ? "gold" : "neutral"}>{customerType}</Pill>)}
              {infoRow("Preferred product", preferredProduct)}
            </div>
          </SectionCard>

          <SectionCard
            title="Notes"
            action={canWrite ? (
              <button type="button" onClick={openEdit} className="text-sm font-medium text-gold-dark">＋ Add note</button>
            ) : undefined}
          >
            {client.record?.note ? (
              <div className="rounded-xl bg-cream px-4 py-3">
                <p className="text-sm text-ink">{client.record.note}</p>
                {(client.record.by || client.record.on) && (
                  <p className="mt-2 text-[0.7rem] text-muted">
                    {client.record.by ? `Added by ${client.record.by}` : "Added"}{client.record.on ? ` · ${formatDate(client.record.on)}` : ""}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">No notes yet.</p>
            )}
          </SectionCard>

          <SectionCard title="Quick actions">
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {canWrite && <Link href={newOrderHref} className={qaBtn}>Create new order{availableCredit > 0 ? " (credit applies)" : ""}</Link>}
              {canWrite && <Link href={recordHref} className={qaBtn}>Record payment</Link>}
              {canRefund && availableCredit > 0 && <button type="button" onClick={openRefund} className={qaBtn}>Refund credit</button>}
              {smsHref ? <a href={smsHref} className={qaBtn}>Send message</a> : <span className={`${qaBtn} cursor-not-allowed opacity-50`}>Send message</span>}
              <button type="button" onClick={downloadStatement} className={qaBtn}>Download statement</button>
            </div>
          </SectionCard>
        </div>
      </div>

      {editing && <ClientFormModal key={editing.id || "new"} initial={editing} onClose={() => setEditing(null)} />}

      {refunding && (
        <Modal
          open
          onClose={() => setRefunding(false)}
          title="Refund customer credit"
          footer={<><Button variant="ghost" onClick={() => setRefunding(false)}>Cancel</Button><Button onClick={doRefund}>Refund</Button></>}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              Available credit: <strong className="text-ink">{formatRWF(availableCredit)}</strong>. Recording a refund reduces the customer&apos;s credit and keeps an audit trail — it does not move money itself.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Amount (RWF)" required>
                <Input type="number" min={1} max={availableCredit} value={refundAmt} onChange={(e) => setRefundAmt(e.target.value)} />
              </Field>
              <Field label="Method">
                <Select
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  options={[{ value: "MoMo", label: "Mobile Money" }, { value: "Bank", label: "Bank transfer" }, { value: "Cash", label: "Cash" }]}
                />
              </Field>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

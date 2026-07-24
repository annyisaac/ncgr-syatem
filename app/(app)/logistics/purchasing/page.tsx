"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  PRIORITIES, UNITS,
  grnAcceptedValue, listPurchaseOrders, listReceipts, listRequests, newGrnId, newPoId, newQuoteId,
  newRequestId, nextRef, poOrderedQty, poReceivedQty, poTotal, quoteTotal, stamp, threeWayMatch,
  upsertPurchaseOrder, upsertReceipt, upsertRequest,
  type GRNLine, type GoodsReceipt, type POLine, type POStatus, type PurchaseOrder,
  type PurchaseRequest, type Quotation,
} from "@/lib/procurement";

type Tab = "requests" | "orders" | "grn";
const TABS: { id: Tab; label: string }[] = [
  { id: "requests", label: "Purchase requests" },
  { id: "orders", label: "Purchase orders" },
  { id: "grn", label: "Goods received" },
];

const prTone = (s: PurchaseRequest["status"]) =>
  s === "approved" ? "green" : s === "rejected" ? "red" : s === "ordered" ? "info" : s === "closed" ? "neutral" : "amber";
const poTone = (s: POStatus) =>
  s === "Approved" || s === "Fully Received" ? "green" : s === "Cancelled" ? "red" : s === "Closed" ? "neutral"
    : s === "Partially Received" || s === "Sent to Supplier" ? "info" : "amber";

export default function ProcurementPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [requests, setRequests] = useState<PurchaseRequest[]>([]);
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [receipts, setReceipts] = useState<GoodsReceipt[]>([]);
  const [tab, setTab] = useState<Tab>("requests");

  const [prEdit, setPrEdit] = useState<PurchaseRequest | null>(null);
  const [poEdit, setPoEdit] = useState<PurchaseOrder | null>(null);
  const [grnEdit, setGrnEdit] = useState<GoodsReceipt | null>(null);

  const canUse = user?.role === "Admin" || user?.role === "Logistics Officer" || user?.role === "Operations Manager";
  const canApprove = user?.role === "Admin" || user?.role === "Operations Manager";
  const isLogistics = user?.role === "Admin" || user?.role === "Logistics Officer";

  const load = useCallback(async () => {
    try { const [r, o, g] = await Promise.all([listRequests(), listPurchaseOrders(), listReceipts()]); setRequests(r); setOrders(o); setReceipts(g); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("procurement-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["purchase_requests", "purchase_orders", "goods_receipts"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const poById = useMemo(() => new Map(orders.map((o) => [o.id, o])), [orders]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for Logistics, Operations and Admin.</p></Card>;

  // ---- persistence helpers ----
  async function saveRequest(r: PurchaseRequest) {
    setRequests((p) => { const i = p.findIndex((x) => x.id === r.id); const c = p.slice(); if (i === -1) c.unshift(r); else c[i] = r; return c; });
    try { await upsertRequest(r); } catch { toast("Could not save request.", "error"); void load(); }
  }
  async function savePO(o: PurchaseOrder) {
    setOrders((p) => { const i = p.findIndex((x) => x.id === o.id); const c = p.slice(); if (i === -1) c.unshift(o); else c[i] = o; return c; });
    try { await upsertPurchaseOrder(o); } catch { toast("Could not save purchase order.", "error"); void load(); }
  }
  async function saveGRN(g: GoodsReceipt) {
    setReceipts((p) => { const i = p.findIndex((x) => x.id === g.id); const c = p.slice(); if (i === -1) c.unshift(g); else c[i] = g; return c; });
    try { await upsertReceipt(g); } catch { toast("Could not save goods receipt.", "error"); void load(); }
  }

  const pendingApproval = requests.filter((r) => r.status === "submitted").length;
  const toSource = requests.filter((r) => r.status === "approved").length;
  const openPOs = orders.filter((o) => !["Cancelled", "Closed", "Fully Received"].includes(o.status)).length;
  const toHandOff = receipts.filter((g) => !g.handedToFinance).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Awaiting approval" value={String(pendingApproval)} tone={pendingApproval > 0 ? "gold" : "default"} />
        <StatTile label="Approved to source" value={String(toSource)} tone="green" />
        <StatTile label="Open purchase orders" value={String(openPOs)} />
        <StatTile label="Receipts to hand to Finance" value={String(toHandOff)} tone={toHandOff > 0 ? "gold" : "default"} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "requests" && (
        <Card>
          <CardHeader title={`Purchase requests (${requests.length})`} action={<Button size="sm" onClick={() => setPrEdit(blankRequest(user.email, nextRef("PR", requests)))}>＋ New request</Button>} />
          <TableWrap>
            <thead><tr><Th>Ref</Th><Th>Department</Th><Th>Items</Th><Th>Priority</Th><Th>Required</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>
              {requests.length === 0 ? <EmptyRow colSpan={7} text="No purchase requests yet." /> : requests.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.ref}</Td>
                  <Td>{r.department}</Td>
                  <Td className="max-w-[16rem] truncate">{r.items.map((i) => `${i.quantity} ${i.unit} ${i.description}`).join(", ")}</Td>
                  <Td>{r.priority}</Td>
                  <Td>{r.requiredDate ? formatDate(r.requiredDate) : "—"}</Td>
                  <Td><Pill tone={prTone(r.status)}>{r.status}</Pill></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setPrEdit(r)}>Open</Button></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {tab === "orders" && (
        <Card>
          <CardHeader title={`Purchase orders (${orders.length})`} />
          <TableWrap>
            <thead><tr><Th>Ref</Th><Th>Supplier</Th><Th className="text-right">Total</Th><Th>Received</Th><Th>Delivery</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>
              {orders.length === 0 ? <EmptyRow colSpan={7} text="No purchase orders yet — create one from an approved request." /> : orders.map((o) => {
                const rec = poReceivedQty(o.id, receipts); const ord = poOrderedQty(o);
                return (
                  <tr key={o.id}>
                    <Td className="font-medium">{o.ref}{o.requestRef && <div className="text-xs text-muted">from {o.requestRef}</div>}</Td>
                    <Td>{o.supplierName}</Td>
                    <Td className="text-right">{formatRWF(poTotal(o))}</Td>
                    <Td>{ord > 0 ? `${rec.toLocaleString()} / ${ord.toLocaleString()}` : "—"}</Td>
                    <Td>{o.deliveryDate ? formatDate(o.deliveryDate) : "—"}</Td>
                    <Td><Pill tone={poTone(o.status)}>{o.status}</Pill></Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => setPoEdit(o)}>Open</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {tab === "grn" && (
        <Card>
          <CardHeader title={`Goods received (${receipts.length})`} />
          <TableWrap>
            <thead><tr><Th>Ref</Th><Th>PO</Th><Th>Supplier</Th><Th>Received</Th><Th className="text-right">Accepted value</Th><Th>Match</Th><Th>Finance</Th><Th></Th></tr></thead>
            <tbody>
              {receipts.length === 0 ? <EmptyRow colSpan={8} text="No goods received yet — record delivery against a purchase order." /> : receipts.map((g) => {
                const m = threeWayMatch(poById.get(g.poId), g);
                return (
                  <tr key={g.id}>
                    <Td className="font-medium">{g.ref}</Td>
                    <Td>{g.poRef}</Td>
                    <Td>{g.supplierName}</Td>
                    <Td>{formatDate(g.receivedDate)}</Td>
                    <Td className="text-right">{formatRWF(grnAcceptedValue(g))}</Td>
                    <Td><Pill tone={m.state === "ok" ? "green" : m.state === "flag" ? "red" : "amber"}>{m.state === "ok" ? "Matched" : m.state === "flag" ? "Flagged" : "Pending"}</Pill></Td>
                    <Td>{g.handedToFinance ? <Pill tone="green">Handed off</Pill> : <Pill tone="neutral">Held</Pill>}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => setGrnEdit(g)}>Open</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {prEdit && (
        <RequestModal
          key={prEdit.id} initial={prEdit} email={user.email} canApprove={canApprove} isLogistics={isLogistics}
          onClose={() => setPrEdit(null)}
          onSave={(r) => { void saveRequest(r); setPrEdit(null); toast("Request saved."); }}
          onCreatePO={(r) => {
            const po = poFromRequest(r, user.email, nextRef("PO", orders));
            void savePO(po);
            void saveRequest({ ...r, status: "ordered", history: [...r.history, stamp(user.email, `PO ${po.ref} created`)] });
            setPrEdit(null); setPoEdit(po); setTab("orders");
            toast(`Created ${po.ref}.`);
          }}
        />
      )}

      {poEdit && (
        <POModal
          key={poEdit.id} initial={poEdit} email={user.email} canApprove={canApprove} isLogistics={isLogistics}
          received={poReceivedQty(poEdit.id, receipts)}
          onClose={() => setPoEdit(null)}
          onSave={(o) => { void savePO(o); setPoEdit(null); toast("Purchase order saved."); }}
          onReceive={(o) => { const g = grnFromPO(o, user.email, nextRef("GRN", receipts)); setPoEdit(null); setGrnEdit(g); setTab("grn"); }}
        />
      )}

      {grnEdit && (
        <GRNModal
          key={grnEdit.id} initial={grnEdit} po={poById.get(grnEdit.poId)}
          onClose={() => setGrnEdit(null)}
          onSave={(g) => { void saveGRN(g); reconcilePO(g); setGrnEdit(null); toast("Goods receipt saved."); }}
          onHandoff={(g) => { const h = { ...g, handedToFinance: true, handedOn: nowISO(), history: [...g.history, stamp(user.email, "handed to Finance")] }; void saveGRN(h); reconcilePO(h); setGrnEdit(null); toast("Sent to Finance for verification."); }}
        />
      )}
    </div>
  );

  /** After a receipt, move the PO to Partially/Fully Received. */
  function reconcilePO(g: GoodsReceipt) {
    const po = orders.find((o) => o.id === g.poId);
    if (!po || po.status === "Cancelled" || po.status === "Closed") return;
    const rec = poReceivedQty(po.id, [...receipts.filter((x) => x.id !== g.id), g]);
    const ord = poOrderedQty(po);
    const status: POStatus = ord > 0 && rec >= ord ? "Fully Received" : rec > 0 ? "Partially Received" : po.status;
    if (status !== po.status) void savePO({ ...po, status, history: [...po.history, stamp(user!.email, `marked ${status}`)] });
  }
}

// --------------------------------------------------------------------------- factories

function blankRequest(email: string, ref: string): PurchaseRequest {
  return { id: newRequestId(), ref, department: "", items: [{ description: "", quantity: 1, unit: "pcs" }], priority: "Normal", status: "draft", quotations: [], requestedBy: email, on: nowISO(), history: [] };
}
function poFromRequest(r: PurchaseRequest, email: string, ref: string): PurchaseOrder {
  const q = r.quotations.find((x) => x.id === r.recommendedQuoteId);
  const lines: POLine[] = r.items.map((i) => ({ description: i.description, quantity: i.quantity, unit: i.unit, unitPrice: 0 }));
  // Spread the recommended quote's goods price across the first line as a starting point.
  if (q && lines[0]) lines[0].unitPrice = lines[0].quantity > 0 ? Math.round(q.price / lines[0].quantity) : q.price;
  return {
    id: newPoId(), ref, requestId: r.id, requestRef: r.ref, supplierName: q?.supplierName ?? "", supplierId: q?.supplierId,
    lines, transport: q?.transport ?? 0, currency: "RWF", deliveryLocation: r.destination, paymentTerms: q?.paymentTerms,
    status: "Draft", createdBy: email, on: nowISO(), history: [stamp(email, "created from " + r.ref)],
  };
}
function grnFromPO(o: PurchaseOrder, email: string, ref: string): GoodsReceipt {
  const lines: GRNLine[] = o.lines.map((l) => ({ description: l.description, ordered: l.quantity, received: l.quantity, accepted: l.quantity, rejected: 0, damaged: 0, unitPrice: l.unitPrice }));
  return { id: newGrnId(), ref, poId: o.id, poRef: o.ref, supplierName: o.supplierName, receivedDate: todayISO(), receivedBy: email, lines, on: nowISO(), history: [stamp(email, "created")] };
}

// --------------------------------------------------------------------------- Request modal

function RequestModal({ initial, email, canApprove, isLogistics, onClose, onSave, onCreatePO }: {
  initial: PurchaseRequest; email: string; canApprove: boolean; isLogistics: boolean;
  onClose: () => void; onSave: (r: PurchaseRequest) => void; onCreatePO: (r: PurchaseRequest) => void;
}) {
  const [r, setR] = useState<PurchaseRequest>(initial);
  const [quote, setQuote] = useState<Quotation | null>(null);
  const isNew = initial.status === "draft" && initial.history.length === 0;
  const set = (p: Partial<PurchaseRequest>) => setR((x) => ({ ...x, ...p }));
  const editable = r.status === "draft" || r.status === "submitted";

  function submit() {
    if (!r.department.trim()) return;
    onSave({ ...r, status: r.status === "draft" ? "submitted" : r.status, department: r.department.trim(),
      items: r.items.filter((i) => i.description.trim()), history: isNew ? [stamp(email, "submitted")] : r.history });
  }
  function decide(approve: boolean) {
    if (!approve && !r.decisionNote?.trim()) { alert("Add a reason so it can go back to the requester."); return; }
    onSave({ ...r, status: approve ? "approved" : "rejected", decidedBy: email, decidedOn: nowISO(),
      history: [...r.history, stamp(email, approve ? "approved" : `rejected — ${r.decisionNote}`)] });
  }
  function addQuote() {
    if (!quote || !quote.supplierName.trim()) return;
    const q = { ...quote, supplierName: quote.supplierName.trim() };
    setR((x) => ({ ...x, quotations: x.quotations.some((z) => z.id === q.id) ? x.quotations.map((z) => z.id === q.id ? q : z) : [...x.quotations, q] }));
    setQuote(null);
  }

  const cheapest = r.quotations.length ? r.quotations.reduce((a, b) => quoteTotal(a) <= quoteTotal(b) ? a : b).id : undefined;

  return (
    <Modal open onClose={onClose} title={`${r.ref} · Purchase request`} className="max-w-3xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {editable && <Button onClick={submit}>{r.status === "draft" ? "Submit request" : "Save"}</Button>}
        {canApprove && r.status === "submitted" && <><Button variant="secondary" onClick={() => decide(false)}>Reject</Button><Button onClick={() => decide(true)}>Approve</Button></>}
        {isLogistics && r.status === "approved" && <Button onClick={() => onCreatePO(r)} disabled={!r.recommendedQuoteId}>Create purchase order</Button>}
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Requesting department" required><Input value={r.department} disabled={!editable} onChange={(e) => set({ department: e.target.value })} placeholder="Hatchery, Sales…" /></Field>
          <Field label="Priority"><Select value={r.priority} disabled={!editable} onChange={(e) => set({ priority: e.target.value as PurchaseRequest["priority"] })} options={PRIORITIES.map((p) => ({ value: p, label: p }))} /></Field>
          <Field label="Required date"><Input type="date" value={r.requiredDate ?? ""} disabled={!editable} onChange={(e) => set({ requiredDate: e.target.value || undefined })} /></Field>
          <Field label="Destination"><Input value={r.destination ?? ""} disabled={!editable} onChange={(e) => set({ destination: e.target.value })} placeholder="where it's needed" /></Field>
          <div className="sm:col-span-2"><Field label="Reason for purchase"><Input value={r.reason ?? ""} disabled={!editable} onChange={(e) => set({ reason: e.target.value })} /></Field></div>
          <div className="sm:col-span-2"><Field label="Supporting document (reference)"><Input value={r.docRef ?? ""} disabled={!editable} onChange={(e) => set({ docRef: e.target.value })} placeholder="e.g. quote-request.pdf" /></Field></div>
        </div>

        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Items</div>
          <TableWrap>
            <thead><tr><Th>Item</Th><Th className="w-24 text-right">Qty</Th><Th className="w-28">Unit</Th><Th></Th></tr></thead>
            <tbody>
              {r.items.map((it, i) => (
                <tr key={i}>
                  <Td><Input value={it.description} disabled={!editable} onChange={(e) => set({ items: r.items.map((x, j) => j === i ? { ...x, description: e.target.value } : x) })} /></Td>
                  <Td><Input type="number" min={0} value={it.quantity || ""} disabled={!editable} onChange={(e) => set({ items: r.items.map((x, j) => j === i ? { ...x, quantity: Number(e.target.value) || 0 } : x) })} /></Td>
                  <Td><Select value={it.unit} disabled={!editable} onChange={(e) => set({ items: r.items.map((x, j) => j === i ? { ...x, unit: e.target.value } : x) })} options={UNITS.map((u) => ({ value: u, label: u }))} /></Td>
                  <Td>{editable && r.items.length > 1 && <Button size="sm" variant="ghost" onClick={() => set({ items: r.items.filter((_, j) => j !== i) })}>✕</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {editable && <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ items: [...r.items, { description: "", quantity: 1, unit: "pcs" }] })}>＋ Add item</Button>}
        </div>

        {r.status === "rejected" && r.decisionNote && <div className="rounded-lg border border-red/30 bg-red-bg/50 p-3 text-sm"><strong>Returned:</strong> {r.decisionNote}</div>}
        {canApprove && r.status === "submitted" && <Field label="Decision note / rejection reason"><Input value={r.decisionNote ?? ""} onChange={(e) => set({ decisionNote: e.target.value })} placeholder="required to reject" /></Field>}

        {(r.status === "approved" || r.status === "ordered" || r.quotations.length > 0) && (
          <div>
            <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Supplier quotations</div>
            <TableWrap>
              <thead><tr><Th>Supplier</Th><Th className="text-right">Price</Th><Th className="text-right">Tax</Th><Th className="text-right">Transport</Th><Th className="text-right">Total</Th><Th>Delivery</Th><Th></Th></tr></thead>
              <tbody>
                {r.quotations.length === 0 ? <EmptyRow colSpan={7} text="No quotations recorded." /> : r.quotations.map((q) => (
                  <tr key={q.id} className={r.recommendedQuoteId === q.id ? "bg-green-bg/40" : ""}>
                    <Td className="font-medium">{q.supplierName}{cheapest === q.id && <Pill tone="green" className="ml-2">Lowest</Pill>}</Td>
                    <Td className="text-right">{formatRWF(q.price)}</Td>
                    <Td className="text-right">{formatRWF(q.tax)}</Td>
                    <Td className="text-right">{formatRWF(q.transport)}</Td>
                    <Td className="text-right font-medium">{formatRWF(quoteTotal(q))}</Td>
                    <Td>{q.deliveryDays ? `${q.deliveryDays}d` : "—"}</Td>
                    <Td>{isLogistics && r.status === "approved" && <Button size="sm" variant={r.recommendedQuoteId === q.id ? "secondary" : "ghost"} onClick={() => set({ recommendedQuoteId: q.id })}>{r.recommendedQuoteId === q.id ? "Recommended" : "Recommend"}</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
            {isLogistics && (r.status === "approved") && (
              quote ? (
                <div className="mt-3 grid grid-cols-2 gap-3 rounded-lg border border-line p-3 sm:grid-cols-4">
                  <Field label="Supplier"><Input value={quote.supplierName} onChange={(e) => setQuote({ ...quote, supplierName: e.target.value })} /></Field>
                  <Field label="Price"><Input type="number" min={0} value={quote.price || ""} onChange={(e) => setQuote({ ...quote, price: Number(e.target.value) || 0 })} /></Field>
                  <Field label="Tax"><Input type="number" min={0} value={quote.tax || ""} onChange={(e) => setQuote({ ...quote, tax: Number(e.target.value) || 0 })} /></Field>
                  <Field label="Transport"><Input type="number" min={0} value={quote.transport || ""} onChange={(e) => setQuote({ ...quote, transport: Number(e.target.value) || 0 })} /></Field>
                  <Field label="Delivery (days)"><Input type="number" min={0} value={quote.deliveryDays ?? ""} onChange={(e) => setQuote({ ...quote, deliveryDays: Number(e.target.value) || undefined })} /></Field>
                  <Field label="Payment terms"><Input value={quote.paymentTerms ?? ""} onChange={(e) => setQuote({ ...quote, paymentTerms: e.target.value })} /></Field>
                  <Field label="Document ref"><Input value={quote.docRef ?? ""} onChange={(e) => setQuote({ ...quote, docRef: e.target.value })} /></Field>
                  <div className="flex items-end gap-2"><Button size="sm" onClick={addQuote}>Save</Button><Button size="sm" variant="ghost" onClick={() => setQuote(null)}>Cancel</Button></div>
                </div>
              ) : <Button size="sm" variant="ghost" className="mt-2" onClick={() => setQuote({ id: newQuoteId(), supplierName: "", price: 0, tax: 0, transport: 0, on: nowISO() })}>＋ Add quotation</Button>
            )}
            {isLogistics && r.status === "approved" && !r.recommendedQuoteId && r.quotations.length > 0 && <p className="mt-2 text-xs text-muted">Recommend a supplier to enable creating the purchase order.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------- PO modal

function POModal({ initial, email, canApprove, isLogistics, received, onClose, onSave, onReceive }: {
  initial: PurchaseOrder; email: string; canApprove: boolean; isLogistics: boolean; received: number;
  onClose: () => void; onSave: (o: PurchaseOrder) => void; onReceive: (o: PurchaseOrder) => void;
}) {
  const [o, setO] = useState<PurchaseOrder>(initial);
  const set = (p: Partial<PurchaseOrder>) => setO((x) => ({ ...x, ...p }));
  const editable = o.status === "Draft" || o.status === "Pending Approval";
  const setLine = (i: number, p: Partial<POLine>) => set({ lines: o.lines.map((l, j) => j === i ? { ...l, ...p } : l) });
  const move = (status: POStatus, action: string) => onSave({ ...o, status, ...(status === "Approved" ? { approvedBy: email, approvedOn: nowISO() } : {}), history: [...o.history, stamp(email, action)] });
  const canReceive = ["Approved", "Sent to Supplier", "Partially Received"].includes(o.status) && received < poOrderedQty(o);

  return (
    <Modal open onClose={onClose} title={`${o.ref} · Purchase order`} className="max-w-3xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {editable && isLogistics && <Button variant="secondary" onClick={() => onSave({ ...o, history: [...o.history, stamp(email, "saved")] })}>Save draft</Button>}
        {o.status === "Draft" && isLogistics && <Button onClick={() => move("Pending Approval", "submitted for approval")} disabled={!o.supplierName.trim()}>Submit for approval</Button>}
        {o.status === "Pending Approval" && canApprove && <Button onClick={() => move("Approved", "approved")}>Approve</Button>}
        {o.status === "Approved" && isLogistics && <Button onClick={() => move("Sent to Supplier", "sent to supplier")}>Mark sent to supplier</Button>}
        {canReceive && isLogistics && <Button onClick={() => onReceive(o)}>Record goods received</Button>}
        {!["Cancelled", "Closed", "Fully Received"].includes(o.status) && isLogistics && <Button variant="secondary" onClick={() => move("Cancelled", "cancelled")}>Cancel</Button>}
        {o.status === "Fully Received" && isLogistics && <Button onClick={() => move("Closed", "closed")}>Close</Button>}
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Supplier" required><Input value={o.supplierName} disabled={!editable} onChange={(e) => set({ supplierName: e.target.value })} /></Field>
          <Field label="Currency"><Input value={o.currency} disabled={!editable} onChange={(e) => set({ currency: e.target.value })} /></Field>
          <Field label="Delivery date"><Input type="date" value={o.deliveryDate ?? ""} disabled={!editable} onChange={(e) => set({ deliveryDate: e.target.value || undefined })} /></Field>
          <Field label="Delivery location"><Input value={o.deliveryLocation ?? ""} disabled={!editable} onChange={(e) => set({ deliveryLocation: e.target.value })} /></Field>
          <Field label="Payment terms"><Input value={o.paymentTerms ?? ""} disabled={!editable} onChange={(e) => set({ paymentTerms: e.target.value })} /></Field>
          <Field label="Document ref"><Input value={o.docRef ?? ""} disabled={!editable} onChange={(e) => set({ docRef: e.target.value })} /></Field>
        </div>
        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Order lines</div>
          <TableWrap>
            <thead><tr><Th>Item</Th><Th className="w-20 text-right">Qty</Th><Th className="w-24">Unit</Th><Th className="w-28 text-right">Unit price</Th><Th className="w-20 text-right">Tax %</Th><Th className="text-right">Line total</Th><Th></Th></tr></thead>
            <tbody>
              {o.lines.map((l, i) => (
                <tr key={i}>
                  <Td><Input value={l.description} disabled={!editable} onChange={(e) => setLine(i, { description: e.target.value })} /></Td>
                  <Td><Input type="number" min={0} value={l.quantity || ""} disabled={!editable} onChange={(e) => setLine(i, { quantity: Number(e.target.value) || 0 })} /></Td>
                  <Td><Input value={l.unit} disabled={!editable} onChange={(e) => setLine(i, { unit: e.target.value })} /></Td>
                  <Td><Input type="number" min={0} value={l.unitPrice || ""} disabled={!editable} onChange={(e) => setLine(i, { unitPrice: Number(e.target.value) || 0 })} /></Td>
                  <Td><Input type="number" min={0} value={l.taxPct ?? ""} disabled={!editable} onChange={(e) => setLine(i, { taxPct: Number(e.target.value) || undefined })} /></Td>
                  <Td className="text-right">{formatRWF((l.quantity || 0) * (l.unitPrice || 0) * (1 + (l.taxPct || 0) / 100))}</Td>
                  <Td>{editable && o.lines.length > 1 && <Button size="sm" variant="ghost" onClick={() => set({ lines: o.lines.filter((_, j) => j !== i) })}>✕</Button>}</Td>
                </tr>
              ))}
              <tr className="border-t border-line"><Td>Transport</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td className="text-right"><Input type="number" min={0} value={o.transport || ""} disabled={!editable} onChange={(e) => set({ transport: Number(e.target.value) || 0 })} /></Td><Td></Td></tr>
              <tr className="border-t border-line font-semibold"><Td>Total</Td><Td></Td><Td></Td><Td></Td><Td></Td><Td className="text-right">{formatRWF(poTotal(o))}</Td><Td></Td></tr>
            </tbody>
          </TableWrap>
          {editable && <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ lines: [...o.lines, { description: "", quantity: 1, unit: "pcs", unitPrice: 0 }] })}>＋ Add line</Button>}
        </div>
        <p className="text-xs text-muted">Logistics prepares and follows up the order; the Operations Manager approves it; Finance records the bill and runs payment.</p>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------- GRN modal

function GRNModal({ initial, po, onClose, onSave, onHandoff }: {
  initial: GoodsReceipt; po: PurchaseOrder | undefined;
  onClose: () => void; onSave: (g: GoodsReceipt) => void; onHandoff: (g: GoodsReceipt) => void;
}) {
  const [g, setG] = useState<GoodsReceipt>(initial);
  const set = (p: Partial<GoodsReceipt>) => setG((x) => ({ ...x, ...p }));
  const setLine = (i: number, p: Partial<GRNLine>) => set({ lines: g.lines.map((l, j) => j === i ? { ...l, ...p } : l) });
  const locked = !!g.handedToFinance;
  const match = threeWayMatch(po, g);

  return (
    <Modal open onClose={onClose} title={`${g.ref} · Goods received`} className="max-w-3xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {!locked && <Button variant="secondary" onClick={() => onSave(g)}>Save</Button>}
        {!locked && <Button onClick={() => onHandoff(g)} disabled={match.state === "pending"}>Hand to Finance</Button>}
      </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="PO"><Input value={g.poRef} disabled /></Field>
          <Field label="Supplier"><Input value={g.supplierName} disabled={locked} onChange={(e) => set({ supplierName: e.target.value })} /></Field>
          <Field label="Date received"><Input type="date" value={g.receivedDate} disabled={locked} onChange={(e) => set({ receivedDate: e.target.value })} /></Field>
          <Field label="Delivery note no."><Input value={g.deliveryNoteNo ?? ""} disabled={locked} onChange={(e) => set({ deliveryNoteNo: e.target.value })} /></Field>
          <Field label="Receiving location"><Input value={g.location ?? ""} disabled={locked} onChange={(e) => set({ location: e.target.value })} /></Field>
          <Field label="Delivered by"><Input value={g.deliveredBy ?? ""} disabled={locked} onChange={(e) => set({ deliveredBy: e.target.value })} /></Field>
        </div>
        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Lines — record accepted quantities only (those increase inventory)</div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-[0.62rem] uppercase tracking-wide text-muted"><th className="p-1.5 text-left">Item</th><th className="p-1.5 text-right">Ord</th><th className="p-1.5 text-right">Recv</th><th className="p-1.5 text-right">Accept</th><th className="p-1.5 text-right">Reject</th><th className="p-1.5 text-right">Damaged</th><th className="p-1.5">Batch</th><th className="p-1.5">Expiry</th></tr></thead>
              <tbody>
                {g.lines.map((l, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="p-1 min-w-[8rem]">{l.description}</td>
                    <td className="p-1 text-right">{l.ordered}</td>
                    <td className="p-1 w-16"><Input type="number" min={0} value={l.received || ""} disabled={locked} onChange={(e) => setLine(i, { received: Number(e.target.value) || 0 })} /></td>
                    <td className="p-1 w-16"><Input type="number" min={0} value={l.accepted || ""} disabled={locked} onChange={(e) => setLine(i, { accepted: Number(e.target.value) || 0 })} /></td>
                    <td className="p-1 w-16"><Input type="number" min={0} value={l.rejected || ""} disabled={locked} onChange={(e) => setLine(i, { rejected: Number(e.target.value) || 0 })} /></td>
                    <td className="p-1 w-16"><Input type="number" min={0} value={l.damaged || ""} disabled={locked} onChange={(e) => setLine(i, { damaged: Number(e.target.value) || 0 })} /></td>
                    <td className="p-1 w-24"><Input value={l.batch ?? ""} disabled={locked} onChange={(e) => setLine(i, { batch: e.target.value })} /></td>
                    <td className="p-1 w-32"><Input type="date" value={l.expiry ?? ""} disabled={locked} onChange={(e) => setLine(i, { expiry: e.target.value || undefined })} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Supplier invoice no."><Input value={g.invoiceNo ?? ""} disabled={locked} onChange={(e) => set({ invoiceNo: e.target.value })} /></Field>
          <Field label="Invoice amount"><Input type="number" min={0} value={g.invoiceAmount ?? ""} disabled={locked} onChange={(e) => set({ invoiceAmount: Number(e.target.value) || undefined })} /></Field>
          <Field label="Invoice document ref"><Input value={g.invoiceDocRef ?? ""} disabled={locked} onChange={(e) => set({ invoiceDocRef: e.target.value })} /></Field>
          <div className="sm:col-span-3"><Field label="Inspection comments"><Input value={g.comments ?? ""} disabled={locked} onChange={(e) => set({ comments: e.target.value })} /></Field></div>
        </div>

        <div className={`rounded-lg border p-3 text-sm ${match.state === "ok" ? "border-green/30 bg-green-bg/40" : match.state === "flag" ? "border-red/30 bg-red-bg/40" : "border-gold/30 bg-gold-bg/40"}`}>
          <div className="mb-1 flex items-center gap-2 font-semibold">
            Three-way match
            <Pill tone={match.state === "ok" ? "green" : match.state === "flag" ? "red" : "amber"}>{match.state === "ok" ? "Matched" : match.state === "flag" ? "Flagged" : "Pending"}</Pill>
          </div>
          <div className="grid grid-cols-3 gap-2 text-xs">
            <div>PO value<br /><strong>{formatRWF(match.poValue)}</strong></div>
            <div>Accepted goods<br /><strong>{formatRWF(match.acceptedValue)}</strong></div>
            <div>Invoice<br /><strong>{formatRWF(match.invoiceValue)}</strong></div>
          </div>
          {match.flags.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs">{match.flags.map((f, i) => <li key={i}>{f}</li>)}</ul>}
        </div>
        {locked && <p className="text-xs text-green">Handed to Finance{g.handedOn ? ` on ${formatDate(g.handedOn)}` : ""} — the Accountant records the bill and runs payment.</p>}
      </div>
    </Modal>
  );
}

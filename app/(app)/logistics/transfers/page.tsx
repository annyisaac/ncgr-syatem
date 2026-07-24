"use client";

import { useCallback, useEffect, useState } from "react";

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
import { nowISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  RETURN_CONDITIONS, RETURN_RESOLUTIONS, RETURN_SOURCES,
  TRANSFER_LOCATIONS, listReturns, listTransfers, nextRef, newReturnId, newTransferId,
  stamp, transferShortage, upsertReturn, upsertTransfer,
  type ReturnRecord, type ReturnStatus, type StockTransfer, type TransferLine, type TransferStatus,
} from "@/lib/logisticsOps";

type Tab = "transfers" | "returns";

const tfTone = (s: TransferStatus) =>
  s === "Received" ? "green" : s === "Cancelled" ? "red" : s === "In Transit" || s === "Issued" ? "info" : "amber";
const retTone = (s: ReturnStatus) =>
  s === "Resolved" || s === "Closed" ? "green" : s === "Cancelled" ? "red" : s === "Under review" ? "info" : "amber";

export default function TransfersPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [tab, setTab] = useState<Tab>("transfers");
  const [tfEdit, setTfEdit] = useState<StockTransfer | null>(null);
  const [retEdit, setRetEdit] = useState<ReturnRecord | null>(null);

  const canUse = user?.role === "Admin" || user?.role === "Logistics Officer" || user?.role === "Operations Manager";
  const canApprove = user?.role === "Admin" || user?.role === "Operations Manager";

  const load = useCallback(async () => {
    try { const [t, r] = await Promise.all([listTransfers(), listReturns()]); setTransfers(t); setReturns(r); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("transfers-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["stock_transfers", "returns"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for Logistics, Operations and Admin.</p></Card>;

  async function saveTf(t: StockTransfer) {
    setTransfers((p) => { const i = p.findIndex((x) => x.id === t.id); const c = p.slice(); if (i === -1) c.unshift(t); else c[i] = t; return c; });
    try { await upsertTransfer(t); } catch { toast("Could not save transfer.", "error"); void load(); }
  }
  async function saveRet(r: ReturnRecord) {
    setReturns((p) => { const i = p.findIndex((x) => x.id === r.id); const c = p.slice(); if (i === -1) c.unshift(r); else c[i] = r; return c; });
    try { await upsertReturn(r); } catch { toast("Could not save return.", "error"); void load(); }
  }

  const openTransfers = transfers.filter((t) => !["Received", "Cancelled"].includes(t.status)).length;
  const openReturns = returns.filter((r) => !["Closed", "Cancelled"].includes(r.status)).length;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Open transfers" value={String(openTransfers)} tone={openTransfers > 0 ? "gold" : "default"} />
        <StatTile label="Transfers (total)" value={String(transfers.length)} />
        <StatTile label="Open returns" value={String(openReturns)} tone={openReturns > 0 ? "gold" : "default"} />
        <StatTile label="Returns (total)" value={String(returns.length)} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {(["transfers", "returns"] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold capitalize transition ${tab === t ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>
            {t === "transfers" ? "Stock transfers" : "Returns"}
          </button>
        ))}
      </div>

      {tab === "transfers" && (
        <Card>
          <CardHeader title={`Stock transfers (${transfers.length})`} action={<Button size="sm" onClick={() => setTfEdit({ id: newTransferId(), ref: nextRef("TRF", transfers), from: TRANSFER_LOCATIONS[0], to: TRANSFER_LOCATIONS[1], lines: [{ item: "", unit: "pcs", requested: 0 }], status: "Requested", requestedBy: user.email, on: nowISO(), history: [stamp(user.email, "requested")] })}>＋ New transfer</Button>} />
          <TableWrap>
            <thead><tr><Th>Ref</Th><Th>From → To</Th><Th>Items</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>
              {transfers.length === 0 ? <EmptyRow colSpan={5} text="No stock transfers yet." /> : transfers.map((t) => (
                <tr key={t.id}>
                  <Td className="font-medium">{t.ref}</Td>
                  <Td>{t.from} → {t.to}</Td>
                  <Td className="max-w-[16rem] truncate">{t.lines.map((l) => `${l.requested} ${l.unit} ${l.item}`).join(", ")}</Td>
                  <Td><Pill tone={tfTone(t.status)}>{t.status}</Pill></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setTfEdit(t)}>Open</Button></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {tab === "returns" && (
        <Card>
          <CardHeader title={`Returns (${returns.length})`} action={<Button size="sm" onClick={() => setRetEdit({ id: newReturnId(), ref: nextRef("RET", returns), source: RETURN_SOURCES[0], quantity: 0, status: "Open", by: user.email, on: nowISO(), history: [stamp(user.email, "logged")] })}>＋ Log return</Button>} />
          <TableWrap>
            <thead><tr><Th>Ref</Th><Th>Source</Th><Th>Who</Th><Th>Product</Th><Th className="text-right">Qty</Th><Th>Resolution</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>
              {returns.length === 0 ? <EmptyRow colSpan={8} text="No returns logged." /> : returns.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.ref}</Td>
                  <Td>{r.source}</Td>
                  <Td>{r.customerName || r.supplierName || r.responsible || "—"}</Td>
                  <Td>{r.product || "—"}</Td>
                  <Td className="text-right">{r.quantity.toLocaleString()}</Td>
                  <Td>{r.resolution || "—"}</Td>
                  <Td><Pill tone={retTone(r.status)}>{r.status}</Pill></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setRetEdit(r)}>Open</Button></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {tfEdit && <TransferModal key={tfEdit.id} initial={tfEdit} email={user.email} canApprove={canApprove} onClose={() => setTfEdit(null)} onSave={(t) => { void saveTf(t); setTfEdit(null); toast("Transfer saved."); }} />}
      {retEdit && <ReturnModal key={retEdit.id} initial={retEdit} email={user.email} onClose={() => setRetEdit(null)} onSave={(r) => { void saveRet(r); setRetEdit(null); toast("Return saved."); }} />}
    </div>
  );
}

// --------------------------------------------------------------------------- Transfer modal

const TF_NEXT: Partial<Record<TransferStatus, TransferStatus>> = {
  "Requested": "Approved", "Approved": "Issued", "Issued": "In Transit", "In Transit": "Received",
};

function TransferModal({ initial, email, canApprove, onClose, onSave }: {
  initial: StockTransfer; email: string; canApprove: boolean; onClose: () => void; onSave: (t: StockTransfer) => void;
}) {
  const [t, setT] = useState<StockTransfer>(initial);
  const set = (p: Partial<StockTransfer>) => setT((x) => ({ ...x, ...p }));
  const setLine = (i: number, p: Partial<TransferLine>) => set({ lines: t.lines.map((l, j) => j === i ? { ...l, ...p } : l) });
  const editable = t.status === "Requested";
  const receiving = t.status === "In Transit" || t.status === "Issued";
  const locked = t.status === "Received" || t.status === "Cancelled";
  const next = TF_NEXT[t.status];
  const canAdvance = next && (next !== "Approved" || canApprove);

  function move(status: TransferStatus, action: string) {
    onSave({ ...t, status, ...(status === "Approved" ? { approvedBy: email, approvedOn: nowISO() } : {}), history: [...t.history, stamp(email, action)] });
  }

  return (
    <Modal open onClose={onClose} title={`${t.ref} · Stock transfer`} className="max-w-2xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {!locked && <Button variant="secondary" onClick={() => onSave(t)}>Save</Button>}
        {canAdvance && <Button onClick={() => move(next!, next === "Received" ? "received & confirmed" : `→ ${next}`)}>{next === "Received" ? "Confirm receipt" : `Mark ${next}`}</Button>}
        {!locked && <button type="button" onClick={() => move("Cancelled", "cancelled")} className="ml-1 text-xs text-red underline">Cancel</button>}
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Pill tone={tfTone(t.status)}>{t.status}</Pill></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="From"><Select value={t.from} disabled={!editable} onChange={(e) => set({ from: e.target.value })} options={TRANSFER_LOCATIONS.map((l) => ({ value: l, label: l }))} /></Field>
          <Field label="To"><Select value={t.to} disabled={!editable} onChange={(e) => set({ to: e.target.value })} options={TRANSFER_LOCATIONS.map((l) => ({ value: l, label: l }))} /></Field>
          <div className="sm:col-span-2"><Field label="Reason"><Input value={t.reason ?? ""} disabled={!editable} onChange={(e) => set({ reason: e.target.value })} /></Field></div>
        </div>
        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Items {receiving && "— record what was received"}</div>
          <TableWrap>
            <thead><tr><Th>Item</Th><Th className="w-20">Unit</Th><Th className="w-20 text-right">Req</Th><Th className="w-20 text-right">Issued</Th><Th className="w-20 text-right">Recv</Th><Th className="w-20 text-right">Damaged</Th><Th className="text-right">Short</Th><Th></Th></tr></thead>
            <tbody>
              {t.lines.map((l, i) => (
                <tr key={i}>
                  <Td><Input value={l.item} disabled={!editable} onChange={(e) => setLine(i, { item: e.target.value })} /></Td>
                  <Td><Input value={l.unit} disabled={!editable} onChange={(e) => setLine(i, { unit: e.target.value })} /></Td>
                  <Td><Input type="number" min={0} value={l.requested || ""} disabled={!editable} onChange={(e) => setLine(i, { requested: Number(e.target.value) || 0 })} /></Td>
                  <Td><Input type="number" min={0} value={l.issued ?? ""} disabled={locked || editable} onChange={(e) => setLine(i, { issued: Number(e.target.value) || undefined })} /></Td>
                  <Td><Input type="number" min={0} value={l.received ?? ""} disabled={!receiving} onChange={(e) => setLine(i, { received: Number(e.target.value) || undefined })} /></Td>
                  <Td><Input type="number" min={0} value={l.damaged ?? ""} disabled={!receiving} onChange={(e) => setLine(i, { damaged: Number(e.target.value) || undefined })} /></Td>
                  <Td className="text-right">{transferShortage(l) > 0 ? <span className="text-red">{transferShortage(l)}</span> : "—"}</Td>
                  <Td>{editable && t.lines.length > 1 && <Button size="sm" variant="ghost" onClick={() => set({ lines: t.lines.filter((_, j) => j !== i) })}>✕</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {editable && <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ lines: [...t.lines, { item: "", unit: "pcs", requested: 0 }] })}>＋ Add item</Button>}
        </div>
        <p className="text-xs text-muted">Sending store issues the items; the receiving location confirms receipt; shortages and damage are recorded here for both stores&apos; inventory.</p>
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------- Return modal

function ReturnModal({ initial, email, onClose, onSave }: {
  initial: ReturnRecord; email: string; onClose: () => void; onSave: (r: ReturnRecord) => void;
}) {
  const [r, setR] = useState<ReturnRecord>(initial);
  const set = (p: Partial<ReturnRecord>) => setR((x) => ({ ...x, ...p }));
  const locked = r.status === "Closed" || r.status === "Cancelled";
  const isSupplier = r.source === "Supplier";
  const move = (status: ReturnStatus, action: string) => onSave({ ...r, status, history: [...r.history, stamp(email, action)] });

  return (
    <Modal open onClose={onClose} title={`${r.ref} · Return`} className="max-w-2xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>Close</Button>
        {!locked && <Button variant="secondary" onClick={() => onSave(r)}>Save</Button>}
        {r.status === "Open" && <Button onClick={() => move("Under review", "under review")}>Send for review</Button>}
        {r.status === "Under review" && <Button onClick={() => move("Resolved", "resolved")} disabled={!r.resolution}>Mark resolved</Button>}
        {r.status === "Resolved" && <Button onClick={() => move("Closed", "closed")}>Close</Button>}
        {!locked && <button type="button" onClick={() => move("Cancelled", "cancelled")} className="ml-1 text-xs text-red underline">Cancel</button>}
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Pill tone={retTone(r.status)}>{r.status}</Pill></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Source"><Select value={r.source} disabled={locked} onChange={(e) => set({ source: e.target.value })} options={RETURN_SOURCES.map((s) => ({ value: s, label: s }))} /></Field>
          {isSupplier
            ? <Field label="Supplier"><Input value={r.supplierName ?? ""} disabled={locked} onChange={(e) => set({ supplierName: e.target.value })} /></Field>
            : <Field label="Customer / who"><Input value={r.customerName ?? ""} disabled={locked} onChange={(e) => set({ customerName: e.target.value })} /></Field>}
          {isSupplier
            ? <Field label="PO ref"><Input value={r.poRef ?? ""} disabled={locked} onChange={(e) => set({ poRef: e.target.value })} /></Field>
            : <Field label="Original order ref"><Input value={r.orderId ?? ""} disabled={locked} onChange={(e) => set({ orderId: e.target.value })} placeholder="order id / ref" /></Field>}
          <Field label="Product"><Input value={r.product ?? ""} disabled={locked} onChange={(e) => set({ product: e.target.value })} /></Field>
          <Field label="Quantity returned"><Input type="number" min={0} value={r.quantity || ""} disabled={locked} onChange={(e) => set({ quantity: Number(e.target.value) || 0 })} /></Field>
          <Field label="Condition"><Select value={r.condition ?? ""} disabled={locked} onChange={(e) => set({ condition: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...RETURN_CONDITIONS.map((c) => ({ value: c, label: c }))]} /></Field>
          <Field label="Delivery trip / ref"><Input value={r.tripId ?? ""} disabled={locked} onChange={(e) => set({ tripId: e.target.value })} /></Field>
          <Field label="Responsible person"><Input value={r.responsible ?? ""} disabled={locked} onChange={(e) => set({ responsible: e.target.value })} /></Field>
          <Field label="Financial effect (RWF)"><Input type="number" value={r.financialEffect ?? ""} disabled={locked} onChange={(e) => set({ financialEffect: Number(e.target.value) || undefined })} /></Field>
          <Field label="Resolution"><Select value={r.resolution ?? ""} disabled={locked} onChange={(e) => set({ resolution: e.target.value || undefined })} options={[{ value: "", label: "—" }, ...RETURN_RESOLUTIONS.map((c) => ({ value: c, label: c }))]} /></Field>
          <div className="sm:col-span-2"><Field label="Reason"><Input value={r.reason ?? ""} disabled={locked} onChange={(e) => set({ reason: e.target.value })} /></Field></div>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={!!r.notifyFinance} disabled={locked} onChange={(e) => set({ notifyFinance: e.target.checked })} /> Notify Finance {r.financialEffect ? `(effect ${formatRWF(r.financialEffect)})` : "(financial effect)"}
        </label>
        <p className="text-xs text-muted">Accepted inventory is reduced where necessary; a supplier return requests a replacement or credit note. Finance handles any credit, refund or adjustment.</p>
      </div>
    </Modal>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useLang } from "@/components/LanguageProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { formatDate, nowISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { fetchTable, upsertRow } from "@/lib/hatchery/db";
import type { Purchase, SparePart, Supply } from "@/lib/hatchery/types";
import {
  MSR_PAYMENT_METHODS, MSR_PRIORITIES, MSR_TYPES, MSR_UNITS, NEXT_STATUS, isOpen, listMaterialRequests,
  newMaterialRequestId, nextRef, stamp, upsertMaterialRequest, whoActs,
  type MSRItem, type MSRStatus, type MaterialRequest,
} from "@/lib/materialRequests";

/** Add a paid request's items to stock: spare parts → spare-parts store,
 *  materials → hatchery inventory. Merges into an existing item by name. */
async function receiveIntoStock(r: MaterialRequest, actor: { email: string; name: string }) {
  const isSpare = r.type === "Spare parts";
  const [supplies, spares] = await Promise.all([fetchTable<Supply>("supplies"), fetchTable<SparePart>("spare_parts")]);
  const totalQty = r.items.reduce((s, i) => s + (Number(i.quantity) || 0), 0) || 1;
  const perUnit = Math.round((Number(r.payment?.amount) || 0) / totalQty);
  const supplier = r.payment?.supplier?.trim() ?? "";
  const on = new Date().toISOString();
  const rid = () => `${isSpare ? "spr" : "sup"}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

  for (const it of r.items) {
    const qty = Number(it.quantity) || 0;
    if (qty <= 0 || !it.name.trim()) continue;
    const purchase: Purchase = { qty, unitCost: perUnit, supplier, on, by: actor.email };
    const key = it.name.trim().toLowerCase();
    if (isSpare) {
      const ex = spares.find((s) => s.name.trim().toLowerCase() === key);
      const row: SparePart = ex
        ? { ...ex, quantity: ex.quantity + qty, purchases: [...(ex.purchases ?? []), purchase], history: [...ex.history, `${on} — +${qty} ${ex.unit} from ${r.ref} by ${actor.name}`], on }
        : { id: rid(), name: it.name.trim(), unit: it.unit, quantity: qty, purchases: [purchase], history: [`${on} — created (${qty} ${it.unit}) from ${r.ref} by ${actor.name}`], by: actor.email, on };
      await upsertRow("spare_parts", row);
    } else {
      const ex = supplies.find((s) => s.name.trim().toLowerCase() === key);
      const row: Supply = ex
        ? { ...ex, quantity: ex.quantity + qty, purchases: [...(ex.purchases ?? []), purchase], history: [...ex.history, `${on} — +${qty} ${ex.unit} from ${r.ref} by ${actor.name}`], on }
        : { id: rid(), kind: "hygiene", name: it.name.trim(), unit: it.unit, quantity: qty, purchases: [purchase], history: [`${on} — created (${qty} ${it.unit}) from ${r.ref} by ${actor.name}`], by: actor.email, on };
      await upsertRow("supplies", row);
    }
  }
}

const tone = (s: MSRStatus) =>
  s === "Filed" ? "green" : s === "Rejected" ? "red" : s === "Paid" ? "info"
    : s === "Requested" ? "gold" : "purple";

export default function MaterialRequestsPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { toast } = useToast();
  const [rows, setRows] = useState<MaterialRequest[]>([]);
  const [creating, setCreating] = useState(false);
  const [view, setView] = useState<MaterialRequest | null>(null);

  const role = user?.role;
  // Everyone but DSRs and the shared attendant tablet can reach this workspace.
  const canUse = !!role && role !== "DSR" && role !== "Hatchery Attendant";
  const isLogistics = role === "Admin" || role === "Logistics Officer";
  const isAdmin = role === "Admin";
  const isFinance = role === "Admin" || role === "Accountant";

  const load = useCallback(async () => { try { setRows(await listMaterialRequests()); } catch { /* keep */ } }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("material-requests-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "material_requests") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const awaitingLogistics = rows.filter((r) => r.status === "Requested" || r.status === "Finance authorized").length;
  const awaitingAdmin = rows.filter((r) => r.status === "Logistics approved").length;
  const atFinance = rows.filter((r) => r.status === "Admin approved" || r.status === "Paid").length;
  const open = rows.filter(isOpen).length;

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">{t("This page is for staff who raise or handle material & spare-part requests.")}</p></Card>;

  async function save(r: MaterialRequest) {
    setRows((p) => { const i = p.findIndex((x) => x.id === r.id); const c = p.slice(); if (i === -1) c.unshift(r); else c[i] = r; return c; });
    try { await upsertMaterialRequest(r); } catch { toast(t("Could not save."), "error"); void load(); }
  }

  /** On payment confirmation, add the bought items to stock (once). */
  async function saveFromDetail(r: MaterialRequest) {
    let next = r;
    if (r.status === "Paid" && !r.receivedToStock && r.payment) {
      try {
        await receiveIntoStock(r, { email: user!.email, name: user!.name });
        next = { ...r, receivedToStock: true, history: [...r.history, stamp(user!.email, `received into ${r.type === "Spare parts" ? "spare parts" : "inventory"}`)] };
        toast(`${t("Payment confirmed — items added to")} ${r.type === "Spare parts" ? t("spare parts") : t("inventory")}.`);
      } catch { toast(t("Payment saved, but could not update stock — add it manually."), "error"); }
    } else {
      toast(t("Request updated."));
    }
    await save(next);
    setView(null);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("Awaiting Logistics")} value={String(awaitingLogistics)} tone={awaitingLogistics > 0 ? "gold" : "default"} />
        <StatTile label={t("Awaiting Admin")} value={String(awaitingAdmin)} tone={awaitingAdmin > 0 ? "gold" : "default"} />
        <StatTile label={t("At Finance")} value={String(atFinance)} tone={atFinance > 0 ? "gold" : "default"} />
        <StatTile label={t("Open requests")} value={String(open)} />
      </div>

      <Card>
        <CardHeader title={`${t("Material & spare-part requests")} (${rows.length})`} action={<Button size="sm" onClick={() => setCreating(true)}>＋ {t("New request")}</Button>} />
        <TableWrap>
          <thead><tr><Th>{t("Ref")}</Th><Th>{t("Type")}</Th><Th>{t("Items")}</Th><Th>{t("For")}</Th><Th>{t("Requested by")}</Th><Th>{t("Status")}</Th><Th></Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={7} text={t("No requests yet.")} /> : rows.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.ref}</Td>
                <Td>{r.type}</Td>
                <Td className="max-w-[16rem] truncate">{r.items.map((i) => `${i.quantity} ${i.unit} ${i.name}`).join(", ")}</Td>
                <Td>{r.forItem || r.department || "—"}</Td>
                <Td className="text-xs text-muted">{r.requestedByName || r.requestedBy}</Td>
                <Td><Pill tone={tone(r.status)}>{r.status}</Pill></Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setView(r)}>{t("Open")}</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">{t("Flow: Requested → Logistics → Admin → Finance authorises → Logistics confirms payment → Finance files.")}</p>
      </Card>

      {creating && (
        <CreateModal email={user.email} name={user.name} nextRefValue={nextRef(rows)}
          onClose={() => setCreating(false)}
          onSave={(r) => { void save(r); setCreating(false); toast(`${r.ref} ${t("submitted.")}`); }} />
      )}

      {view && (
        <DetailModal key={view.id} initial={view} email={user.email} isLogistics={isLogistics} isAdmin={isAdmin} isFinance={isFinance}
          onClose={() => setView(null)}
          onSave={(r) => { void saveFromDetail(r); }} />
      )}
    </div>
  );
}

function CreateModal({ email, name, nextRefValue, onClose, onSave }: {
  email: string; name: string; nextRefValue: string; onClose: () => void; onSave: (r: MaterialRequest) => void;
}) {
  const { t } = useLang();
  const [r, setR] = useState<MaterialRequest>({
    id: newMaterialRequestId(), ref: nextRefValue, type: MSR_TYPES[0], items: [{ name: "", quantity: 1, unit: "pcs" }],
    priority: "Normal", status: "Requested", requestedBy: email, requestedByName: name, on: nowISO(), history: [stamp(email, "requested")],
  });
  const set = (p: Partial<MaterialRequest>) => setR((x) => ({ ...x, ...p }));
  const setItem = (i: number, p: Partial<MSRItem>) => set({ items: r.items.map((it, j) => j === i ? { ...it, ...p } : it) });

  function submit() {
    const items = r.items.filter((i) => i.name.trim() && (Number(i.quantity) || 0) > 0);
    if (items.length === 0) return;
    onSave({ ...r, items });
  }

  return (
    <Modal open onClose={onClose} title={t("New material / spare-part request")} className="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button><Button onClick={submit}>{t("Submit request")}</Button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("Type")}><Select value={r.type} onChange={(e) => set({ type: e.target.value })} options={MSR_TYPES.map((t) => ({ value: t, label: t }))} /></Field>
          <Field label={t("Priority")}><Select value={r.priority} onChange={(e) => set({ priority: e.target.value })} options={MSR_PRIORITIES.map((p) => ({ value: p, label: p }))} /></Field>
          <Field label={t("Department")}><Input value={r.department ?? ""} onChange={(e) => set({ department: e.target.value })} placeholder={t("Hatchery, Parent stock…")} /></Field>
          <Field label={t("For (machine / area)")}><Input value={r.forItem ?? ""} onChange={(e) => set({ forItem: e.target.value })} placeholder={t("e.g. Setter S02")} /></Field>
        </div>
        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{t("Items")}</div>
          <TableWrap>
            <thead><tr><Th>{t("Item")}</Th><Th className="w-20 text-right">{t("Qty")}</Th><Th className="w-28">{t("Unit")}</Th><Th></Th></tr></thead>
            <tbody>
              {r.items.map((it, i) => (
                <tr key={i}>
                  <Td><Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} /></Td>
                  <Td><Input type="number" min={0} value={it.quantity || ""} onChange={(e) => setItem(i, { quantity: Number(e.target.value) || 0 })} /></Td>
                  <Td><Select value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} options={MSR_UNITS.map((u) => ({ value: u, label: u }))} /></Td>
                  <Td>{r.items.length > 1 && <Button size="sm" variant="ghost" onClick={() => set({ items: r.items.filter((_, j) => j !== i) })}>✕</Button>}</Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ items: [...r.items, { name: "", quantity: 1, unit: "pcs" }] })}>＋ {t("Add item")}</Button>
        </div>
        <Field label={t("Reason")}><Input value={r.reason ?? ""} onChange={(e) => set({ reason: e.target.value })} placeholder={t("Why these are needed")} /></Field>
      </div>
    </Modal>
  );
}

function DetailModal({ initial, email, isLogistics, isAdmin, isFinance, onClose, onSave }: {
  initial: MaterialRequest; email: string; isLogistics: boolean; isAdmin: boolean; isFinance: boolean;
  onClose: () => void; onSave: (r: MaterialRequest) => void;
}) {
  const { t } = useLang();
  const [r, setR] = useState<MaterialRequest>(initial);
  const [rejectNote, setRejectNote] = useState("");
  const [pay, setPay] = useState({ amount: "", method: "Cash", ref: "", supplier: "" });

  const actor = whoActs(r.status);
  const canActNow =
    (actor === "logistics" && isLogistics) ||
    (actor === "admin" && isAdmin) ||
    (actor === "finance" && isFinance);
  const isPaymentStage = r.status === "Finance authorized";
  const canReject = isOpen(r) && r.status !== "Paid" && canActNow;

  // Logistics can add/remove/adjust the submitted items before it's paid.
  const canEditItems = isLogistics && isOpen(r) && r.status !== "Paid";
  const itemsChanged = JSON.stringify(r.items) !== JSON.stringify(initial.items);
  const setItem = (i: number, p: Partial<MSRItem>) => setR((x) => ({ ...x, items: x.items.map((it, j) => j === i ? { ...it, ...p } : it) }));
  const addItem = () => setR((x) => ({ ...x, items: [...x.items, { name: "", quantity: 1, unit: "pcs" }] }));
  const removeItem = (i: number) => setR((x) => ({ ...x, items: x.items.filter((_, j) => j !== i) }));
  function saveItems() {
    const items = r.items.filter((it) => it.name.trim() && (Number(it.quantity) || 0) > 0);
    if (items.length === 0) return;
    onSave({ ...r, items, history: [...r.history, stamp(email, "items updated by Logistics")] });
  }

  function advance() {
    const next = NEXT_STATUS[r.status];
    if (!next) return;
    const now = nowISO();
    const patch: Partial<MaterialRequest> = { status: next };
    if (r.status === "Requested") { patch.logisticsBy = email; patch.logisticsOn = now; }
    else if (r.status === "Logistics approved") { patch.adminBy = email; patch.adminOn = now; }
    else if (r.status === "Admin approved") { patch.financeBy = email; patch.financeOn = now; }
    else if (r.status === "Paid") { patch.filedBy = email; patch.filedOn = now; }
    const labels: Record<string, string> = { "Requested": "Logistics approved", "Logistics approved": "Admin approved", "Admin approved": "Finance authorised", "Paid": "filed" };
    onSave({ ...r, ...patch, history: [...r.history, stamp(email, labels[r.status] ?? next)] });
  }
  function confirmPayment() {
    const amount = Number(pay.amount) || 0;
    if (amount <= 0) return;
    onSave({
      ...r, status: "Paid",
      payment: { amount, method: pay.method, ref: pay.ref.trim() || undefined, supplier: pay.supplier.trim() || undefined, by: email, on: nowISO() },
      history: [...r.history, stamp(email, `payment confirmed — ${amount.toLocaleString()} RWF (${pay.method})`)],
    });
  }
  function reject() {
    if (!rejectNote.trim()) return;
    onSave({ ...r, status: "Rejected", decisionNote: rejectNote.trim(), history: [...r.history, stamp(email, `rejected — ${rejectNote.trim()}`)] });
  }

  const advanceLabels: Record<string, string> = { "Requested": t("Logistics: approve"), "Logistics approved": t("Admin: approve"), "Admin approved": t("Finance: authorise spend"), "Paid": t("Finance: file & keep") };
  const advanceLabel = advanceLabels[r.status];

  return (
    <Modal open onClose={onClose} title={`${r.ref} · ${r.type}`} className="max-w-2xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Close")}</Button>
        {canReject && <Button variant="secondary" onClick={reject} disabled={!rejectNote.trim()}>{t("Reject")}</Button>}
        {canActNow && !isPaymentStage && NEXT_STATUS[r.status] && <Button onClick={advance}>{advanceLabel}</Button>}
        {isPaymentStage && isLogistics && <Button onClick={confirmPayment} disabled={!(Number(pay.amount) > 0)}>{t("Confirm payment")}</Button>}
      </>}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={tone(r.status)}>{r.status}</Pill>
          <span className="text-xs text-muted">{r.priority} {t("priority · requested by")} {r.requestedByName || r.requestedBy} · {formatDate(r.on)}</span>
        </div>

        <div className="grid grid-cols-2 gap-3 text-sm">
          {r.department && <div><span className="text-muted">{t("Department:")}</span> {r.department}</div>}
          {r.forItem && <div><span className="text-muted">{t("For:")}</span> {r.forItem}</div>}
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{t("Items")}</div>
            {canEditItems && <span className="text-[0.66rem] text-muted">{t("Logistics can add / remove / adjust")}</span>}
          </div>
          <TableWrap>
            <thead><tr><Th>{t("Item")}</Th><Th className="w-20 text-right">{t("Qty")}</Th><Th className="w-28">{t("Unit")}</Th>{canEditItems && <Th></Th>}</tr></thead>
            <tbody>
              {canEditItems
                ? r.items.map((it, i) => (
                  <tr key={i}>
                    <Td><Input value={it.name} onChange={(e) => setItem(i, { name: e.target.value })} /></Td>
                    <Td><Input type="number" min={0} value={it.quantity || ""} onChange={(e) => setItem(i, { quantity: Number(e.target.value) || 0 })} /></Td>
                    <Td><Select value={it.unit} onChange={(e) => setItem(i, { unit: e.target.value })} options={MSR_UNITS.map((u) => ({ value: u, label: u }))} /></Td>
                    <Td>{r.items.length > 1 && <Button size="sm" variant="ghost" onClick={() => removeItem(i)}>✕</Button>}</Td>
                  </tr>
                ))
                : r.items.map((it, i) => <tr key={i}><Td className="font-medium">{it.name}</Td><Td className="text-right">{it.quantity.toLocaleString()}</Td><Td>{it.unit}</Td></tr>)}
            </tbody>
          </TableWrap>
          {canEditItems && (
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="ghost" onClick={addItem}>＋ {t("Add item")}</Button>
              {itemsChanged && <Button size="sm" variant="secondary" onClick={saveItems}>{t("Save item changes")}</Button>}
            </div>
          )}
        </div>
        {r.reason && <div className="text-sm"><span className="text-muted">{t("Reason:")}</span> {r.reason}</div>}

        {/* Approval trail */}
        <div className="rounded-lg border border-line p-3 text-xs">
          <div className="mb-1 font-semibold text-ink">{t("Approval trail")}</div>
          <div className="space-y-0.5 text-muted">
            <div>{t("Logistics:")} {r.logisticsBy ? `${r.logisticsBy} · ${formatDate(r.logisticsOn!)}` : "—"}</div>
            <div>{t("Admin:")} {r.adminBy ? `${r.adminBy} · ${formatDate(r.adminOn!)}` : "—"}</div>
            <div>{t("Finance authorised:")} {r.financeBy ? `${r.financeBy} · ${formatDate(r.financeOn!)}` : "—"}</div>
            {r.payment && <div className="text-ink">{t("Paid:")} {formatRWF(r.payment.amount)} · {r.payment.method}{r.payment.supplier ? ` · ${r.payment.supplier}` : ""}{r.payment.ref ? ` · ${r.payment.ref}` : ""} {t("— by")} {r.payment.by}</div>}
            {r.filedBy && <div className="text-green">{t("Filed by")} {r.filedBy} · {formatDate(r.filedOn!)}</div>}
          </div>
        </div>

        {r.status === "Rejected" && r.decisionNote && <div className="rounded-lg border border-red/30 bg-red-bg/50 p-3 text-sm"><strong>{t("Rejected:")}</strong> {r.decisionNote}</div>}

        {/* Payment entry (Logistics, once Finance authorised) */}
        {isPaymentStage && isLogistics && (
          <div className="rounded-lg border border-gold/30 bg-gold-bg/30 p-3">
            <div className="mb-2 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{t("Confirm payment (items bought)")}</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Field label={t("Amount (RWF)")}><Input type="number" min={0} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></Field>
              <Field label={t("Method")}><Select value={pay.method} onChange={(e) => setPay({ ...pay, method: e.target.value })} options={MSR_PAYMENT_METHODS.map((m) => ({ value: m, label: m }))} /></Field>
              <Field label={t("Supplier")}><Input value={pay.supplier} onChange={(e) => setPay({ ...pay, supplier: e.target.value })} /></Field>
              <Field label={t("Reference")}><Input value={pay.ref} onChange={(e) => setPay({ ...pay, ref: e.target.value })} placeholder={t("receipt / txn")} /></Field>
            </div>
            <p className="mt-2 text-xs text-muted">{t("Confirming adds these items to")} {r.type === "Spare parts" ? t("the spare-parts store") : t("inventory")} {t("and posts the spend to the ledger.")}</p>
          </div>
        )}

        {/* Reject reason */}
        {canReject && (
          <Field label={t("Rejection reason (returns to the requester)")}><Input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)} /></Field>
        )}

        {!canActNow && isOpen(r) && (
          <p className="text-xs text-muted">{t("Waiting on")} {actor === "logistics" ? t("Logistics") : actor === "admin" ? t("the Admin") : t("Finance")} {t("at this stage.")}</p>
        )}
      </div>
    </Modal>
  );
}

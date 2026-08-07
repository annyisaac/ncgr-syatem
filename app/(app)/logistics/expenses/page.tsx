"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  EXPENSE_PAYMENT_STATUSES, LOGISTICS_EXPENSE_CATEGORIES, PAYMENT_METHODS,
  expenseTotal, listLogisticsExpenses, newLogisticsExpenseId, nextRef, stamp, upsertLogisticsExpense,
  type ExpenseStatus, type LogisticsExpense,
} from "@/lib/logisticsOps";

const stTone = (s: ExpenseStatus) =>
  s === "Posted" ? "green" : s === "Rejected" ? "red" : s === "Approved" ? "info" : s === "Verified" ? "purple" : s === "Submitted" ? "gold" : "neutral";

export default function LogisticsExpensesPage() {
  const { user } = useAuth();
  const { t } = useLang();
  const { toast } = useToast();
  const [rows, setRows] = useState<LogisticsExpense[]>([]);
  const [editing, setEditing] = useState<LogisticsExpense | null>(null);

  const role = user?.role;
  const canUse = role === "Admin" || role === "Logistics Officer" || role === "Operations Manager" || role === "Accountant";

  const load = useCallback(async () => {
    try { setRows(await listLogisticsExpenses()); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("logistics-expenses-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "logistics_expenses") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const awaitingVerify = rows.filter((r) => r.status === "Submitted").length;
  const awaitingPost = rows.filter((r) => r.status === "Approved").length;
  const posted = rows.filter((r) => r.status === "Posted");

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">{t("This page is for Logistics, Operations, Finance and Admin.")}</p></Card>;

  async function save(e: LogisticsExpense) {
    setRows((p) => { const i = p.findIndex((x) => x.id === e.id); const c = p.slice(); if (i === -1) c.unshift(e); else c[i] = e; return c; });
    try { await upsertLogisticsExpense(e); } catch { toast(t("Could not save expense."), "error"); void load(); }
  }
  function openNew() {
    setEditing({ id: newLogisticsExpenseId(), ref: nextRef("LEX", rows), date: todayISO(), category: LOGISTICS_EXPENSE_CATEGORIES[0], amount: 0, status: "Draft", paymentStatus: "Unpaid", submittedBy: user!.email, on: nowISO(), history: [stamp(user!.email, "created")] });
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={t("Awaiting verify (Ops)")} value={String(awaitingVerify)} tone={awaitingVerify > 0 ? "gold" : "default"} />
        <StatTile label={t("Awaiting posting")} value={String(awaitingPost)} tone={awaitingPost > 0 ? "gold" : "default"} />
        <StatTile label={t("Posted")} value={String(posted.length)} tone="green" />
        <StatTile label={t("Posted value")} value={formatRWF(expenseTotal(posted))} />
      </div>

      <Card>
        <CardHeader title={`${t("Logistics expenses")} (${rows.length})`}
          action={(role === "Admin" || role === "Logistics Officer") && <Button size="sm" onClick={openNew}>＋ {t("New expense")}</Button>} />
        <TableWrap>
          <thead><tr><Th>{t("Ref")}</Th><Th>{t("Date")}</Th><Th>{t("Category")}</Th><Th>{t("Payee")}</Th><Th className="text-right">{t("Amount")}</Th><Th>{t("Status")}</Th><Th>{t("Payment")}</Th><Th></Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={8} text={t("No logistics expenses yet.")} /> : rows.map((e) => (
              <tr key={e.id}>
                <Td className="font-medium">{e.ref}</Td>
                <Td>{formatDate(e.date)}</Td>
                <Td>{e.category}</Td>
                <Td>{e.payee || "—"}</Td>
                <Td className="text-right">{formatRWF(e.amount)}</Td>
                <Td><Pill tone={stTone(e.status)}>{e.status}</Pill></Td>
                <Td>{e.status === "Posted" ? <Pill tone={e.paymentStatus === "Paid" ? "green" : e.paymentStatus === "Partially Paid" ? "gold" : "neutral"}>{e.paymentStatus}</Pill> : "—"}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => setEditing(e)}>{t("Open")}</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {editing && <ExpenseModal key={editing.id} initial={editing} email={user.email} role={role!} onClose={() => setEditing(null)} onSave={(e) => { void save(e); setEditing(null); toast(t("Expense saved.")); }} />}
    </div>
  );
}

function ExpenseModal({ initial, email, role, onClose, onSave }: {
  initial: LogisticsExpense; email: string; role: string; onClose: () => void; onSave: (e: LogisticsExpense) => void;
}) {
  const { t } = useLang();
  const [e, setE] = useState<LogisticsExpense>(initial);
  const set = (p: Partial<LogisticsExpense>) => setE((x) => ({ ...x, ...p }));

  const isLogistics = role === "Admin" || role === "Logistics Officer";
  const isOps = role === "Admin" || role === "Operations Manager";
  const isFinance = role === "Admin" || role === "Accountant";
  const editable = (e.status === "Draft" || e.status === "Rejected") && isLogistics;
  const move = useMemo(() => (status: ExpenseStatus, action: string, extra: Partial<LogisticsExpense> = {}) =>
    onSave({ ...e, status, ...extra, history: [...e.history, stamp(email, action)] }), [e, email, onSave]);

  return (
    <Modal open onClose={onClose} title={`${e.ref} · ${t("Logistics expense")}`} className="max-w-2xl"
      footer={<>
        <Button variant="ghost" onClick={onClose}>{t("Close")}</Button>
        {editable && <Button variant="secondary" onClick={() => onSave(e)}>{t("Save")}</Button>}
        {(e.status === "Draft" || e.status === "Rejected") && isLogistics && <Button onClick={() => move("Submitted", "submitted", { submittedBy: email })} disabled={!(e.amount > 0)}>{t("Submit")}</Button>}
        {e.status === "Submitted" && isOps && <><Button variant="secondary" onClick={() => move("Rejected", "rejected by Operations")}>{t("Reject")}</Button><Button onClick={() => move("Verified", "verified by Operations", { verifiedBy: email })}>{t("Verify")}</Button></>}
        {e.status === "Verified" && isFinance && <><Button variant="secondary" onClick={() => move("Rejected", "rejected by Finance")}>{t("Reject")}</Button><Button onClick={() => move("Approved", "approved for payment", { approvedBy: email })}>{t("Approve")}</Button></>}
        {e.status === "Approved" && isFinance && <Button onClick={() => move("Posted", "posted", { postedBy: email })}>{t("Post to accounts")}</Button>}
      </>}>
      <div className="space-y-4">
        <div className="flex items-center gap-2"><Pill tone={stTone(e.status)}>{e.status}</Pill></div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t("Date")}><Input type="date" value={e.date} disabled={!editable} onChange={(ev) => set({ date: ev.target.value })} /></Field>
          <Field label={t("Category")}><Select value={e.category} disabled={!editable} onChange={(ev) => set({ category: ev.target.value })} options={LOGISTICS_EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label={t("Amount (RWF)")}><Input type="number" min={0} value={e.amount || ""} disabled={!editable} onChange={(ev) => set({ amount: Number(ev.target.value) || 0 })} /></Field>
          <Field label={t("Payment method")}><Select value={e.paymentMethod ?? ""} disabled={!editable} onChange={(ev) => set({ paymentMethod: ev.target.value || undefined })} options={[{ value: "", label: "—" }, ...PAYMENT_METHODS.map((m) => ({ value: m, label: m }))]} /></Field>
          <Field label={t("Supplier / payee")}><Input value={e.payee ?? ""} disabled={!editable} onChange={(ev) => set({ payee: ev.target.value })} /></Field>
          <Field label={t("Trip ref")}><Input value={e.tripId ?? ""} disabled={!editable} onChange={(ev) => set({ tripId: ev.target.value })} /></Field>
          <Field label={t("Vehicle")}><Input value={e.vehicleId ?? ""} disabled={!editable} onChange={(ev) => set({ vehicleId: ev.target.value })} placeholder={t("plate")} /></Field>
          <Field label={t("Cost centre")}><Input value={e.costCentre ?? ""} disabled={!editable} onChange={(ev) => set({ costCentre: ev.target.value })} /></Field>
          <Field label={t("Production batch / order")}><Input value={e.batchOrOrder ?? ""} disabled={!editable} onChange={(ev) => set({ batchOrOrder: ev.target.value })} /></Field>
          <Field label={t("Receipt (reference)")}><Input value={e.receiptRef ?? ""} disabled={!editable} onChange={(ev) => set({ receiptRef: ev.target.value })} /></Field>
          <div className="sm:col-span-2"><Field label={t("Reason")}><Input value={e.reason ?? ""} disabled={!editable} onChange={(ev) => set({ reason: ev.target.value })} /></Field></div>
        </div>

        {e.status === "Posted" && isFinance && (
          <Field label={t("Payment status")}><Select value={e.paymentStatus ?? "Unpaid"} onChange={(ev) => onSave({ ...e, paymentStatus: ev.target.value, history: [...e.history, stamp(email, `payment ${ev.target.value}`)] })} options={EXPENSE_PAYMENT_STATUSES.map((s) => ({ value: s, label: s }))} /></Field>
        )}

        <div className="rounded-lg border border-line p-3 text-xs text-muted">
          <div className="font-semibold text-ink">{t("Approval trail")}</div>
          <div className="mt-1">{t("Logistics submits → Operations verifies → Finance approves → the Accountant posts. Logistics can watch the status but can't approve or post.")}</div>
          {e.history.length > 0 && <ul className="mt-2 space-y-0.5">{e.history.slice(-6).map((h, i) => <li key={i} className="font-mono text-[0.68rem]">{h}</li>)}</ul>}
        </div>
      </div>
    </Modal>
  );
}

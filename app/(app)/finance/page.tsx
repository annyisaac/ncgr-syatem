"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { ALL_TIME, inRange as dateInRange } from "@/components/ui/DateRange";
import { PERIODS, presetToRange, type PeriodPreset } from "@/lib/period";
import { formatRWF } from "@/lib/config";
import { formatDate, formatDateTime, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { financePDF } from "@/lib/reports";
import {
  EXPENSE_CATEGORIES,
  financeSummary,
  listExpenses,
  newExpenseId,
  removeExpense,
  upsertExpense,
  type Expense,
} from "@/lib/finance";

export default function FinancePage() {
  const { user } = useAuth();
  const { orders, commissions } = useData();
  const { toast } = useToast();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [preset, setPreset] = useState<PeriodPreset>("month");

  // Expense entry
  const [cat, setCat] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");

  const canUse = user?.role === "Admin" || user?.role === "Accountant";

  const load = useCallback(async () => {
    try {
      setExpenses(await listExpenses());
    } catch {
      /* keep what we have */
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);

  // Live: expenses added elsewhere appear without a refresh.
  useEffect(() => {
    if (!canUse) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sb = getSupabase();
    const channel = sb
      .channel("finance-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: { table?: string }) => {
        if (payload.table === "expenses") {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => void load(), 350);
        }
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [canUse, load]);

  const range = presetToRange(preset, ALL_TIME, todayISO());
  const pred = useCallback(
    (d: string) => (!range.from && !range.to ? true : dateInRange(d, range)),
    [range]
  );
  const periodLabel = PERIODS.find((p) => p.value === preset)?.label ?? "All time";

  const summary = useMemo(
    () => financeSummary(orders, commissions, expenses, pred),
    [orders, commissions, expenses, pred]
  );
  const shownExpenses = useMemo(
    () => expenses.filter((e) => pred(e.date)).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [expenses, pred]
  );

  if (!user) return null;
  if (!canUse) {
    return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;
  }

  async function addExpense(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amt) || 0;
    if (n <= 0) return toast("Enter an amount greater than zero.", "info");
    const exp: Expense = { id: newExpenseId(), category: cat, amount: n, date, note: note.trim() || undefined, by: user!.email, on: nowISO() };
    setExpenses((prev) => [exp, ...prev]); // optimistic
    try {
      await upsertExpense(exp);
      toast("Expense recorded.");
    } catch {
      toast("Could not save the expense.", "error");
      void load();
    }
    setAmt(""); setNote("");
  }

  async function del(id: string) {
    if (!confirm("Delete this expense?")) return;
    setExpenses((prev) => prev.filter((e) => e.id !== id));
    try {
      await removeExpense(id);
      toast("Expense deleted.");
    } catch {
      toast("Could not delete.", "error");
      void load();
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Financial overview — revenue, cash, receivables, commissions and expenses.</p>
        <div className="flex items-center gap-2">
          <div className="w-40"><Select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} options={PERIODS.filter((p) => p.value !== "custom")} /></div>
          <Button variant="secondary" onClick={() => void financePDF(summary, shownExpenses, periodLabel)}>Download report (PDF)</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Revenue (billed)" value={formatRWF(summary.revenue)} />
        <StatTile label="Cash collected" value={formatRWF(summary.collected)} tone="green" />
        <StatTile label="Receivables (owed to us)" value={formatRWF(summary.receivable)} tone={summary.receivable > 0 ? "gold" : undefined} />
        <StatTile label="Net (cash)" value={formatRWF(summary.net)} tone={summary.net >= 0 ? "green" : "red"} />
        <StatTile label="Commissions paid" value={formatRWF(summary.commissionsPaid)} />
        <StatTile label="Expenses" value={formatRWF(summary.expenses)} tone={summary.expenses > 0 ? "gold" : undefined} />
        <StatTile label="Customer credit held" value={formatRWF(summary.creditHeld)} />
        <StatTile label="Chicks sold" value={summary.chicksSold.toLocaleString()} />
      </div>

      <Card>
        <CardHeader title="Revenue by product" />
        <TableWrap>
          <thead><tr><Th>Product</Th><Th className="text-right">Orders</Th><Th className="text-right">Revenue</Th><Th className="text-right">Collected</Th><Th className="text-right">Receivable</Th></tr></thead>
          <tbody>
            {summary.byProduct.map((p) => (
              <tr key={p.product}>
                <Td className="font-medium">{p.product}</Td>
                <Td className="text-right">{p.orders.toLocaleString()}</Td>
                <Td className="text-right">{formatRWF(p.revenue)}</Td>
                <Td className="text-right text-green">{formatRWF(p.collected)}</Td>
                <Td className="text-right">{p.receivable > 0 ? <span className="text-red">{formatRWF(p.receivable)}</span> : formatRWF(0)}</Td>
              </tr>
            ))}
            <tr className="border-t border-line font-semibold">
              <Td>Total</Td>
              <Td className="text-right">{summary.orders.toLocaleString()}</Td>
              <Td className="text-right">{formatRWF(summary.revenue)}</Td>
              <Td className="text-right text-green">{formatRWF(summary.collected)}</Td>
              <Td className="text-right">{formatRWF(summary.receivable)}</Td>
            </tr>
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title="Record an expense" />
        <form onSubmit={addExpense} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Category"><Select value={cat} onChange={(e) => setCat(e.target.value)} options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>
          <Field label="Amount (RWF)"><Input type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="flex items-end"><Button type="submit">Add expense</Button></div>
          <div className="sm:col-span-4"><Field label="Note (optional)"><Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Vaccine purchase, invoice #123" /></Field></div>
        </form>
      </Card>

      <Card>
        <CardHeader title={`Expenses — ${periodLabel} (${formatRWF(summary.expenses)})`} />
        <TableWrap>
          <thead><tr><Th>Date</Th><Th>Category</Th><Th>Note</Th><Th className="text-right">Amount</Th><Th></Th></tr></thead>
          <tbody>
            {shownExpenses.length === 0 ? (
              <EmptyRow colSpan={5} text="No expenses in this period." />
            ) : shownExpenses.map((e) => (
              <tr key={e.id}>
                <Td>{formatDate(e.date)}</Td>
                <Td>{e.category}</Td>
                <Td className="max-w-[20rem] truncate">{e.note || "—"}<div className="text-xs text-muted">by {e.by} · {formatDateTime(e.on)}</div></Td>
                <Td className="text-right font-medium">{formatRWF(e.amount)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => void del(e.id)}>Delete</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

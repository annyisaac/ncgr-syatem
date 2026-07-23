"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listAccounts, listJournals, type Account, type JournalEntry } from "@/lib/accounting";
import { budgetId, budgetVsActual, deleteBudget, listBudgets, upsertBudget, type Budget } from "@/lib/budgets";

export default function BudgetsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [period, setPeriod] = useState(todayISO().slice(0, 7));
  const [code, setCode] = useState("");
  const [amount, setAmount] = useState("");

  const canUse = user?.role === "Admin" || user?.role === "Accountant";

  const load = useCallback(async () => {
    try { const [b, a, j] = await Promise.all([listBudgets(), listAccounts(), listJournals()]); setBudgets(b); setAccounts(a); setJournals(j); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("budgets-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "budgets" || p.table === "journal_entries") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const budgetable = useMemo(() => accounts.filter((a) => a.active && ["Revenue", "Cost of Sales", "Operating Expense", "Other Income", "Other Expense"].includes(a.type)), [accounts]);
  const rows = useMemo(() => budgetVsActual(budgets, accounts, journals, period), [budgets, accounts, journals, period]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;

  const totBudget = rows.reduce((s, r) => s + r.budget, 0);
  const totActual = rows.reduce((s, r) => s + r.actual, 0);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const n = Number(amount) || 0;
    if (!code || n <= 0) return;
    const b: Budget = { id: budgetId(period, code), period, accountCode: code, amount: n, by: user!.email, on: nowISO() };
    setBudgets((p) => { const i = p.findIndex((x) => x.id === b.id); if (i === -1) return [b, ...p]; const c = p.slice(); c[i] = b; return c; });
    try { await upsertBudget(b); toast("Budget set."); } catch { toast("Could not save.", "error"); void load(); }
    setAmount("");
  }
  async function del(id: string) {
    setBudgets((p) => p.filter((x) => x.id !== id));
    try { await deleteBudget(id); toast("Budget removed."); } catch { toast("Could not delete.", "error"); void load(); }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Monthly budget vs actual — actuals come from the general ledger.</p>
        <Field label="Month"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Budgeted" value={formatRWF(totBudget)} />
        <StatTile label="Actual" value={formatRWF(totActual)} />
        <StatTile label="Variance" value={formatRWF(totBudget - totActual)} tone={totBudget - totActual >= 0 ? "green" : "red"} />
        <StatTile label="Lines" value={String(rows.length)} />
      </div>

      <Card>
        <CardHeader title={`Set a budget — ${period}`} />
        <form onSubmit={add} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Account"><Select value={code} onChange={(e) => setCode(e.target.value)} options={[{ value: "", label: "Select account" }, ...budgetable.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` }))]} /></Field>
          <Field label="Budget amount"><Input type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <div className="flex items-end"><Button type="submit">Set budget</Button></div>
        </form>
      </Card>

      <Card>
        <CardHeader title={`Budget vs actual — ${period}`} />
        <TableWrap>
          <thead><tr><Th>Account</Th><Th className="text-right">Budget</Th><Th className="text-right">Actual</Th><Th className="text-right">Used</Th><Th className="text-right">Variance</Th><Th></Th><Th></Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={7} text="No budgets set for this month." /> : rows.map((r) => (
              <tr key={r.code}>
                <Td className="font-medium">{r.name}<div className="text-xs text-muted">{r.type}</div></Td>
                <Td className="text-right">{formatRWF(r.budget)}</Td>
                <Td className="text-right">{formatRWF(r.actual)}</Td>
                <Td className="text-right">
                  <div className="flex items-center justify-end gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${r.favorable ? "bg-green" : "bg-red"}`} style={{ width: `${Math.min(100, Math.abs(r.pct))}%` }} /></div>
                    {r.pct}%
                  </div>
                </Td>
                <Td className="text-right">{formatRWF(r.variance)}</Td>
                <Td>{r.favorable ? <Pill tone="green">On track</Pill> : <Pill tone="red">Over</Pill>}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => void del(budgetId(period, r.code))}>Remove</Button></Td>
              </tr>
            ))}
            {rows.length > 0 && (
              <tr className="border-t border-line font-bold">
                <Td>Total</Td><Td className="text-right">{formatRWF(totBudget)}</Td><Td className="text-right">{formatRWF(totActual)}</Td><Td></Td>
                <Td className="text-right">{formatRWF(totBudget - totActual)}</Td><Td></Td><Td></Td>
              </tr>
            )}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

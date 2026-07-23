"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { ALL_TIME, inRange as dateInRange, type DateRangeValue } from "@/components/ui/DateRange";
import { PERIODS, presetToRange, type PeriodPreset } from "@/lib/period";
import { formatRWF } from "@/lib/config";
import { formatDate, formatDateTime, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { financePDF, customerStatementPDF, financeExcel } from "@/lib/reports";
import {
  EXPENSE_CATEGORIES,
  agedReceivables,
  computeVat,
  customerStatement,
  financeSummary,
  listExpenses,
  monthlySeries,
  newExpenseId,
  profitAndLoss,
  removeExpense,
  upsertExpense,
  type Expense,
} from "@/lib/finance";

type Tab = "overview" | "pnl" | "receivables" | "cashflow" | "vat";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "pnl", label: "Profit & Loss" },
  { id: "receivables", label: "Receivables" },
  { id: "cashflow", label: "Cash flow" },
  { id: "vat", label: "VAT" },
];

/** Names the active period — a custom range reads out its real dates, so the
 *  PDF/Excel headers and card titles say exactly what was filtered. */
function rangeLabel(preset: PeriodPreset, range: { from: string; to: string }): string {
  if (preset !== "custom") return PERIODS.find((p) => p.value === preset)?.label ?? "All time";
  if (range.from && range.to) return `${formatDate(range.from)} – ${formatDate(range.to)}`;
  if (range.from) return `From ${formatDate(range.from)}`;
  if (range.to) return `Up to ${formatDate(range.to)}`;
  return "All time";
}

export default function FinancePage() {
  const { user } = useAuth();
  const { orders, commissions } = useData();
  const { toast } = useToast();

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [custom, setCustom] = useState<DateRangeValue>(ALL_TIME);
  const [pickedDate, setPickedDate] = useState(""); // one real delivery day, overrides the period
  const [tab, setTab] = useState<Tab>("overview");

  const canUse = user?.role === "Admin" || user?.role === "Accountant";

  const load = useCallback(async () => {
    try { setExpenses(await listExpenses()); } catch { /* keep */ }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);

  useEffect(() => {
    if (!canUse) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const sb = getSupabase();
    const channel = sb.channel("finance-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
        if (p.table === "expenses") { if (timer) clearTimeout(timer); timer = setTimeout(() => void load(), 350); }
      })
      .subscribe();
    return () => { if (timer) clearTimeout(timer); void sb.removeChannel(channel); };
  }, [canUse, load]);

  // The delivery days that actually exist, newest first — the dates delivery
  // planning has already put on the calendar, not every date on a calendar.
  const deliveryDates = useMemo(() => {
    const byDate = new Map<string, number>();
    for (const o of orders) if (o.date) byDate.set(o.date, (byDate.get(o.date) ?? 0) + 1);
    return [...byDate.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [orders]);

  const range = useMemo(
    () => (pickedDate ? { from: pickedDate, to: pickedDate } : presetToRange(preset, custom, todayISO())),
    [pickedDate, preset, custom]
  );
  const pred = useCallback((d: string) => (!range.from && !range.to ? true : dateInRange(d, range)), [range]);
  const periodLabel = pickedDate ? formatDate(pickedDate) : rangeLabel(preset, range);

  const summary = useMemo(() => financeSummary(orders, commissions, expenses, pred), [orders, commissions, expenses, pred]);
  const shownExpenses = useMemo(() => expenses.filter((e) => pred(e.date)).sort((a, b) => (a.date < b.date ? 1 : -1)), [expenses, pred]);
  const pnl = useMemo(() => profitAndLoss(summary, expenses, pred), [summary, expenses, pred]);
  const debtors = useMemo(() => agedReceivables(orders, todayISO()), [orders]);
  const series = useMemo(() => monthlySeries(orders, commissions, expenses, 12, todayISO()), [orders, commissions, expenses]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm text-muted">Financial overview — revenue, cash, receivables, commissions, expenses and tax.</p>
          <p className="mt-0.5 text-xs text-muted">
            {pickedDate
              ? <>Showing the delivery day <strong className="font-semibold">{formatDate(pickedDate)}</strong> only. Pick “All delivery dates” to go back to filtering by period.</>
              : <>Orders are filtered by <strong className="font-semibold">delivery date</strong>; commissions and expenses by their own dates.</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-52">
            <Select
              aria-label="Delivery date"
              value={pickedDate}
              onChange={(e) => setPickedDate(e.target.value)}
              options={[
                { value: "", label: `All delivery dates (${deliveryDates.length})` },
                ...deliveryDates.map(([d, n]) => ({ value: d, label: `${formatDate(d)} · ${n} order${n === 1 ? "" : "s"}` })),
              ]}
            />
          </div>
          <div className="w-36">
            <Select
              aria-label="Period"
              value={preset}
              onChange={(e) => setPreset(e.target.value as PeriodPreset)}
              options={PERIODS}
              disabled={!!pickedDate}
            />
          </div>
          {!pickedDate && preset === "custom" && (
            <div className="flex items-center gap-1.5">
              <Input type="date" aria-label="Delivery date from" value={custom.from} onChange={(e) => setCustom({ ...custom, from: e.target.value })} className="w-auto" />
              <span className="text-muted">–</span>
              <Input type="date" aria-label="Delivery date to" value={custom.to} onChange={(e) => setCustom({ ...custom, to: e.target.value })} className="w-auto" />
            </div>
          )}
          <Button variant="secondary" onClick={() => void financePDF(summary, shownExpenses, periodLabel)}>PDF</Button>
          <Button variant="secondary" onClick={() => void financeExcel(summary, shownExpenses, debtors.rows, periodLabel)}>Excel</Button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <Overview summary={summary} periodLabel={periodLabel} shownExpenses={shownExpenses}
          onAdd={async (exp) => { setExpenses((p) => [exp, ...p]); try { await upsertExpense(exp); toast("Expense recorded."); } catch { toast("Could not save the expense.", "error"); void load(); } }}
          onDelete={async (id) => { if (!confirm("Delete this expense?")) return; setExpenses((p) => p.filter((e) => e.id !== id)); try { await removeExpense(id); toast("Expense deleted."); } catch { toast("Could not delete.", "error"); void load(); } }}
          email={user.email} />
      )}
      {tab === "pnl" && <PnLView pnl={pnl} periodLabel={periodLabel} />}
      {tab === "receivables" && <Receivables debtors={debtors} orders={orders} />}
      {tab === "cashflow" && <CashFlow series={series} shownExpenses={shownExpenses} periodLabel={periodLabel} />}
      {tab === "vat" && <VatView revenue={summary.revenue} collected={summary.collected} periodLabel={periodLabel} />}
    </div>
  );
}

// --------------------------------------------------------------------------- Overview

function Overview({ summary, periodLabel, shownExpenses, onAdd, onDelete, email }: {
  summary: ReturnType<typeof financeSummary>; periodLabel: string; shownExpenses: Expense[];
  onAdd: (e: Expense) => void; onDelete: (id: string) => void; email: string;
}) {
  const [cat, setCat] = useState<string>(EXPENSE_CATEGORIES[0]);
  const [amt, setAmt] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label="Revenue (billed)" value={formatRWF(summary.revenue)} />
        <StatTile label="Cash collected" value={formatRWF(summary.collected)} tone="green" />
        <StatTile label="Receivables (owed to us)" value={formatRWF(summary.receivable)} tone={summary.receivable > 0 ? "gold" : "default"} />
        <StatTile label="Net (cash)" value={formatRWF(summary.net)} tone={summary.net >= 0 ? "green" : "red"} />
        <StatTile label="Commissions paid" value={formatRWF(summary.commissionsPaid)} />
        <StatTile label="Expenses" value={formatRWF(summary.expenses)} tone={summary.expenses > 0 ? "gold" : "default"} />
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
              <Td>Total</Td><Td className="text-right">{summary.orders.toLocaleString()}</Td>
              <Td className="text-right">{formatRWF(summary.revenue)}</Td>
              <Td className="text-right text-green">{formatRWF(summary.collected)}</Td>
              <Td className="text-right">{formatRWF(summary.receivable)}</Td>
            </tr>
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title="Record an expense" />
        <form onSubmit={(e) => { e.preventDefault(); const n = Number(amt) || 0; if (n <= 0) return; onAdd({ id: newExpenseId(), category: cat, amount: n, date, note: note.trim() || undefined, by: email, on: nowISO() }); setAmt(""); setNote(""); }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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
            {shownExpenses.length === 0 ? <EmptyRow colSpan={5} text="No expenses in this period." /> : shownExpenses.map((e) => (
              <tr key={e.id}>
                <Td>{formatDate(e.date)}</Td><Td>{e.category}</Td>
                <Td className="max-w-[20rem] truncate">{e.note || "—"}<div className="text-xs text-muted">by {e.by} · {formatDateTime(e.on)}</div></Td>
                <Td className="text-right font-medium">{formatRWF(e.amount)}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => onDelete(e.id)}>Delete</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------- P&L

function PnLRow({ label, value, strong, indent }: { label: string; value: number; strong?: boolean; indent?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-1.5 ${strong ? "border-t border-line font-bold text-ink" : "text-ink/80"} ${indent ? "pl-4 text-sm" : ""}`}>
      <span>{label}</span><span className={value < 0 ? "text-red" : ""}>{formatRWF(value)}</span>
    </div>
  );
}

function PnLView({ pnl, periodLabel }: { pnl: ReturnType<typeof profitAndLoss>; periodLabel: string }) {
  const Row = PnLRow;
  return (
    <Card>
      <CardHeader title={`Profit & Loss — ${periodLabel}`} />
      <div className="mx-auto max-w-xl">
        <Row label="Revenue" value={pnl.revenue} />
        <Row label="Less: DSR commissions" value={-pnl.commissions} indent />
        <Row label="Gross profit" value={pnl.grossProfit} strong />
        <div className="mt-3 mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Operating expenses</div>
        {pnl.expenseLines.length === 0 ? <p className="pl-4 text-sm text-muted">No expenses recorded this period.</p> : pnl.expenseLines.map((l) => <Row key={l.category} label={l.category} value={-l.amount} indent />)}
        <Row label="Total expenses" value={-pnl.totalExpenses} />
        <Row label="Net profit" value={pnl.netProfit} strong />
      </div>
    </Card>
  );
}

// --------------------------------------------------------------------------- Receivables

function Receivables({ debtors, orders }: { debtors: ReturnType<typeof agedReceivables>; orders: ReturnType<typeof useData>["orders"] }) {
  const { rows, totals } = debtors;
  return (
    <Card>
      <CardHeader title={`Aged receivables — ${formatRWF(totals.total)} owed by ${rows.length} customer(s)`} />
      <p className="-mt-1 mb-2 text-xs text-muted">Outstanding balances bucketed by how long overdue (from delivery date).</p>
      <TableWrap>
        <thead><tr>
          <Th>Customer</Th><Th className="text-right">Total</Th><Th className="text-right">0–30d</Th><Th className="text-right">31–60d</Th><Th className="text-right">61–90d</Th><Th className="text-right">90+d</Th><Th></Th>
        </tr></thead>
        <tbody>
          {rows.length === 0 ? <EmptyRow colSpan={7} text="No outstanding balances — all paid up." /> : rows.map((d) => (
            <tr key={`${d.name}-${d.phone}`}>
              <Td className="font-medium">{d.name}<div className="text-xs text-muted">{d.phone} · oldest {d.oldestDays}d</div></Td>
              <Td className="text-right font-semibold text-red">{formatRWF(d.total)}</Td>
              <Td className="text-right">{d.d0_30 ? formatRWF(d.d0_30) : "—"}</Td>
              <Td className="text-right">{d.d31_60 ? formatRWF(d.d31_60) : "—"}</Td>
              <Td className="text-right">{d.d61_90 ? formatRWF(d.d61_90) : "—"}</Td>
              <Td className="text-right">{d.d90 ? <span className="text-red">{formatRWF(d.d90)}</span> : "—"}</Td>
              <Td><Button size="sm" variant="ghost" onClick={() => void customerStatementPDF(customerStatement(orders, d))}>Statement</Button></Td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="border-t border-line font-semibold">
              <Td>Total</Td><Td className="text-right text-red">{formatRWF(totals.total)}</Td>
              <Td className="text-right">{formatRWF(totals.d0_30)}</Td><Td className="text-right">{formatRWF(totals.d31_60)}</Td>
              <Td className="text-right">{formatRWF(totals.d61_90)}</Td><Td className="text-right">{formatRWF(totals.d90)}</Td><Td></Td>
            </tr>
          )}
        </tbody>
      </TableWrap>
    </Card>
  );
}

// --------------------------------------------------------------------------- Cash flow

function CashFlow({ series, shownExpenses, periodLabel }: { series: ReturnType<typeof monthlySeries>; shownExpenses: Expense[]; periodLabel: string }) {
  const max = Math.max(1, ...series.map((m) => Math.max(m.moneyIn, m.moneyOut)));
  const byCat = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of shownExpenses) map.set(e.category, (map.get(e.category) ?? 0) + e.amount);
    return [...map.entries()].map(([category, amount]) => ({ category, amount })).sort((a, b) => b.amount - a.amount);
  }, [shownExpenses]);
  const catMax = Math.max(1, ...byCat.map((c) => c.amount));

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Cash flow — last 12 months" />
        <div className="flex items-center gap-4 text-xs text-muted"><span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-green" /> Money in</span><span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-red" /> Money out</span></div>
        <div className="mt-3 space-y-2">
          {series.map((m) => (
            <div key={m.key} className="flex items-center gap-3">
              <span className="w-12 shrink-0 text-xs text-muted">{m.label}</span>
              <div className="flex-1 space-y-1">
                <div className="h-3 rounded-sm bg-green/80" style={{ width: `${(m.moneyIn / max) * 100}%` }} />
                <div className="h-3 rounded-sm bg-red/70" style={{ width: `${(m.moneyOut / max) * 100}%` }} />
              </div>
              <span className={`w-28 shrink-0 text-right text-xs ${m.running >= 0 ? "text-ink" : "text-red"}`}>bal {formatRWF(m.running)}</span>
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardHeader title={`Expenses by category — ${periodLabel}`} />
        {byCat.length === 0 ? <p className="text-sm text-muted">No expenses in this period.</p> : (
          <div className="space-y-2">
            {byCat.map((c) => (
              <div key={c.category} className="flex items-center gap-3">
                <span className="w-40 shrink-0 truncate text-sm">{c.category}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-sm bg-line"><div className="h-full rounded-sm bg-gold" style={{ width: `${(c.amount / catMax) * 100}%` }} /></div>
                <span className="w-28 shrink-0 text-right text-sm font-medium">{formatRWF(c.amount)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------- VAT

function VatView({ revenue, collected, periodLabel }: { revenue: number; collected: number; periodLabel: string }) {
  const [ratePct, setRatePct] = useState("18");
  const [inclusive, setInclusive] = useState(true);
  const [base, setBase] = useState<"revenue" | "collected">("revenue");
  const amount = base === "revenue" ? revenue : collected;
  const res = computeVat(amount, (Number(ratePct) || 0) / 100, inclusive);

  return (
    <Card>
      <CardHeader title={`VAT summary — ${periodLabel}`} />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Field label="Sales base"><Select value={base} onChange={(e) => setBase(e.target.value as "revenue" | "collected")} options={[{ value: "revenue", label: "Billed revenue" }, { value: "collected", label: "Cash collected" }]} /></Field>
        <Field label="VAT rate (%)"><Input type="number" min={0} value={ratePct} onChange={(e) => setRatePct(e.target.value)} /></Field>
        <Field label="Prices"><Select value={inclusive ? "inc" : "exc"} onChange={(e) => setInclusive(e.target.value === "inc")} options={[{ value: "inc", label: "Include VAT" }, { value: "exc", label: "Exclude VAT" }]} /></Field>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Sales (VAT-exclusive)" value={formatRWF(res.net)} />
        <StatTile label={`Output VAT (${ratePct}%)`} value={formatRWF(res.vat)} tone="gold" />
        <StatTile label="Gross (incl. VAT)" value={formatRWF(res.inclusive ? res.base : res.net + res.vat)} />
      </div>
      <div className="mt-3 flex items-start gap-2 rounded-lg border border-gold/30 bg-gold-bg/50 p-3 text-xs text-ink">
        <Pill tone="gold">Note</Pill>
        <span>Confirm the correct rate and whether day-old chicks are VAT-exempt or zero-rated with your tax advisor / RRA before filing. This is a working estimate, not tax advice.</span>
      </div>
    </Card>
  );
}

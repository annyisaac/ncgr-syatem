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
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listJournals, upsertJournals } from "@/lib/accounting";
import {
  buildLine,
  listEmployees,
  listPayrollRuns,
  newEmployeeId,
  newPayrollId,
  payrollEntriesToSync,
  recalcLine,
  runTotals,
  upsertEmployee,
  upsertPayrollRun,
  type Employee,
  type PayrollLine,
  type PayrollRun,
} from "@/lib/payroll";

type Tab = "runs" | "employees";

export default function PayrollPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [runs, setRuns] = useState<PayrollRun[]>([]);
  const [tab, setTab] = useState<Tab>("runs");

  const canUse = user?.role === "Admin" || user?.role === "Accountant";

  const load = useCallback(async () => {
    try { const [e, r] = await Promise.all([listEmployees(), listPayrollRuns()]); setEmployees(e); setRuns(r); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);

  useEffect(() => {
    if (!canUse) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const sb = getSupabase();
    const ch = sb.channel("payroll-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
        if (p.table === "employees" || p.table === "payroll_runs") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 350); }
      }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  // Auto-post payroll to the GL.
  useEffect(() => {
    if (!canUse || runs.length === 0) return;
    (async () => { try { const j = await listJournals(); const diff = payrollEntriesToSync(runs, j); if (diff.length) await upsertJournals(diff); } catch { /* retry */ } })();
  }, [runs, canUse]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;

  const saveRun = async (r: PayrollRun) => { setRuns((p) => upRun(p, r)); try { await upsertPayrollRun(r); } catch { toast("Could not save.", "error"); void load(); } };
  const ytdNet = runs.filter((r) => r.status !== "draft").reduce((s, r) => s + runTotals(r).net, 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Employees" value={String(employees.filter((e) => e.active).length)} />
        <StatTile label="Payroll runs" value={String(runs.length)} />
        <StatTile label="Net paid/accrued" value={formatRWF(ytdNet)} tone="green" />
        <StatTile label="Monthly wage bill" value={formatRWF(employees.filter((e) => e.active).reduce((s, e) => s + (e.basicSalary || 0) + (e.allowances || 0), 0))} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {(["runs", "employees"] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold capitalize transition ${tab === t ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>
            {t === "runs" ? "Payroll runs" : "Employees"}
          </button>
        ))}
      </div>

      {tab === "employees" && <Employees employees={employees}
        onSave={async (e) => { setEmployees((p) => upEmp(p, e)); try { await upsertEmployee(e); toast("Employee saved."); } catch { toast("Could not save.", "error"); void load(); } }}
        email={user.email} />}
      {tab === "runs" && <Runs employees={employees} runs={runs} onSave={saveRun} onNotify={toast} email={user.email} />}

      <p className="text-xs text-muted">PAYE & RSSB use standard Rwanda defaults and are editable per line — confirm current rates with RRA/RSSB. Posting: Dr Salaries / Cr PAYE, RSSB, Net Salaries Payable; on pay, Dr Net Salaries Payable / Cr Bank or Cash.</p>
    </div>
  );
}

function upEmp(list: Employee[], e: Employee) { const i = list.findIndex((x) => x.id === e.id); if (i === -1) return [e, ...list]; const c = list.slice(); c[i] = e; return c; }
function upRun(list: PayrollRun[], r: PayrollRun) { const i = list.findIndex((x) => x.id === r.id); if (i === -1) return [r, ...list]; const c = list.slice(); c[i] = r; return c; }

// --------------------------------------------------------------------------- Employees

function Employees({ employees, onSave, email }: { employees: Employee[]; onSave: (e: Employee) => void; email: string }) {
  const [name, setName] = useState(""); const [position, setPosition] = useState(""); const [basic, setBasic] = useState(""); const [allow, setAllow] = useState("");
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Add employee" />
        <form onSubmit={(e) => { e.preventDefault(); if (!name.trim() || !(Number(basic) > 0)) return; onSave({ id: newEmployeeId(), name: name.trim(), position: position.trim() || undefined, basicSalary: Number(basic) || 0, allowances: Number(allow) || 0, active: true, by: email, on: nowISO() }); setName(""); setPosition(""); setBasic(""); setAllow(""); }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Position"><Input value={position} onChange={(e) => setPosition(e.target.value)} /></Field>
          <Field label="Basic salary"><Input type="number" min={0} value={basic} onChange={(e) => setBasic(e.target.value)} /></Field>
          <Field label="Allowances"><Input type="number" min={0} value={allow} onChange={(e) => setAllow(e.target.value)} /></Field>
          <div className="flex items-end"><Button type="submit">Add</Button></div>
        </form>
      </Card>
      <Card>
        <CardHeader title={`Employees (${employees.length})`} />
        <TableWrap>
          <thead><tr><Th>Name</Th><Th>Position</Th><Th className="text-right">Basic</Th><Th className="text-right">Allowances</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {employees.length === 0 ? <EmptyRow colSpan={6} text="No employees yet." /> : employees.map((e) => (
              <tr key={e.id} className={e.active ? "" : "opacity-50"}>
                <Td className="font-medium">{e.name}</Td><Td>{e.position || "—"}</Td>
                <Td className="text-right">{formatRWF(e.basicSalary)}</Td><Td className="text-right">{formatRWF(e.allowances || 0)}</Td>
                <Td>{e.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => onSave({ ...e, active: !e.active })}>{e.active ? "Deactivate" : "Activate"}</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------- Payroll runs

function Runs({ employees, runs, onSave, onNotify, email }: {
  employees: Employee[]; runs: PayrollRun[]; onSave: (r: PayrollRun) => void; onNotify: (m: string, t?: "success" | "error" | "info") => void; email: string;
}) {
  const [period, setPeriod] = useState(todayISO().slice(0, 7));
  const [draft, setDraft] = useState<PayrollRun | null>(null);
  const [slip, setSlip] = useState<PayrollLine | null>(null);
  const [payFor, setPayFor] = useState<PayrollRun | null>(null);

  function generate() {
    const active = employees.filter((e) => e.active);
    if (active.length === 0) return onNotify("Add active employees first.", "info");
    if (runs.some((r) => r.period === period)) return onNotify(`A run for ${period} already exists.`, "info");
    setDraft({ id: newPayrollId(), period, date: todayISO(), lines: active.map(buildLine), status: "draft", createdBy: email, on: nowISO() });
  }
  const editLine = (i: number, patch: Partial<PayrollLine>) => setDraft((d) => d ? { ...d, lines: d.lines.map((l, x) => (x === i ? recalcLine({ ...l, ...patch }) : l)) } : d);

  const rows = runs.slice().sort((a, b) => (a.period < b.period ? 1 : -1));

  return (
    <div className="space-y-5">
      {!draft && (
        <Card>
          <CardHeader title="New payroll run" />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Period (month)"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
            <Button onClick={generate}>Generate for active employees</Button>
          </div>
        </Card>
      )}

      {draft && (() => { const t = runTotals(draft); return (
        <Card>
          <CardHeader title={`Payroll — ${draft.period} (draft)`} />
          <TableWrap>
            <thead><tr><Th>Employee</Th><Th className="text-right">Basic</Th><Th className="text-right">Allow.</Th><Th className="text-right">Bonus</Th><Th className="text-right">O/T</Th><Th className="text-right">Gross</Th><Th className="text-right">PAYE</Th><Th className="text-right">RSSB</Th><Th className="text-right">Loan</Th><Th className="text-right">Other</Th><Th className="text-right">Net</Th></tr></thead>
            <tbody>
              {draft.lines.map((l, i) => (
                <tr key={l.employeeId}>
                  <Td className="font-medium">{l.name}</Td>
                  <Td className="text-right">{formatRWF(l.basic)}</Td>
                  <Td className="text-right">{formatRWF(l.allowances)}</Td>
                  <Td><Input type="number" min={0} value={l.bonus || ""} onChange={(e) => editLine(i, { bonus: Number(e.target.value) || 0 })} /></Td>
                  <Td><Input type="number" min={0} value={l.overtime || ""} onChange={(e) => editLine(i, { overtime: Number(e.target.value) || 0 })} /></Td>
                  <Td className="text-right font-medium">{formatRWF(l.gross)}</Td>
                  <Td><Input type="number" min={0} value={l.paye || ""} onChange={(e) => editLine(i, { paye: Number(e.target.value) || 0 })} /></Td>
                  <Td><Input type="number" min={0} value={l.rssb || ""} onChange={(e) => editLine(i, { rssb: Number(e.target.value) || 0 })} /></Td>
                  <Td><Input type="number" min={0} value={l.loan || ""} onChange={(e) => editLine(i, { loan: Number(e.target.value) || 0 })} /></Td>
                  <Td><Input type="number" min={0} value={l.otherDeductions || ""} onChange={(e) => editLine(i, { otherDeductions: Number(e.target.value) || 0 })} /></Td>
                  <Td className="text-right font-semibold text-green">{formatRWF(l.net)}</Td>
                </tr>
              ))}
              <tr className="border-t border-line font-bold">
                <Td>Totals</Td><Td></Td><Td></Td><Td></Td><Td></Td>
                <Td className="text-right">{formatRWF(t.gross)}</Td><Td className="text-right">{formatRWF(t.paye)}</Td><Td className="text-right">{formatRWF(t.rssb)}</Td>
                <Td className="text-right">{formatRWF(t.loan)}</Td><Td className="text-right">{formatRWF(t.other)}</Td><Td className="text-right text-green">{formatRWF(t.net)}</Td>
              </tr>
            </tbody>
          </TableWrap>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(null)}>Cancel</Button>
            <Button variant="secondary" onClick={() => { onSave(draft); setDraft(null); onNotify("Draft saved."); }}>Save draft</Button>
            <Button onClick={() => { onSave({ ...draft, status: "posted" }); setDraft(null); onNotify("Payroll posted to the ledger."); }}>Post payroll</Button>
          </div>
        </Card>
      ); })()}

      <Card>
        <CardHeader title={`Payroll runs (${rows.length})`} />
        <TableWrap>
          <thead><tr><Th>Period</Th><Th>Pay date</Th><Th className="text-right">Employees</Th><Th className="text-right">Gross</Th><Th className="text-right">Net</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={7} text="No payroll runs yet." /> : rows.map((r) => { const t = runTotals(r); return (
              <tr key={r.id}>
                <Td className="font-medium">{r.period}</Td><Td>{formatDate(r.date)}</Td>
                <Td className="text-right">{r.lines.length}</Td>
                <Td className="text-right">{formatRWF(t.gross)}</Td><Td className="text-right text-green">{formatRWF(t.net)}</Td>
                <Td>{r.status === "paid" ? <Pill tone="green">Paid</Pill> : r.status === "posted" ? <Pill tone="gold">Posted</Pill> : <Pill tone="neutral">Draft</Pill>}</Td>
                <Td>
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setSlip(r.lines[0] ? { ...r.lines[0] } : null)}>Payslips</Button>
                    {r.status === "draft" && <Button size="sm" onClick={() => onSave({ ...r, status: "posted" })}>Post</Button>}
                    {r.status === "posted" && <Button size="sm" onClick={() => setPayFor(r)}>Mark paid</Button>}
                  </div>
                </Td>
              </tr>
            ); })}
          </tbody>
        </TableWrap>
      </Card>

      {slip && <PayslipModal run={rows.find((r) => r.lines.some((l) => l.employeeId === slip.employeeId)) ?? null} onClose={() => setSlip(null)} />}
      {payFor && <PayModal run={payFor} onClose={() => setPayFor(null)} onPay={(method) => { onSave({ ...payFor, status: "paid", paidMethod: method, paidOn: nowISO() }); setPayFor(null); onNotify("Marked paid — settlement posted."); }} />}
    </div>
  );
}

function PayModal({ run, onClose, onPay }: { run: PayrollRun; onClose: () => void; onPay: (m: "cash" | "bank") => void }) {
  const [method, setMethod] = useState<"cash" | "bank">("bank");
  const t = runTotals(run);
  return (
    <Modal open onClose={onClose} title={`Pay net salaries — ${run.period}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onPay(method)}>Confirm payment</Button></>}>
      <div className="space-y-3">
        <p className="text-sm">Net to pay: <strong>{formatRWF(t.net + t.loan + t.other)}</strong></p>
        <Field label="Pay from"><Select value={method} onChange={(e) => setMethod(e.target.value as "cash" | "bank")} options={[{ value: "bank", label: "Bank" }, { value: "cash", label: "Cash" }]} /></Field>
      </div>
    </Modal>
  );
}

function PayslipModal({ run, onClose }: { run: PayrollRun | null; onClose: () => void }) {
  if (!run) return null;
  return (
    <Modal open onClose={onClose} title={`Payslips — ${run.period}`} footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-3">
        {run.lines.map((l) => (
          <div key={l.employeeId} className="rounded-lg border border-line p-3 text-sm">
            <p className="font-semibold text-ink">{l.name}</p>
            <div className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-ink/80">
              <span>Basic</span><span className="text-right">{formatRWF(l.basic)}</span>
              <span>Allowances</span><span className="text-right">{formatRWF(l.allowances)}</span>
              {l.bonus > 0 && <><span>Bonus</span><span className="text-right">{formatRWF(l.bonus)}</span></>}
              {l.overtime > 0 && <><span>Overtime</span><span className="text-right">{formatRWF(l.overtime)}</span></>}
              <span className="font-semibold">Gross</span><span className="text-right font-semibold">{formatRWF(l.gross)}</span>
              <span>PAYE</span><span className="text-right">−{formatRWF(l.paye)}</span>
              <span>RSSB</span><span className="text-right">−{formatRWF(l.rssb)}</span>
              {l.loan > 0 && <><span>Loan</span><span className="text-right">−{formatRWF(l.loan)}</span></>}
              {l.otherDeductions > 0 && <><span>Other</span><span className="text-right">−{formatRWF(l.otherDeductions)}</span></>}
              <span className="font-bold text-green">Net pay</span><span className="text-right font-bold text-green">{formatRWF(l.net)}</span>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}

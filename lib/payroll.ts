/**
 * Payroll: employees + monthly payroll runs, with automatic posting to the
 * general ledger. PAYE and RSSB are computed with standard Rwanda defaults but
 * stored per-line so the accountant can adjust — confirm current rates with RRA.
 *
 * Postings (per posted run):
 *  - Dr Salaries & Wages (6000) = total gross
 *  - Cr PAYE Payable (2110), Cr RSSB Payable (2120), Cr Net Salaries Payable (2140)
 *  - On pay: Dr Net Salaries Payable (2140) / Cr Bank (1100) or Cash (1000)
 */

import { getSupabase } from "./supabase";
import type { JournalEntry } from "./accounting";

const inBrowser = () => typeof window !== "undefined";
const round0 = (n: number) => Math.round(n);

export interface Employee {
  id: string;
  name: string;
  position?: string;
  phone?: string;
  basicSalary: number;
  allowances?: number;
  active: boolean;
  by: string;
  on: string;
}

export interface PayrollLine {
  employeeId: string;
  name: string;
  basic: number;
  allowances: number;
  bonus: number;
  overtime: number;
  gross: number;
  paye: number;
  rssb: number;      // employee RSSB deduction
  loan: number;
  otherDeductions: number;
  net: number;
}

export type PayrollStatus = "draft" | "posted" | "paid";

export interface PayrollRun {
  id: string;
  period: string;   // "YYYY-MM"
  date: string;     // pay date
  lines: PayrollLine[];
  status: PayrollStatus;
  paidMethod?: "cash" | "bank";
  paidOn?: string;
  createdBy: string;
  on: string;
}

// ---- Rwanda payroll defaults (editable per line) --------------------------

/** Progressive monthly PAYE (0–60k 0%, 60k–100k 10%, 100k–200k 20%, >200k 30%). */
export function computePAYE(gross: number): number {
  const bands: [number, number][] = [[60000, 0], [100000, 0.1], [200000, 0.2], [Infinity, 0.3]];
  let tax = 0, lower = 0;
  for (const [upper, rate] of bands) {
    if (gross <= lower) break;
    tax += (Math.min(gross, upper) - lower) * rate;
    lower = upper;
  }
  return round0(tax);
}

/** Employee RSSB (pension 3% + maternity 0.3% = 3.3% of gross). */
export function computeRSSB(gross: number): number {
  return round0(gross * 0.033);
}

export function buildLine(e: Employee): PayrollLine {
  const basic = e.basicSalary || 0;
  const allowances = e.allowances || 0;
  const gross = basic + allowances;
  const paye = computePAYE(gross);
  const rssb = computeRSSB(gross);
  return { employeeId: e.id, name: e.name, basic, allowances, bonus: 0, overtime: 0, gross, paye, rssb, loan: 0, otherDeductions: 0, net: gross - paye - rssb };
}

/** Recompute gross & net for a line after edits (keeps PAYE/RSSB as entered). */
export function recalcLine(l: PayrollLine): PayrollLine {
  const gross = (l.basic || 0) + (l.allowances || 0) + (l.bonus || 0) + (l.overtime || 0);
  const net = gross - (l.paye || 0) - (l.rssb || 0) - (l.loan || 0) - (l.otherDeductions || 0);
  return { ...l, gross, net };
}

// ---- Totals ---------------------------------------------------------------

export interface RunTotals { gross: number; paye: number; rssb: number; loan: number; other: number; net: number; }
export function runTotals(r: Pick<PayrollRun, "lines">): RunTotals {
  return r.lines.reduce((t, l) => ({
    gross: t.gross + (l.gross || 0), paye: t.paye + (l.paye || 0), rssb: t.rssb + (l.rssb || 0),
    loan: t.loan + (l.loan || 0), other: t.other + (l.otherDeductions || 0), net: t.net + (l.net || 0),
  }), { gross: 0, paye: 0, rssb: 0, loan: 0, other: 0, net: 0 });
}

// ---- Storage --------------------------------------------------------------

async function fetchAll<T>(table: "employees" | "payroll_runs"): Promise<T[]> {
  if (!inBrowser()) return [];
  const { data, error } = await getSupabase().from(table).select("data").order("updated_at", { ascending: false });
  if (error) throw new Error(`Could not load ${table}: ${error.message}`);
  return (data ?? []).map((r) => r.data as T);
}
async function saveRow(table: "employees" | "payroll_runs", row: { id: string }): Promise<void> {
  const { error } = await getSupabase().from(table).upsert({ id: row.id, data: row, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Could not save ${table}: ${error.message}`);
}
export const listEmployees = () => fetchAll<Employee>("employees");
export const upsertEmployee = (e: Employee) => saveRow("employees", e);
export const listPayrollRuns = () => fetchAll<PayrollRun>("payroll_runs");
export const upsertPayrollRun = (r: PayrollRun) => saveRow("payroll_runs", r);
export const newEmployeeId = () => `emp_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
export const newPayrollId = () => `pay_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;

// ---- GL posting -----------------------------------------------------------

export function derivePayrollEntries(runs: PayrollRun[]): JournalEntry[] {
  const out: JournalEntry[] = [];
  for (const r of runs) {
    if (r.status !== "posted" && r.status !== "paid") continue;
    const t = runTotals(r);
    if (t.gross > 0) {
      const lines = [{ accountCode: "6000", debit: t.gross, credit: 0 }];
      if (t.paye > 0) lines.push({ accountCode: "2110", debit: 0, credit: t.paye });
      if (t.rssb > 0) lines.push({ accountCode: "2120", debit: 0, credit: t.rssb });
      const netPayable = t.net + t.loan + t.other; // deductions other than PAYE/RSSB stay in net-payable bucket
      if (netPayable > 0) lines.push({ accountCode: "2140", debit: 0, credit: netPayable });
      out.push({
        id: `je_payroll_${r.id}`, date: r.date, ref: `PAY-${r.period}`,
        narration: `Payroll — ${r.period}`, lines, status: "posted", source: "payroll",
        createdBy: "system", on: r.on, postedBy: "system", postedOn: r.on,
      });
    }
    if (r.status === "paid" && r.paidOn) {
      const cashAcct = r.paidMethod === "cash" ? "1000" : "1100";
      const netPayable = t.net + t.loan + t.other;
      out.push({
        id: `je_payroll_pay_${r.id}`, date: (r.paidOn || r.date).slice(0, 10), ref: `PAY-${r.period}`,
        narration: `Net salaries paid — ${r.period}`,
        lines: [{ accountCode: "2140", debit: netPayable, credit: 0 }, { accountCode: cashAcct, debit: 0, credit: netPayable }],
        status: "posted", source: "payroll", createdBy: "system", on: r.paidOn, postedBy: "system", postedOn: r.paidOn,
      });
    }
  }
  return out;
}

export function payrollEntriesToSync(runs: PayrollRun[], existing: JournalEntry[]): JournalEntry[] {
  const byId = new Map(existing.map((e) => [e.id, e]));
  const sig = (e: JournalEntry) => `${e.date}|${e.status}|${JSON.stringify(e.lines)}`;
  return derivePayrollEntries(runs).filter((d) => { const cur = byId.get(d.id); return !cur || sig(cur) !== sig(d); });
}

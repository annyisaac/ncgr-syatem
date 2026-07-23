"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { ALL_TIME } from "@/components/ui/DateRange";
import { PERIODS, presetToRange, type PeriodPreset } from "@/lib/period";
import { formatRWF } from "@/lib/config";
import { todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listAccounts, listJournals, type Account, type JournalEntry } from "@/lib/accounting";
import { incomeStatement } from "@/lib/financialStatements";
import { purchasesBase, statutory, vatReport } from "@/lib/tax";

export default function TaxPage() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [preset, setPreset] = useState<PeriodPreset>("month");
  const [ratePct, setRatePct] = useState("18");
  const [inclusive, setInclusive] = useState(true);

  const canUse = user?.role === "Admin" || user?.role === "Accountant";

  const load = useCallback(async () => {
    try { const [a, j] = await Promise.all([listAccounts(), listJournals()]); setAccounts(a); setJournals(j); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("tax-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "journal_entries") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const range = presetToRange(preset, ALL_TIME, todayISO());
  const from = range.from || undefined;
  const to = range.to || todayISO();
  const periodLabel = PERIODS.find((p) => p.value === preset)?.label ?? "All time";

  const pl = useMemo(() => incomeStatement(accounts, journals, from, to), [accounts, journals, from, to]);
  const vat = useMemo(() => vatReport(pl.revenue.total, purchasesBase(journals, from, to), (Number(ratePct) || 0) / 100, inclusive), [pl.revenue.total, journals, from, to, ratePct, inclusive]);
  const paye = useMemo(() => statutory(journals, "2110", from, to), [journals, from, to]);
  const rssb = useMemo(() => statutory(journals, "2120", from, to), [journals, from, to]);
  const wht = useMemo(() => statutory(journals, "2130", from, to), [journals, from, to]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">Tax position from the general ledger — {periodLabel}.</p>
        <div className="w-40"><Select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} options={PERIODS.filter((p) => p.value !== "custom")} /></div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Net VAT payable" value={formatRWF(vat.netVat)} tone={vat.netVat > 0 ? "gold" : "green"} />
        <StatTile label="PAYE due" value={formatRWF(paye.balance)} tone={paye.balance > 0 ? "gold" : "green"} />
        <StatTile label="RSSB due" value={formatRWF(rssb.balance)} tone={rssb.balance > 0 ? "gold" : "green"} />
        <StatTile label="Withholding due" value={formatRWF(wht.balance)} tone={wht.balance > 0 ? "gold" : "green"} />
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHeader title="VAT" />
          <div className="flex items-center gap-2">
            <div className="w-28"><Field label="Rate %"><Input type="number" min={0} value={ratePct} onChange={(e) => setRatePct(e.target.value)} /></Field></div>
            <div className="w-40"><Field label="Prices"><Select value={inclusive ? "inc" : "exc"} onChange={(e) => setInclusive(e.target.value === "inc")} options={[{ value: "inc", label: "Include VAT" }, { value: "exc", label: "Exclude VAT" }]} /></Field></div>
          </div>
        </div>
        <TableWrap>
          <thead><tr><Th></Th><Th className="text-right">Base</Th><Th className="text-right">VAT ({ratePct}%)</Th></tr></thead>
          <tbody>
            <tr><Td>Output VAT — sales</Td><Td className="text-right">{formatRWF(vat.salesBase)}</Td><Td className="text-right">{formatRWF(vat.outputVat)}</Td></tr>
            <tr><Td>Input VAT — purchases</Td><Td className="text-right">{formatRWF(vat.purchasesBase)}</Td><Td className="text-right">−{formatRWF(vat.inputVat)}</Td></tr>
            <tr className="border-t border-line font-bold"><Td>Net VAT payable</Td><Td></Td><Td className="text-right">{formatRWF(vat.netVat)}</Td></tr>
          </tbody>
        </TableWrap>
        <div className="mt-2 flex items-start gap-2 rounded-lg border border-gold/30 bg-gold-bg/50 p-3 text-xs text-ink">
          <Pill tone="gold">Note</Pill>
          <span>VAT is estimated from sales and purchase totals (VAT isn&apos;t split per transaction yet). Confirm the rate and any exemptions (day-old chicks may be exempt/zero-rated) with RRA/EBM.</span>
        </div>
      </Card>

      <Card>
        <CardHeader title="Statutory deductions (from payroll)" />
        <TableWrap>
          <thead><tr><Th>Tax</Th><Th className="text-right">Charged (period)</Th><Th className="text-right">Paid (period)</Th><Th className="text-right">Balance due</Th></tr></thead>
          <tbody>
            <tr><Td className="font-medium">PAYE</Td><Td className="text-right">{formatRWF(paye.charged)}</Td><Td className="text-right">{formatRWF(paye.paid)}</Td><Td className="text-right font-semibold">{formatRWF(paye.balance)}</Td></tr>
            <tr><Td className="font-medium">RSSB</Td><Td className="text-right">{formatRWF(rssb.charged)}</Td><Td className="text-right">{formatRWF(rssb.paid)}</Td><Td className="text-right font-semibold">{formatRWF(rssb.balance)}</Td></tr>
            <tr><Td className="font-medium">Withholding Tax</Td><Td className="text-right">{formatRWF(wht.charged)}</Td><Td className="text-right">{formatRWF(wht.paid)}</Td><Td className="text-right font-semibold">{formatRWF(wht.balance)}</Td></tr>
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">PAYE/RSSB are posted automatically from payroll; balances are what&apos;s still owed to RRA/RSSB. Record a payment as a journal (Dr the payable / Cr Bank) to clear it.</p>
      </Card>
    </div>
  );
}

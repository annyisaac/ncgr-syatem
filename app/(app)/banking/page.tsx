"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listAccounts, listJournals, type Account, type JournalEntry } from "@/lib/accounting";
import {
  bankMovements, bookBalance, listBankAccounts, listBankRecon, newBankId, reconciledBalance,
  upsertBankAccount, upsertBankRecon, type BankAccount, type BankRecon,
} from "@/lib/banking";

export default function BankingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [banks, setBanks] = useState<BankAccount[]>([]);
  const [recons, setRecons] = useState<BankRecon[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [sel, setSel] = useState<string>("");
  const [stmtBal, setStmtBal] = useState("");

  const canUse = user?.role === "Admin" || user?.role === "Accountant";

  const load = useCallback(async () => {
    try { const [b, r, a, j] = await Promise.all([listBankAccounts(), listBankRecon(), listAccounts(), listJournals()]); setBanks(b); setRecons(r); setAccounts(a); setJournals(j); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("banking-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["bank_accounts", "bank_recon", "journal_entries"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const cashAccts = useMemo(() => accounts.filter((a) => a.active && a.type === "Asset" && (a.code.startsWith("10") || a.code.startsWith("11"))), [accounts]);
  const bank = banks.find((b) => b.id === sel) ?? null;
  const recon = recons.find((r) => r.id === (bank?.glCode ?? "")) ?? null;
  const reconciledIds = useMemo(() => recon?.reconciledIds ?? [], [recon]);
  const movements = useMemo(() => (bank ? bankMovements(journals, bank.glCode) : []), [bank, journals]);
  const book = bookBalance(movements);
  const reconciled = reconciledBalance(movements, reconciledIds);

  // Add-bank form
  const [name, setName] = useState(""); const [bankName, setBankName] = useState(""); const [acctNo, setAcctNo] = useState(""); const [glCode, setGlCode] = useState("1100");

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;

  async function addBank(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const b: BankAccount = { id: newBankId(), name: name.trim(), bank: bankName.trim() || undefined, accountNumber: acctNo.trim() || undefined, glCode, active: true, by: user!.email, on: nowISO() };
    setBanks((p) => [b, ...p]);
    try { await upsertBankAccount(b); toast("Bank account added."); } catch { toast("Could not save.", "error"); void load(); }
    setName(""); setBankName(""); setAcctNo("");
  }

  async function saveRecon(next: BankRecon) {
    setRecons((p) => { const i = p.findIndex((x) => x.id === next.id); const c = p.slice(); if (i === -1) c.unshift(next); else c[i] = next; return c; });
    try { await upsertBankRecon(next); } catch { toast("Could not save reconciliation.", "error"); void load(); }
  }
  function toggleReconciled(entryId: string) {
    if (!bank) return;
    const cur = recon ?? { id: bank.glCode, glCode: bank.glCode, reconciledIds: [], on: nowISO(), by: user!.email };
    const set = new Set(cur.reconciledIds);
    if (set.has(entryId)) set.delete(entryId); else set.add(entryId);
    void saveRecon({ ...cur, reconciledIds: [...set], on: nowISO(), by: user!.email });
  }
  function saveStatement() {
    if (!bank) return;
    const cur = recon ?? { id: bank.glCode, glCode: bank.glCode, reconciledIds: [], on: nowISO(), by: user!.email };
    void saveRecon({ ...cur, statementBalance: Number(stmtBal) || 0, statementDate: todayISO(), on: nowISO(), by: user!.email });
    toast("Statement balance saved.");
  }

  const stmt = recon?.statementBalance ?? 0;
  const diff = reconciled - stmt;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Bank accounts" value={String(banks.filter((b) => b.active).length)} />
        <StatTile label="Book balance (all)" value={formatRWF(banks.reduce((s, b) => s + bookBalance(bankMovements(journals, b.glCode)), 0))} tone="green" />
        <StatTile label="Selected — book" value={bank ? formatRWF(book) : "—"} />
        <StatTile label="Selected — reconciled" value={bank ? formatRWF(reconciled) : "—"} />
      </div>

      <Card>
        <CardHeader title="Add bank account" />
        <form onSubmit={addBank} className="grid grid-cols-1 gap-4 sm:grid-cols-5">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Main Current" /></Field>
          <Field label="Bank"><Input value={bankName} onChange={(e) => setBankName(e.target.value)} placeholder="e.g. BK" /></Field>
          <Field label="Account no."><Input value={acctNo} onChange={(e) => setAcctNo(e.target.value)} /></Field>
          <Field label="GL account"><Select value={glCode} onChange={(e) => setGlCode(e.target.value)} options={cashAccts.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` }))} /></Field>
          <div className="flex items-end"><Button type="submit">Add</Button></div>
        </form>
      </Card>

      <Card>
        <CardHeader title={`Bank accounts (${banks.length})`} />
        <TableWrap>
          <thead><tr><Th>Name</Th><Th>Bank</Th><Th>Account</Th><Th>GL</Th><Th className="text-right">Book balance</Th><Th></Th></tr></thead>
          <tbody>
            {banks.length === 0 ? <EmptyRow colSpan={6} text="No bank accounts yet." /> : banks.map((b) => (
              <tr key={b.id} className={sel === b.id ? "bg-gold-bg/40" : ""}>
                <Td className="font-medium">{b.name}</Td><Td>{b.bank || "—"}</Td><Td>{b.accountNumber || "—"}</Td><Td className="font-mono text-xs">{b.glCode}</Td>
                <Td className="text-right">{formatRWF(bookBalance(bankMovements(journals, b.glCode)))}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => { setSel(b.id); const rc = recons.find((r) => r.id === b.glCode); setStmtBal(String(rc?.statementBalance ?? "")); }}>Reconcile</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {bank && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <CardHeader title={`Reconcile — ${bank.name}`} />
            <div className="flex items-end gap-2">
              <Field label="Statement closing balance"><Input type="number" value={stmtBal} onChange={(e) => setStmtBal(e.target.value)} /></Field>
              <Button variant="secondary" onClick={saveStatement}>Save</Button>
            </div>
          </div>
          <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatTile label="Book balance" value={formatRWF(book)} />
            <StatTile label="Reconciled" value={formatRWF(reconciled)} tone="green" />
            <StatTile label="Statement" value={formatRWF(stmt)} />
            <StatTile label="Difference" value={formatRWF(diff)} tone={diff === 0 ? "green" : "red"} />
          </div>
          <TableWrap>
            <thead><tr><Th>Date</Th><Th>Ref</Th><Th>Narration</Th><Th className="text-right">Money in</Th><Th className="text-right">Money out</Th><Th>Cleared?</Th></tr></thead>
            <tbody>
              {movements.length === 0 ? <EmptyRow colSpan={6} text="No movements on this account yet." /> : movements.map((m) => {
                const done = reconciledIds.includes(m.entryId);
                return (
                  <tr key={m.entryId} className={done ? "bg-green-bg/40" : ""}>
                    <Td>{formatDate(m.date)}</Td><Td className="font-mono text-xs">{m.ref || "—"}</Td><Td className="max-w-[20rem] truncate">{m.narration}</Td>
                    <Td className="text-right text-green">{m.debit ? formatRWF(m.debit) : "—"}</Td>
                    <Td className="text-right text-red">{m.credit ? formatRWF(m.credit) : "—"}</Td>
                    <Td><Button size="sm" variant={done ? "secondary" : "ghost"} onClick={() => toggleReconciled(m.entryId)}>{done ? "✓ Cleared" : "Mark"}</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
          {diff === 0 && stmt !== 0 && <p className="mt-2 text-center text-sm text-green">Reconciled — cleared items match the statement balance.</p>}
        </Card>
      )}
    </div>
  );
}

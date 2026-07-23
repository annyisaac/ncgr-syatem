"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { formatDate, formatDateTime, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  ACCOUNT_TYPES,
  accountLedger,
  isBalanced,
  listAccounts,
  listJournals,
  newAccountId,
  newJournalId,
  sumCredits,
  sumDebits,
  trialBalance,
  upsertAccount,
  upsertJournal,
  upsertJournals,
  deleteJournal,
  type Account,
  type AccountType,
  type JournalEntry,
  type JournalLine,
} from "@/lib/accounting";
import { salesEntriesToSync } from "@/lib/salesLedger";

type Tab = "coa" | "journal" | "trial" | "ledger";
const TABS: { id: Tab; label: string }[] = [
  { id: "coa", label: "Chart of Accounts" },
  { id: "journal", label: "Journal Entries" },
  { id: "trial", label: "Trial Balance" },
  { id: "ledger", label: "General Ledger" },
];

export default function AccountingPage() {
  const { user } = useAuth();
  const { orders } = useData();
  const { toast } = useToast();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [journals, setJournals] = useState<JournalEntry[]>([]);
  const [tab, setTab] = useState<Tab>("coa");

  const canUse = user?.role === "Admin" || user?.role === "Accountant";

  const load = useCallback(async () => {
    try {
      const [a, j] = await Promise.all([listAccounts(), listJournals()]);
      setAccounts(a);
      setJournals(j);
    } catch { /* keep */ }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);

  // Auto-post sales to the ledger: whenever the orders change, write the
  // journal entries that are missing/outdated (deterministic ids → idempotent,
  // so this never duplicates). A ref holds the latest journals so this effect
  // only needs to depend on `orders` — no write loop.
  const journalsRef = useRef(journals);
  useEffect(() => { journalsRef.current = journals; }, [journals]);
  useEffect(() => {
    if (!canUse || orders.length === 0) return;
    const diff = salesEntriesToSync(orders, journalsRef.current);
    if (diff.length === 0) return;
    (async () => {
      try {
        await upsertJournals(diff);
        setJournals((p) => diff.reduce((acc, e) => upsertLocal(acc, e), p));
      } catch { /* realtime/next load will retry */ }
    })();
  }, [orders, canUse]);

  async function syncSalesNow() {
    const diff = salesEntriesToSync(orders, journals);
    if (diff.length === 0) return toast("Ledger already up to date with sales.", "info");
    try {
      await upsertJournals(diff);
      setJournals((p) => diff.reduce((acc, e) => upsertLocal(acc, e), p));
      toast(`${diff.length} sales entr${diff.length === 1 ? "y" : "ies"} posted to the ledger.`);
    } catch { toast("Could not post sales entries.", "error"); }
  }

  useEffect(() => {
    if (!canUse) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const sb = getSupabase();
    const ch = sb.channel("accounting-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
        if (p.table === "coa_accounts" || p.table === "journal_entries") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 350); }
      }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;

  const posted = journals.filter((j) => j.status === "posted");
  const drafts = journals.filter((j) => j.status === "draft");

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Accounts" value={String(accounts.filter((a) => a.active).length)} />
        <StatTile label="Posted entries" value={String(posted.length)} tone="green" />
        <StatTile label="Draft entries" value={String(drafts.length)} tone={drafts.length ? "gold" : "default"} />
        <StatTile label="Account types" value={String(ACCOUNT_TYPES.length)} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "coa" && <ChartOfAccounts accounts={accounts} onSave={async (a) => { setAccounts((p) => upsertLocal(p, a)); try { await upsertAccount(a); toast("Account saved."); } catch { toast("Could not save.", "error"); void load(); } }} email={user.email} />}
      {tab === "journal" && <Journals accounts={accounts} journals={journals} onSyncSales={syncSalesNow}
        onSave={async (e) => { setJournals((p) => upsertLocal(p, e)); try { await upsertJournal(e); toast(e.status === "posted" ? "Entry posted." : "Draft saved."); } catch { toast("Could not save.", "error"); void load(); } }}
        onDelete={async (id) => { if (!confirm("Delete this draft entry?")) return; setJournals((p) => p.filter((x) => x.id !== id)); try { await deleteJournal(id); toast("Draft deleted."); } catch { toast("Could not delete.", "error"); void load(); } }}
        email={user.email} />}
      {tab === "trial" && <TrialBalanceView accounts={accounts} journals={journals} />}
      {tab === "ledger" && <LedgerView accounts={accounts} journals={journals} />}
    </div>
  );
}

function upsertLocal<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [item, ...list];
  const copy = list.slice(); copy[i] = item; return copy;
}

// --------------------------------------------------------------------------- Chart of Accounts

function ChartOfAccounts({ accounts, onSave, email }: { accounts: Account[]; onSave: (a: Account) => void; email: string }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [type, setType] = useState<AccountType>("Operating Expense");

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Add account" />
        <form onSubmit={(e) => { e.preventDefault(); if (!code.trim() || !name.trim()) return; onSave({ id: newAccountId(code.trim()), code: code.trim(), name: name.trim(), type, active: true }); setCode(""); setName(""); }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Code"><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. 6110" /></Field>
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Account name" /></Field>
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as AccountType)} options={ACCOUNT_TYPES.map((t) => ({ value: t, label: t }))} /></Field>
          <div className="flex items-end"><Button type="submit">Add</Button></div>
        </form>
      </Card>

      {ACCOUNT_TYPES.map((t) => {
        const list = accounts.filter((a) => a.type === t);
        if (list.length === 0) return null;
        return (
          <Card key={t}>
            <CardHeader title={t} />
            <TableWrap>
              <thead><tr><Th>Code</Th><Th>Name</Th><Th>Status</Th><Th></Th></tr></thead>
              <tbody>
                {list.map((a) => (
                  <tr key={a.id} className={a.active ? "" : "opacity-50"}>
                    <Td className="font-mono">{a.code}</Td>
                    <Td className="font-medium">{a.name}</Td>
                    <Td>{a.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => onSave({ ...a, active: !a.active })}>{a.active ? "Deactivate" : "Activate"}</Button></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </Card>
        );
      })}
      <p className="text-xs text-muted">Signed in as {email}.</p>
    </div>
  );
}

// --------------------------------------------------------------------------- Journal Entries

const emptyLine = (): JournalLine => ({ accountCode: "", debit: 0, credit: 0 });

function Journals({ accounts, journals, onSave, onDelete, onSyncSales, email }: {
  accounts: Account[]; journals: JournalEntry[];
  onSave: (e: JournalEntry) => void; onDelete: (id: string) => void; onSyncSales: () => void; email: string;
}) {
  const active = useMemo(() => accounts.filter((a) => a.active), [accounts]);
  const acctOpts = useMemo(() => [{ value: "", label: "Select account" }, ...active.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` }))], [active]);
  const nameOf = (code: string) => accounts.find((a) => a.code === code)?.name ?? code;

  const [show, setShow] = useState(false);
  const [date, setDate] = useState(todayISO());
  const [ref, setRef] = useState("");
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<JournalLine[]>([emptyLine(), emptyLine()]);

  const draft: JournalEntry = { id: "", date, ref, narration, lines, status: "draft", source: "manual", createdBy: email, on: "" };
  const debits = sumDebits(draft), credits = sumCredits(draft), balanced = isBalanced(draft);

  function reset() { setDate(todayISO()); setRef(""); setNarration(""); setLines([emptyLine(), emptyLine()]); }
  function save(status: "draft" | "posted") {
    if (!narration.trim()) return;
    if (status === "posted" && !balanced) return;
    const now = nowISO();
    const e: JournalEntry = {
      id: newJournalId(), date, ref: ref.trim() || undefined, narration: narration.trim(),
      lines: lines.filter((l) => l.accountCode && ((Number(l.debit) || 0) > 0 || (Number(l.credit) || 0) > 0)),
      status, source: "manual", createdBy: email, on: now,
      ...(status === "posted" ? { postedBy: email, postedOn: now } : {}),
    };
    onSave(e); setShow(false); reset();
  }
  const setLine = (i: number, patch: Partial<JournalLine>) => setLines((p) => p.map((l, x) => (x === i ? { ...l, ...patch } : l)));

  const rows = journals.slice().sort((a, b) => (a.on < b.on ? 1 : -1));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted">Sales are auto-posted from delivered orders and verified receipts. Use “Sync from Sales” to post the latest manually.</p>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onSyncSales}>Sync from Sales</Button>
          <Button onClick={() => setShow((v) => !v)}>{show ? "Cancel" : "＋ New journal entry"}</Button>
        </div>
      </div>

      {show && (
        <Card>
          <CardHeader title="New journal entry" />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="doc / invoice #" /></Field>
            <Field label="Narration"><Input value={narration} onChange={(e) => setNarration(e.target.value)} placeholder="What is this entry for?" /></Field>
          </div>
          <div className="mt-4">
            <TableWrap>
              <thead><tr><Th>Account</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th><Th></Th></tr></thead>
              <tbody>
                {lines.map((l, i) => (
                  <tr key={i}>
                    <Td><Select value={l.accountCode} onChange={(e) => setLine(i, { accountCode: e.target.value })} options={acctOpts} /></Td>
                    <Td><Input type="number" min={0} value={l.debit || ""} onChange={(e) => setLine(i, { debit: Number(e.target.value) || 0, credit: 0 })} /></Td>
                    <Td><Input type="number" min={0} value={l.credit || ""} onChange={(e) => setLine(i, { credit: Number(e.target.value) || 0, debit: 0 })} /></Td>
                    <Td>{lines.length > 2 && <Button size="sm" variant="ghost" onClick={() => setLines((p) => p.filter((_, x) => x !== i))}>✕</Button>}</Td>
                  </tr>
                ))}
                <tr className="border-t border-line font-semibold">
                  <Td>Totals</Td>
                  <Td className="text-right">{formatRWF(debits)}</Td>
                  <Td className="text-right">{formatRWF(credits)}</Td>
                  <Td>{balanced ? <Pill tone="green">Balanced</Pill> : <Pill tone="red">Off by {formatRWF(Math.abs(debits - credits))}</Pill>}</Td>
                </tr>
              </tbody>
            </TableWrap>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>＋ Add line</Button>
              <div className="flex-1" />
              <Button variant="secondary" onClick={() => save("draft")}>Save draft</Button>
              <Button onClick={() => save("posted")} disabled={!balanced || !narration.trim()}>Post entry</Button>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <CardHeader title={`Journal (${rows.length})`} />
        <TableWrap>
          <thead><tr><Th>Date</Th><Th>Ref</Th><Th>Narration</Th><Th className="text-right">Amount</Th><Th>Source</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={7} text="No journal entries yet." /> : rows.map((e) => (
              <tr key={e.id}>
                <Td>{formatDate(e.date)}</Td>
                <Td className="font-mono text-xs">{e.ref || "—"}</Td>
                <Td className="max-w-[22rem]">
                  {e.narration}
                  <div className="text-xs text-muted">{e.lines.map((l) => `${l.accountCode} ${l.debit ? "Dr " + l.debit.toLocaleString() : "Cr " + l.credit.toLocaleString()} · ${nameOf(l.accountCode)}`).join("  |  ")}</div>
                </Td>
                <Td className="text-right font-medium">{formatRWF(sumDebits(e))}</Td>
                <Td className="text-xs text-muted">{e.source ?? "manual"}</Td>
                <Td>{e.status === "posted" ? <Pill tone="green">Posted</Pill> : e.status === "void" ? <Pill tone="neutral">Void</Pill> : <Pill tone="gold">Draft</Pill>}</Td>
                <Td>
                  {e.status === "draft" ? (
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => onSave({ ...e, status: "posted", postedBy: email, postedOn: nowISO() })} disabled={!isBalanced(e)}>Post</Button>
                      <Button size="sm" variant="ghost" onClick={() => onDelete(e.id)}>Delete</Button>
                    </div>
                  ) : e.status === "posted" ? (
                    <Button size="sm" variant="ghost" onClick={() => onSave({ ...e, status: "void" })}>Void</Button>
                  ) : <span className="text-xs text-muted">—</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------- Trial Balance

function TrialBalanceView({ accounts, journals }: { accounts: Account[]; journals: JournalEntry[] }) {
  const tb = useMemo(() => trialBalance(accounts, journals), [accounts, journals]);
  return (
    <Card>
      <CardHeader title="Trial Balance" />
      <p className="-mt-1 mb-2 text-xs text-muted">Posted entries only. Debits must equal credits.</p>
      <TableWrap>
        <thead><tr><Th>Code</Th><Th>Account</Th><Th>Type</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th></tr></thead>
        <tbody>
          {tb.rows.length === 0 ? <EmptyRow colSpan={5} text="No posted entries yet." /> : tb.rows.map((r) => (
            <tr key={r.code}>
              <Td className="font-mono">{r.code}</Td><Td className="font-medium">{r.name}</Td><Td className="text-xs text-muted">{r.type}</Td>
              <Td className="text-right">{r.debit ? formatRWF(r.debit) : "—"}</Td>
              <Td className="text-right">{r.credit ? formatRWF(r.credit) : "—"}</Td>
            </tr>
          ))}
          <tr className="border-t border-line font-bold">
            <Td></Td><Td>Total</Td><Td></Td>
            <Td className="text-right">{formatRWF(tb.totalDebit)}</Td>
            <Td className="text-right">{formatRWF(tb.totalCredit)}</Td>
          </tr>
          {tb.totalDebit !== tb.totalCredit && (
            <tr><td colSpan={5} className="px-3 py-2 text-center text-sm text-red">Out of balance by {formatRWF(Math.abs(tb.totalDebit - tb.totalCredit))}</td></tr>
          )}
        </tbody>
      </TableWrap>
    </Card>
  );
}

// --------------------------------------------------------------------------- General Ledger

function LedgerView({ accounts, journals }: { accounts: Account[]; journals: JournalEntry[] }) {
  const [code, setCode] = useState("");
  const account = accounts.find((a) => a.code === code) ?? null;
  const lines = useMemo(() => (account ? accountLedger(account, journals) : []), [account, journals]);
  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <CardHeader title="General Ledger" />
        <div className="w-72"><Select value={code} onChange={(e) => setCode(e.target.value)} options={[{ value: "", label: "Select an account" }, ...accounts.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` }))]} /></div>
      </div>
      {!account ? <p className="text-sm text-muted">Pick an account to see its ledger.</p> : (
        <TableWrap>
          <thead><tr><Th>Date</Th><Th>Ref</Th><Th>Narration</Th><Th className="text-right">Debit</Th><Th className="text-right">Credit</Th><Th className="text-right">Balance</Th></tr></thead>
          <tbody>
            {lines.length === 0 ? <EmptyRow colSpan={6} text="No posted movements on this account." /> : lines.map((l, i) => (
              <tr key={i}>
                <Td>{formatDate(l.date)}</Td><Td className="font-mono text-xs">{l.ref || "—"}</Td><Td className="max-w-[20rem]">{l.narration}</Td>
                <Td className="text-right">{l.debit ? formatRWF(l.debit) : "—"}</Td>
                <Td className="text-right">{l.credit ? formatRWF(l.credit) : "—"}</Td>
                <Td className="text-right font-medium">{formatRWF(l.balance)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
      <p className="mt-2 text-xs text-muted">{account ? `Balance shown on the account's normal side (${account.type}).` : ""} {formatDateTime(nowISO())}</p>
    </Card>
  );
}

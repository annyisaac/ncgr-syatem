"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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
import { listAccounts, listJournals, upsertJournals, type Account } from "@/lib/accounting";
import {
  apAging,
  listPurchases,
  listSuppliers,
  newPurchaseId,
  newSupplierId,
  purchaseBalance,
  purchaseEntriesToSync,
  purchasePaid,
  purchaseTotal,
  supplierBalance,
  upsertPurchase,
  upsertSupplier,
  type Purchase,
  type PurchaseLine,
  type Supplier,
} from "@/lib/purchasing";

type Tab = "suppliers" | "bills" | "payables";
const TABS: { id: Tab; label: string }[] = [
  { id: "bills", label: "Bills" },
  { id: "suppliers", label: "Suppliers" },
  { id: "payables", label: "Payables (AP)" },
];

export default function PurchasingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tab, setTab] = useState<Tab>("bills");

  const canUse = user?.role === "Admin" || user?.role === "Accountant";

  const load = useCallback(async () => {
    try {
      const [s, p, a] = await Promise.all([listSuppliers(), listPurchases(), listAccounts()]);
      setSuppliers(s); setPurchases(p); setAccounts(a);
    } catch { /* keep */ }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);

  useEffect(() => {
    if (!canUse) return;
    let t: ReturnType<typeof setTimeout> | null = null;
    const sb = getSupabase();
    const ch = sb.channel("purchasing-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
        if (p.table === "suppliers" || p.table === "purchases") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 350); }
      }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  // Auto-post purchases to the GL (idempotent by deterministic ids).
  useEffect(() => {
    if (!canUse || purchases.length === 0) return;
    (async () => {
      try {
        const existing = await listJournals();
        const diff = purchaseEntriesToSync(purchases, existing);
        if (diff.length) await upsertJournals(diff);
      } catch { /* next change retries */ }
    })();
  }, [purchases, canUse]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Accountant and Admin.</p></Card>;

  const totalPayable = purchases.filter((p) => p.status === "posted").reduce((s, p) => s + Math.max(0, purchaseBalance(p)), 0);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Suppliers" value={String(suppliers.filter((s) => s.active).length)} />
        <StatTile label="Bills" value={String(purchases.length)} />
        <StatTile label="Accounts payable" value={formatRWF(totalPayable)} tone={totalPayable > 0 ? "gold" : "default"} />
        <StatTile label="Spent (posted)" value={formatRWF(purchases.filter((p) => p.status === "posted").reduce((s, p) => s + purchaseTotal(p), 0))} />
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {TABS.map((t) => (
          <button key={t.id} type="button" onClick={() => setTab(t.id)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold transition ${tab === t.id ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "suppliers" && <Suppliers suppliers={suppliers} purchases={purchases}
        onSave={async (s) => { setSuppliers((p) => up(p, s)); try { await upsertSupplier(s); toast("Supplier saved."); } catch { toast("Could not save.", "error"); void load(); } }}
        email={user.email} />}
      {tab === "bills" && <Bills suppliers={suppliers} purchases={purchases} accounts={accounts}
        onSave={async (b) => { setPurchases((p) => up(p, b)); try { await upsertPurchase(b); toast(b.status === "posted" ? "Bill posted." : "Draft saved."); } catch { toast("Could not save.", "error"); void load(); } }}
        email={user.email} />}
      {tab === "payables" && <Payables purchases={purchases} suppliers={suppliers} />}
      <p className="text-xs text-muted">Posted bills and payments auto-post to the general ledger (Dr expense/inventory / Cr Accounts Payable; payments Dr AP / Cr Cash or Bank).</p>
    </div>
  );
}

function up<T extends { id: string }>(list: T[], item: T): T[] {
  const i = list.findIndex((x) => x.id === item.id);
  if (i === -1) return [item, ...list];
  const c = list.slice(); c[i] = item; return c;
}

// --------------------------------------------------------------------------- Suppliers

function Suppliers({ suppliers, purchases, onSave, email }: { suppliers: Supplier[]; purchases: Purchase[]; onSave: (s: Supplier) => void; email: string }) {
  const [name, setName] = useState(""); const [phone, setPhone] = useState(""); const [supplies, setSupplies] = useState("");
  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="Add supplier" />
        <form onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; onSave({ id: newSupplierId(), name: name.trim(), phone: phone.trim() || undefined, supplies: supplies.trim() || undefined, active: true, by: email, on: nowISO() }); setName(""); setPhone(""); setSupplies(""); }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Phone"><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          <Field label="Supplies"><Input value={supplies} onChange={(e) => setSupplies(e.target.value)} placeholder="e.g. Eggs, Feed" /></Field>
          <div className="flex items-end"><Button type="submit">Add</Button></div>
        </form>
      </Card>
      <Card>
        <CardHeader title={`Suppliers (${suppliers.length})`} />
        <TableWrap>
          <thead><tr><Th>Name</Th><Th>Phone</Th><Th>Supplies</Th><Th className="text-right">Owed</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {suppliers.length === 0 ? <EmptyRow colSpan={6} text="No suppliers yet." /> : suppliers.map((s) => (
              <tr key={s.id} className={s.active ? "" : "opacity-50"}>
                <Td className="font-medium">{s.name}</Td>
                <Td>{s.phone || "—"}</Td>
                <Td>{s.supplies || "—"}</Td>
                <Td className="text-right font-medium">{formatRWF(supplierBalance(s.id, purchases))}</Td>
                <Td>{s.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</Td>
                <Td><Button size="sm" variant="ghost" onClick={() => onSave({ ...s, active: !s.active })}>{s.active ? "Deactivate" : "Activate"}</Button></Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

// --------------------------------------------------------------------------- Bills

const emptyLine = (): PurchaseLine => ({ accountCode: "", description: "", amount: 0 });

function Bills({ suppliers, purchases, accounts, onSave, email }: {
  suppliers: Supplier[]; purchases: Purchase[]; accounts: Account[];
  onSave: (b: Purchase) => void; email: string;
}) {
  const active = suppliers.filter((s) => s.active);
  const expenseAccts = useMemo(
    () => accounts.filter((a) => a.active && ["Operating Expense", "Cost of Sales", "Asset", "Other Expense"].includes(a.type)),
    [accounts]
  );
  const acctOpts = [{ value: "", label: "Account" }, ...expenseAccts.map((a) => ({ value: a.code, label: `${a.code} — ${a.name}` }))];

  const [show, setShow] = useState(false);
  const [supplierId, setSupplierId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [ref, setRef] = useState("");
  const [lines, setLines] = useState<PurchaseLine[]>([emptyLine()]);
  const total = purchaseTotal({ lines });

  const [pay, setPay] = useState<Purchase | null>(null);

  function reset() { setSupplierId(""); setDate(todayISO()); setRef(""); setLines([emptyLine()]); }
  function save(status: "draft" | "posted") {
    const sup = suppliers.find((s) => s.id === supplierId);
    if (!sup) return;
    const clean = lines.filter((l) => l.accountCode && (Number(l.amount) || 0) > 0);
    if (clean.length === 0) return;
    onSave({ id: newPurchaseId(), supplierId: sup.id, supplierName: sup.name, date, ref: ref.trim() || undefined, lines: clean, status, payments: [], createdBy: email, on: nowISO() });
    setShow(false); reset();
  }
  const setLine = (i: number, patch: Partial<PurchaseLine>) => setLines((p) => p.map((l, x) => (x === i ? { ...l, ...patch } : l)));

  const rows = purchases.slice().sort((a, b) => (a.on < b.on ? 1 : -1));

  return (
    <div className="space-y-5">
      <div className="flex justify-end"><Button onClick={() => setShow((v) => !v)}>{show ? "Cancel" : "＋ New bill"}</Button></div>

      {show && (
        <Card>
          <CardHeader title="New purchase bill" />
          {active.length === 0 ? <p className="text-sm text-status-refunded">Add a supplier first (Suppliers tab).</p> : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Field label="Supplier"><Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} options={[{ value: "", label: "Select supplier" }, ...active.map((s) => ({ value: s.id, label: s.name }))]} /></Field>
                <Field label="Bill date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
                <Field label="Bill / invoice #"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
              </div>
              <div className="mt-4">
                <TableWrap>
                  <thead><tr><Th>Account</Th><Th>Description</Th><Th className="text-right">Amount</Th><Th></Th></tr></thead>
                  <tbody>
                    {lines.map((l, i) => (
                      <tr key={i}>
                        <Td className="w-64"><Select value={l.accountCode} onChange={(e) => setLine(i, { accountCode: e.target.value })} options={acctOpts} /></Td>
                        <Td><Input value={l.description} onChange={(e) => setLine(i, { description: e.target.value })} placeholder="What was bought" /></Td>
                        <Td><Input type="number" min={0} value={l.amount || ""} onChange={(e) => setLine(i, { amount: Number(e.target.value) || 0 })} /></Td>
                        <Td>{lines.length > 1 && <Button size="sm" variant="ghost" onClick={() => setLines((p) => p.filter((_, x) => x !== i))}>✕</Button>}</Td>
                      </tr>
                    ))}
                    <tr className="border-t border-line font-semibold"><Td>Total</Td><Td></Td><Td className="text-right">{formatRWF(total)}</Td><Td></Td></tr>
                  </tbody>
                </TableWrap>
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <Button variant="ghost" size="sm" onClick={() => setLines((p) => [...p, emptyLine()])}>＋ Add line</Button>
                  <div className="flex-1" />
                  <Button variant="secondary" onClick={() => save("draft")} disabled={!supplierId}>Save draft</Button>
                  <Button onClick={() => save("posted")} disabled={!supplierId || total <= 0}>Post bill</Button>
                </div>
              </div>
            </>
          )}
        </Card>
      )}

      <Card>
        <CardHeader title={`Bills (${rows.length})`} />
        <TableWrap>
          <thead><tr><Th>Date</Th><Th>Supplier</Th><Th>Ref</Th><Th className="text-right">Total</Th><Th className="text-right">Paid</Th><Th className="text-right">Balance</Th><Th>Status</Th><Th></Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={8} text="No bills yet." /> : rows.map((b) => (
              <tr key={b.id}>
                <Td>{formatDate(b.date)}</Td>
                <Td className="font-medium">{b.supplierName}</Td>
                <Td className="font-mono text-xs">{b.ref || "—"}</Td>
                <Td className="text-right">{formatRWF(purchaseTotal(b))}</Td>
                <Td className="text-right text-green">{formatRWF(purchasePaid(b))}</Td>
                <Td className="text-right">{purchaseBalance(b) > 0 ? <span className="text-red">{formatRWF(purchaseBalance(b))}</span> : formatRWF(0)}</Td>
                <Td>{b.status === "posted" ? <Pill tone="green">Posted</Pill> : <Pill tone="gold">Draft</Pill>}</Td>
                <Td>{b.status === "posted" && purchaseBalance(b) > 0 ? <Button size="sm" variant="ghost" onClick={() => setPay(b)}>Pay</Button> : <span className="text-xs text-muted">—</span>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {pay && <PayModal bill={pay} onClose={() => setPay(null)} onSave={(payment) => { onSave({ ...pay, payments: [...pay.payments, payment] }); setPay(null); }} email={email} />}
    </div>
  );
}

function PayModal({ bill, onClose, onSave, email }: { bill: Purchase; onClose: () => void; onSave: (p: import("@/lib/purchasing").PurchasePayment) => void; email: string }) {
  const bal = purchaseBalance(bill);
  const [amt, setAmt] = useState(String(bal));
  const [date, setDate] = useState(todayISO());
  const [method, setMethod] = useState<"cash" | "bank">("bank");
  const [ref, setRef] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal open onClose={onClose} title={`Pay ${bill.supplierName}`}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => { const n = Number(amt) || 0; if (n <= 0) return setErr("Enter an amount."); if (n > bal + 0.5) return setErr(`Max ${formatRWF(bal)}.`); onSave({ amt: n, date, method, ref: ref.trim() || undefined, by: email, on: nowISO() }); }}>Record payment</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-muted">Balance due: <strong className="text-ink">{formatRWF(bal)}</strong></p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Amount (RWF)"><Input type="number" min={1} value={amt} onChange={(e) => setAmt(e.target.value)} /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Method"><Select value={method} onChange={(e) => setMethod(e.target.value as "cash" | "bank")} options={[{ value: "bank", label: "Bank" }, { value: "cash", label: "Cash" }]} /></Field>
          <Field label="Reference"><Input value={ref} onChange={(e) => setRef(e.target.value)} /></Field>
        </div>
        {err && <p className="text-sm text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

// --------------------------------------------------------------------------- Payables

function Payables({ purchases, suppliers }: { purchases: Purchase[]; suppliers: Supplier[] }) {
  const ap = useMemo(() => apAging(purchases, suppliers, todayISO()), [purchases, suppliers]);
  return (
    <Card>
      <CardHeader title={`Accounts payable — ${formatRWF(ap.totals.total)} owed to ${ap.rows.length} supplier(s)`} />
      <p className="-mt-1 mb-2 text-xs text-muted">Unpaid posted bills bucketed by age (from bill date).</p>
      <TableWrap>
        <thead><tr><Th>Supplier</Th><Th className="text-right">Total</Th><Th className="text-right">0–30d</Th><Th className="text-right">31–60d</Th><Th className="text-right">61–90d</Th><Th className="text-right">90+d</Th></tr></thead>
        <tbody>
          {ap.rows.length === 0 ? <EmptyRow colSpan={6} text="Nothing outstanding — all bills paid." /> : ap.rows.map((r) => (
            <tr key={r.supplierId}>
              <Td className="font-medium">{r.name}</Td>
              <Td className="text-right font-semibold text-red">{formatRWF(r.total)}</Td>
              <Td className="text-right">{r.d0_30 ? formatRWF(r.d0_30) : "—"}</Td>
              <Td className="text-right">{r.d31_60 ? formatRWF(r.d31_60) : "—"}</Td>
              <Td className="text-right">{r.d61_90 ? formatRWF(r.d61_90) : "—"}</Td>
              <Td className="text-right">{r.d90 ? <span className="text-red">{formatRWF(r.d90)}</span> : "—"}</Td>
            </tr>
          ))}
          {ap.rows.length > 0 && (
            <tr className="border-t border-line font-semibold">
              <Td>Total</Td><Td className="text-right text-red">{formatRWF(ap.totals.total)}</Td>
              <Td className="text-right">{formatRWF(ap.totals.d0_30)}</Td><Td className="text-right">{formatRWF(ap.totals.d31_60)}</Td>
              <Td className="text-right">{formatRWF(ap.totals.d61_90)}</Td><Td className="text-right">{formatRWF(ap.totals.d90)}</Td>
            </tr>
          )}
        </tbody>
      </TableWrap>
    </Card>
  );
}

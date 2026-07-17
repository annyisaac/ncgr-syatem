"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { SUPPLY_CATEGORIES, type Supply, type SupplyKind, type Purchase } from "@/lib/hatchery/types";

const CAN_MANAGE = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Sales & Coordination Officer"];

const num = (v: string) => Number(v) || 0;
const catLabel = (k: SupplyKind) => SUPPLY_CATEGORIES.find((c) => c.value === k)?.label ?? k;
const rwf = (n: number) => `${Math.round(n).toLocaleString()} RWF`;
const totalBought = (s: Supply) => (s.purchases ?? []).reduce((a, p) => a + p.qty, 0);
const totalSpent = (s: Supply) => (s.purchases ?? []).reduce((a, p) => a + p.qty * p.unitCost, 0);
const lastBuy = (s: Supply) => (s.purchases ?? []).map((p) => p.on).sort().slice(-1)[0];

export default function InventoryPage() {
  const { user } = useAuth();
  const { supplies, inventory, upsertSupply, newId } = useHatchery();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [cat, setCat] = useState<"all" | SupplyKind>("all");
  const [q, setQ] = useState("");
  const [buyFor, setBuyFor] = useState<Supply | null>(null);
  const [adjust, setAdjust] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const [f, setF] = useState({
    kind: "hygiene" as SupplyKind, name: "", unit: "units",
    qty: "", unitCost: "", supplier: "", date: todayISO(),
  });
  const [buy, setBuy] = useState({ qty: "", unitCost: "", supplier: "", date: todayISO() });
  const [buyErr, setBuyErr] = useState<string | null>(null);

  const canManage = !!user && CAN_MANAGE.includes(user.role);

  const rows = useMemo(() =>
    supplies
      .filter((s) => cat === "all" || s.kind === cat)
      .filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()))
      .slice()
      .sort((a, b) => (a.kind === b.kind ? a.name.localeCompare(b.name) : a.kind.localeCompare(b.kind))),
    [supplies, cat, q]);

  const totals = useMemo(() => {
    const spent = supplies.reduce((a, s) => a + totalSpent(s), 0);
    const low = supplies.filter((s) => s.quantity <= 0).length;
    const chicks = inventory.filter((i) => i.availableCount > 0).reduce((a, i) => a + i.availableCount, 0);
    return { spent, items: supplies.length, low, chicks };
  }, [supplies, inventory]);

  const chicksByProduct = useMemo(() => {
    const m = new Map<string, number>();
    for (const i of inventory) if (i.availableCount > 0) m.set(i.productType, (m.get(i.productType) ?? 0) + i.availableCount);
    return [...m.entries()];
  }, [inventory]);

  if (!user) return null;

  function pickCategory(kind: SupplyKind) {
    const unit = SUPPLY_CATEGORIES.find((c) => c.value === kind)?.unit ?? "units";
    setF((prev) => ({ ...prev, kind, unit }));
  }

  function addItem(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.name.trim()) return setErr("Enter a name.");
    const qty = num(f.qty);
    const cost = num(f.unitCost);
    const on = nowISO();
    const purchases: Purchase[] = qty > 0
      ? [{ qty, unitCost: cost, supplier: f.supplier.trim(), on: `${f.date}T08:00:00Z`, by: user!.email }]
      : [];
    const s: Supply = {
      id: newId("sup"), kind: f.kind, name: f.name.trim(),
      unit: f.unit.trim() || "units", quantity: qty, purchases,
      history: [`${on} — created${qty > 0 ? ` with ${qty} ${f.unit} @ ${rwf(cost)} from ${f.supplier || "—"}` : ""} by ${user!.name}`],
      by: user!.email, on,
    };
    upsertSupply(s);
    toast(`${s.name} added to inventory.`);
    setShowAdd(false);
    setF({ ...f, name: "", qty: "", unitCost: "", supplier: "" });
  }

  function openBuy(s: Supply) {
    setBuyFor(s);
    setBuy({ qty: "", unitCost: String(s.purchases?.slice(-1)[0]?.unitCost ?? ""), supplier: s.purchases?.slice(-1)[0]?.supplier ?? "", date: todayISO() });
    setBuyErr(null);
  }

  function saveBuy() {
    if (!buyFor) return;
    setBuyErr(null);
    const qty = num(buy.qty);
    if (qty <= 0) return setBuyErr("Enter a quantity bought.");
    const cost = num(buy.unitCost);
    const on = nowISO();
    const p: Purchase = { qty, unitCost: cost, supplier: buy.supplier.trim(), on: `${buy.date}T08:00:00Z`, by: user!.email };
    upsertSupply({
      ...buyFor,
      quantity: buyFor.quantity + qty,
      purchases: [...(buyFor.purchases ?? []), p],
      history: [...buyFor.history, `${on} — bought ${qty} ${buyFor.unit} @ ${rwf(cost)} from ${buy.supplier || "—"} by ${user!.name}`],
      on,
    });
    toast(`Recorded ${qty} ${buyFor.unit} of ${buyFor.name} (${rwf(qty * cost)}).`);
    setBuyFor(null);
  }

  function applyAdjust(s: Supply) {
    const delta = Number(adjust[s.id]) || 0;
    if (delta === 0) return;
    const on = nowISO();
    upsertSupply({
      ...s, quantity: Math.max(0, s.quantity + delta),
      history: [...s.history, `${on} — adjust ${delta > 0 ? "+" : ""}${delta} ${s.unit} by ${user!.name}`], on,
    });
    toast(`${s.name} adjusted (${delta > 0 ? "+" : ""}${delta}).`);
    setAdjust({ ...adjust, [s.id]: "" });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Inventory</h1>
        {canManage && <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Hide" : "Add item"}</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total spent" value={rwf(totals.spent)} tone="gold" />
        <Kpi label="Items tracked" value={totals.items.toLocaleString()} />
        <Kpi label="Out of stock" value={totals.low.toLocaleString()} tone={totals.low ? "gold" : "green"} />
        <Kpi label="Chicks available" value={totals.chicks.toLocaleString()} tone="green" />
      </div>

      {showAdd && canManage && (
        <Card>
          <CardHeader title="Add inventory item" />
          <form onSubmit={addItem} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Category">
              <Select value={f.kind} onChange={(e) => pickCategory(e.target.value as SupplyKind)}
                options={SUPPLY_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
            </Field>
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Newcastle vaccine / Soap" /></Field>
            <Field label="Unit"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
            <Field label="Quantity bought"><Input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
            <Field label="Unit cost (RWF)"><Input type="number" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></Field>
            <Field label="Supplier"><Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
            <Field label="Date bought"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <div className="sm:col-span-3 rounded-md border border-line bg-cream/40 px-3 py-2 text-sm">
              Purchase total: <strong className="text-ink">{rwf(num(f.qty) * num(f.unitCost))}</strong>
            </div>
            {err && <p className="sm:col-span-3 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit">Save item</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title="Stock" />
        <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_1fr] sm:items-end">
          <Field label="Category">
            <Select value={cat} onChange={(e) => setCat(e.target.value as "all" | SupplyKind)}
              options={[{ value: "all", label: "All categories" }, ...SUPPLY_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]} />
          </Field>
          <Field label="Search"><Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Item name…" /></Field>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <Th>Item</Th><Th>Category</Th><Th className="text-right">In stock</Th>
              <Th className="text-right">Total bought</Th><Th className="text-right">Total spent</Th><Th>Last buy</Th>
              {canManage && <Th>Actions</Th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={canManage ? 7 : 6} text="Nothing in stock." />
            ) : (
              rows.map((s) => (
                <tr key={s.id}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>{catLabel(s.kind)}</Td>
                  <Td className="text-right">
                    {s.quantity.toLocaleString()} {s.unit}{" "}
                    {s.quantity <= 0 ? <Pill tone="gold">out</Pill> : s.quantity < 20 && <Pill tone="gold">low</Pill>}
                  </Td>
                  <Td className="text-right text-muted">{totalBought(s).toLocaleString()}</Td>
                  <Td className="text-right text-muted">{rwf(totalSpent(s))}</Td>
                  <Td className="text-xs text-muted">{lastBuy(s) ? formatDate(lastBuy(s)!.slice(0, 10)) : "—"}</Td>
                  {canManage && (
                    <Td>
                      <div className="flex flex-wrap items-center gap-2">
                        <Button size="sm" onClick={() => openBuy(s)}>Buy</Button>
                        <input type="number" value={adjust[s.id] ?? ""} onChange={(e) => setAdjust({ ...adjust, [s.id]: e.target.value })}
                          className="w-16 rounded-md border border-line bg-transparent px-2 py-1 text-sm" placeholder="±" />
                        <Button size="sm" variant="secondary" onClick={() => applyAdjust(s)}>Adjust</Button>
                      </div>
                    </Td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title="Hatched chicks (read-only)" />
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {chicksByProduct.length === 0 ? (
            <p className="text-muted">No chicks in inventory.</p>
          ) : (
            chicksByProduct.map(([p, n]) => (
              <div key={p} className="rounded-lg border border-line px-3 py-2">
                <span className="text-muted">{p}: </span><strong className="text-ink">{n.toLocaleString()}</strong>
              </div>
            ))
          )}
          <Link href="/hatchery/chicks" className="ml-auto text-sm text-gold-dark underline underline-offset-2">Open chick inventory →</Link>
        </div>
        <p className="mt-2 text-xs text-muted">Chicks are produced by the hatch/counting flow and consumed by sales allocation — managed there, not bought here.</p>
      </Card>

      <Modal
        open={!!buyFor}
        onClose={() => setBuyFor(null)}
        title={buyFor ? `Record purchase — ${buyFor.name}` : "Record purchase"}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBuyFor(null)}>Cancel</Button>
            <Button onClick={saveBuy}>Save purchase</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={`Quantity (${buyFor?.unit ?? ""})`}><Input type="number" value={buy.qty} onChange={(e) => setBuy({ ...buy, qty: e.target.value })} /></Field>
          <Field label="Unit cost (RWF)"><Input type="number" value={buy.unitCost} onChange={(e) => setBuy({ ...buy, unitCost: e.target.value })} /></Field>
          <Field label="Supplier"><Input value={buy.supplier} onChange={(e) => setBuy({ ...buy, supplier: e.target.value })} /></Field>
          <Field label="Date"><Input type="date" value={buy.date} onChange={(e) => setBuy({ ...buy, date: e.target.value })} /></Field>
          <div className="sm:col-span-2 rounded-md border border-line bg-cream/40 px-3 py-2 text-sm">
            Total: <strong className="text-ink">{rwf(num(buy.qty) * num(buy.unitCost))}</strong>
            {buyFor && <> · new stock <strong className="text-ink">{(buyFor.quantity + num(buy.qty)).toLocaleString()} {buyFor.unit}</strong></>}
          </div>
          {buyErr && <p className="sm:col-span-2 text-sm text-status-refunded">{buyErr}</p>}
        </div>
      </Modal>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "gold" | "green" }) {
  const color = tone === "gold" ? "text-gold-dark" : tone === "green" ? "text-green" : "text-ink";
  return (
    <div className="rounded-xl border border-line bg-paper p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { SUPPLY_CATEGORIES, type Supply, type SupplyKind, type Purchase } from "@/lib/hatchery/types";

const CAN_MANAGE = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Sales & Coordination Officer"];

const num = (v: string) => Number(v) || 0;
const catLabel = (k: SupplyKind) => SUPPLY_CATEGORIES.find((c) => c.value === k)?.label ?? k;
const rwf = (n: number) => `${Math.round(n).toLocaleString()} RWF`;
const totalSpent = (s: Supply) => (s.purchases ?? []).reduce((a, p) => a + p.qty * p.unitCost, 0);
const lastBuy = (s: Supply) => (s.purchases ?? []).map((p) => p.on).sort().slice(-1)[0];

const blankForm = () => ({ kind: "hygiene" as SupplyKind, name: "", unit: "units", qty: "", unitCost: "", supplier: "", date: todayISO() });

export default function InventoryPage() {
  const { user } = useAuth();
  const { supplies, inventory, upsertSupply, newId } = useHatchery();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cat, setCat] = useState<"all" | SupplyKind>("all");
  const [q, setQ] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [f, setF] = useState(blankForm());

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

  function openAdd() { setEditingId(null); setF(blankForm()); setErr(null); setShowForm(true); }
  function openEdit(s: Supply) {
    const last = s.purchases?.slice(-1)[0];
    setEditingId(s.id);
    setF({ kind: s.kind, name: s.name, unit: s.unit, qty: String(s.quantity), unitCost: String(last?.unitCost ?? ""), supplier: last?.supplier ?? "", date: (last?.on ?? todayISO()).slice(0, 10) });
    setErr(null);
    setShowForm(true);
  }
  function closeForm() { setShowForm(false); setEditingId(null); setF(blankForm()); setErr(null); }

  function saveItem(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const name = f.name.trim();
    if (!name) return setErr("Enter a name.");
    const qty = Math.max(0, num(f.qty));
    const cost = num(f.unitCost);
    const on = nowISO();
    // One purchase line captures the item's cost & supplier at this quantity.
    const purchases: Purchase[] = qty > 0 || cost > 0
      ? [{ qty, unitCost: cost, supplier: f.supplier.trim(), on: `${f.date}T08:00:00Z`, by: user!.email }]
      : [];

    if (editingId) {
      const existing = supplies.find((s) => s.id === editingId);
      if (!existing) return;
      upsertSupply({
        ...existing, kind: f.kind, name, unit: f.unit.trim() || "units", quantity: qty, purchases,
        history: [...existing.history, `${on} — edited by ${user!.name}`], on,
      });
      toast(`${name} updated.`);
    } else {
      upsertSupply({
        id: newId("sup"), kind: f.kind, name, unit: f.unit.trim() || "units", quantity: qty, purchases,
        history: [`${on} — created${qty > 0 ? ` with ${qty} ${f.unit} @ ${rwf(cost)} from ${f.supplier || "—"}` : ""} by ${user!.name}`],
        by: user!.email, on,
      });
      toast(`${name} added to inventory.`);
    }
    closeForm();
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {canManage && <Button onClick={() => (showForm ? closeForm() : openAdd())}>{showForm ? "Hide" : "Add item"}</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Total spent" value={rwf(totals.spent)} tone="gold" />
        <Kpi label="Items tracked" value={totals.items.toLocaleString()} />
        <Kpi label="Out of stock" value={totals.low.toLocaleString()} tone={totals.low ? "gold" : "green"} />
        <Kpi label="Chicks available" value={totals.chicks.toLocaleString()} tone="green" />
      </div>

      {showForm && canManage && (
        <Card>
          <CardHeader title={editingId ? "Edit inventory item" : "Add inventory item"} />
          <form onSubmit={saveItem} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Category">
              <Select value={f.kind} onChange={(e) => pickCategory(e.target.value as SupplyKind)}
                options={SUPPLY_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))} />
            </Field>
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Newcastle vaccine / Soap" /></Field>
            <Field label="Unit"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
            <Field label="Quantity in stock"><Input type="number" min={0} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
            <Field label="Unit cost (RWF)"><Input type="number" min={0} value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></Field>
            <Field label="Supplier"><Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
            <Field label="Date"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <div className="sm:col-span-3 rounded-md border border-line bg-cream/40 px-3 py-2 text-sm">
              Total value: <strong className="text-ink">{rwf(num(f.qty) * num(f.unitCost))}</strong>
            </div>
            {err && <p className="sm:col-span-3 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={closeForm}>Cancel</Button>
              <Button type="submit">{editingId ? "Save changes" : "Save item"}</Button>
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
              <Th className="text-right">Unit cost</Th><Th className="text-right">Value</Th><Th>Supplier</Th><Th>Updated</Th>
              {canManage && <Th></Th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={canManage ? 8 : 7} text="Nothing in stock." />
            ) : (
              rows.map((s) => {
                const last = s.purchases?.slice(-1)[0];
                return (
                  <tr key={s.id}>
                    <Td className="font-medium">{s.name}</Td>
                    <Td>{catLabel(s.kind)}</Td>
                    <Td className="text-right">
                      {s.quantity.toLocaleString()} {s.unit}{" "}
                      {s.quantity <= 0 ? <Pill tone="gold">out</Pill> : s.quantity < 20 && <Pill tone="gold">low</Pill>}
                    </Td>
                    <Td className="text-right text-muted">{last?.unitCost ? rwf(last.unitCost) : "—"}</Td>
                    <Td className="text-right text-muted">{rwf(totalSpent(s))}</Td>
                    <Td className="text-xs text-muted">{last?.supplier || "—"}</Td>
                    <Td className="text-xs text-muted">{lastBuy(s) ? formatDate(lastBuy(s)!.slice(0, 10)) : "—"}</Td>
                    {canManage && (
                      <Td><Button size="sm" variant="ghost" onClick={() => openEdit(s)}>Edit</Button></Td>
                    )}
                  </tr>
                );
              })
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

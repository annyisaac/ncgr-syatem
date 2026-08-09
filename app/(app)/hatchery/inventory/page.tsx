"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { SUPPLY_CATEGORIES, type Supply, type SupplyKind, type Purchase } from "@/lib/hatchery/types";

const CAN_MANAGE = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Sales & Coordination Officer"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

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
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

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

  // Low stock = in stock but running short.
  const lowStock = supplies.filter((s) => s.quantity > 0 && s.quantity < 20).length;

  // Paginated stock rows.
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = rows.slice(start, start + perPage);

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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Supplies Inventory</h1>
          <p className="text-sm text-muted">Track hatchery supplies, purchases and stock levels</p>
        </div>
        {canManage && <Button onClick={openAdd}>＋ Add item</Button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoBox />} tone="blue" value={totals.items.toLocaleString()} label="Items tracked" />
        <StatCard icon={<IcoAlert />} tone="red" value={totals.low.toLocaleString()} label="Out of stock" />
        <StatCard icon={<IcoLow />} tone="gold" value={lowStock.toLocaleString()} label="Low stock" />
        <StatCard icon={<IcoCoins />} tone="gold" value={rwf(totals.spent)} label="Total spent" />
        <StatCard icon={<IcoChick />} tone="green" value={totals.chicks.toLocaleString()} label="Chicks available" />
      </div>

      {/* Stock */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[0.95rem] font-bold text-ink">Stock</h2>
          <div className="flex flex-wrap items-center gap-2">
            <span className="w-44">
              <Select value={cat} onChange={(e) => { setCat(e.target.value as "all" | SupplyKind); setPage(1); }}
                options={[{ value: "all", label: "All categories" }, ...SUPPLY_CATEGORIES.map((c) => ({ value: c.value, label: c.label }))]} />
            </span>
            <div className="relative w-full max-w-xs">
              <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
              <Input className="pl-9" placeholder="Search item name…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
            </div>
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Item</th>
              <th className={HG}>Category</th>
              <th className={`${HG} text-right`}>In stock</th>
              <th className={`${HG} text-right`}>Unit cost</th>
              <th className={`${HG} text-right`}>Value</th>
              <th className={HG}>Supplier</th>
              <th className={canManage ? HG : `${HG} last:rounded-tr-lg`}>Updated</th>
              {canManage && <th className={`${HG} last:rounded-tr-lg`}></th>}
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={canManage ? 8 : 7} text="Nothing in stock." />
            ) : (
              pageRows.map((s) => {
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No items" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} items`}</span>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>‹</Button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(Math.max(0, curPage - 3), Math.max(0, curPage - 3) + 5).map((p) => (
                <Button key={p} size="sm" variant={p === curPage ? "primary" : "ghost"} onClick={() => setPage(p)}>{p}</Button>
              ))}
              <Button size="sm" variant="ghost" disabled={curPage >= pageCount} onClick={() => setPage(curPage + 1)}>›</Button>
            </div>
            <label className="flex items-center gap-2">Rows per page:
              <span className="w-20"><Select value={String(perPage)} onChange={(e) => { setPerPage(Number(e.target.value)); setPage(1); }} options={[10, 25, 50].map((n) => ({ value: String(n), label: String(n) }))} /></span>
            </label>
          </div>
        </div>
      </Card>

      {/* Hatched chicks (read-only) */}
      <Card>
        <h2 className="mb-3 text-[0.95rem] font-bold text-ink">Hatched chicks (read-only)</h2>
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

      {/* Add / edit modal */}
      <Modal open={showForm && canManage} onClose={closeForm} title={editingId ? "Edit inventory item" : "Add inventory item"} className="max-w-2xl">
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
      </Modal>
    </div>
  );
}

// ---- stat card + icons ----------------------------------------------------

type Tone = "green" | "gold" | "blue" | "red" | "default";
const CHIP: Record<Tone, string> = {
  green: "bg-green-bg text-green", gold: "bg-gold-bg text-gold-dark", blue: "bg-blue-bg text-blue", red: "bg-red-bg text-red", default: "bg-grey-bg text-ink",
};
function StatCard({ icon, value, label, tone = "default" }: { icon: ReactNode; value: string; label: string; tone?: Tone }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-paper px-3.5 py-3 shadow-card">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${CHIP[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-[1.3rem] font-extrabold leading-none tracking-tight text-ink tabular-nums">{value}</p>
        <p className="mt-1 truncate text-[0.62rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      </div>
    </div>
  );
}

const fsvg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoBox = () => fsvg(<><path d="M3.5 7.5 12 3l8.5 4.5v9L12 21l-8.5-4.5z" /><path d="M3.5 7.5 12 12l8.5-4.5M12 12v9" /></>);
const IcoAlert = () => fsvg(<><path d="M12 3.5 21 19H3z" /><path d="M12 10v4M12 16.5v.5" /></>);
const IcoLow = () => fsvg(<><path d="M12 5v10" /><path d="m7 11 5 5 5-5" /><path d="M5 19h14" /></>);
const IcoCoins = () => fsvg(<><ellipse cx="12" cy="6" rx="7" ry="3" /><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6" /></>);
const IcoChick = () => fsvg(<><circle cx="12" cy="13" r="6" /><path d="M12 7V4M10 4h4" /><path d="M18 12l2-1" /></>);

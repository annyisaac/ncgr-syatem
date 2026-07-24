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
import { listFlocks, type BreederFlock } from "@/lib/parentStock";
import { listDailyLogs, type DailyLog } from "@/lib/psDaily";
import {
  INVENTORY_CATEGORIES, MOVE_TYPES, feedWaterSummary, isLow, listItems, listMoves,
  listRequisitions, moveEffect, newItemId, newMoveId, newRequisitionId, nextRef, stamp, upsertItem, upsertMove,
  upsertRequisition, type InventoryItem, type MoveType, type Requisition, type RequisitionStatus, type StockMove,
} from "@/lib/psInventory";

type Tab = "stock" | "requisitions";

const reqTone = (s: RequisitionStatus) => s === "Issued" ? "green" : s === "Rejected" ? "red" : s === "Approved" ? "info" : "gold";

export default function InventoryPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [moves, setMoves] = useState<StockMove[]>([]);
  const [reqs, setReqs] = useState<Requisition[]>([]);
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [tab, setTab] = useState<Tab>("stock");
  const [itemEdit, setItemEdit] = useState<InventoryItem | null>(null);
  const [moveItem, setMoveItem] = useState<InventoryItem | null>(null);
  const [reqOpen, setReqOpen] = useState(false);

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";

  const load = useCallback(async () => {
    try { const [i, m, r, f, l] = await Promise.all([listItems(), listMoves(), listRequisitions(), listFlocks(), listDailyLogs()]); setItems(i); setMoves(m); setReqs(r); setFlocks(f); setLogs(l); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-inventory-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["ps_inventory", "ps_stock_moves", "ps_requisitions", "ps_daily"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const activeItems = useMemo(() => items.filter((i) => i.active), [items]);
  const lowItems = useMemo(() => activeItems.filter(isLow), [activeItems]);
  const stockValue = activeItems.reduce((s, i) => s + i.currentStock * (i.unitCost || 0), 0);
  const feedWater = useMemo(() => feedWaterSummary(logs, flocks, items), [logs, flocks, items]);
  const openReqs = reqs.filter((r) => r.status === "Requested").length;
  const flockOpts = useMemo(() => [{ value: "", label: "— none —" }, ...flocks.filter((f) => f.active).map((f) => ({ value: f.id, label: `${f.code} (${f.sex})` }))], [flocks]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  async function saveItem(i: InventoryItem) {
    setItems((p) => { const x = p.findIndex((y) => y.id === i.id); const c = p.slice(); if (x === -1) c.unshift(i); else c[x] = i; return c; });
    try { await upsertItem(i); toast("Item saved."); } catch { toast("Could not save.", "error"); void load(); }
    setItemEdit(null);
  }
  async function recordMove(m: StockMove) {
    const item = items.find((i) => i.id === m.itemId);
    if (!item) return;
    const updated: InventoryItem = { ...item, currentStock: Math.max(0, item.currentStock + moveEffect(m)) };
    setMoves((p) => [m, ...p]);
    setItems((p) => p.map((i) => i.id === updated.id ? updated : i));
    try { await Promise.all([upsertMove(m), upsertItem(updated)]); toast(`${m.type} recorded — ${updated.name} now ${updated.currentStock} ${updated.unit}.`); } catch { toast("Could not record.", "error"); void load(); }
    setMoveItem(null);
  }
  async function saveReq(r: Requisition) {
    setReqs((p) => { const x = p.findIndex((y) => y.id === r.id); const c = p.slice(); if (x === -1) c.unshift(r); else c[x] = r; return c; });
    try { await upsertRequisition(r); } catch { toast("Could not save.", "error"); void load(); }
  }
  async function decideReq(r: Requisition, status: RequisitionStatus) {
    const next: Requisition = { ...r, status, decidedBy: user!.email, decidedOn: nowISO(), history: [...r.history, stamp(user!.email, status.toLowerCase())] };
    // Issuing a requisition draws the stock down.
    if (status === "Issued" && r.itemId) {
      const item = items.find((i) => i.id === r.itemId);
      if (item) {
        const m: StockMove = { id: newMoveId(), itemId: item.id, itemName: item.name, type: "Issue", quantity: r.quantity, date: todayISO(), reason: `Requisition ${r.ref}`, by: user!.email, on: nowISO() };
        const updated = { ...item, currentStock: Math.max(0, item.currentStock - r.quantity) };
        setMoves((p) => [m, ...p]); setItems((p) => p.map((i) => i.id === updated.id ? updated : i));
        try { await Promise.all([upsertMove(m), upsertItem(updated)]); } catch { /* handled below */ }
      }
    }
    await saveReq(next);
    toast(`Requisition ${status.toLowerCase()}.`);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Items" value={String(activeItems.length)} />
        <StatTile label="Low stock" value={String(lowItems.length)} tone={lowItems.length > 0 ? "red" : "default"} />
        <StatTile label="Stock value" value={formatRWF(stockValue)} />
        <StatTile label="Requisitions open" value={String(openReqs)} tone={openReqs > 0 ? "gold" : "default"} />
      </div>

      <Card>
        <CardHeader title="Feed & water (from daily logs)" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <StatTile label="Feed consumed" value={`${feedWater.feedKg.toLocaleString()} kg`} />
          <StatTile label="Feed / bird" value={`${feedWater.feedPerBird} kg`} />
          <StatTile label="Feed cost" value={formatRWF(feedWater.feedCost)} tone="gold" />
          <StatTile label="Water consumed" value={`${feedWater.waterL.toLocaleString()} L`} />
          <StatTile label="Water / bird" value={`${feedWater.waterPerBird} L`} />
          <StatTile label="Live birds" value={feedWater.birds.toLocaleString()} />
        </div>
      </Card>

      {lowItems.length > 0 && (
        <Card className="border-red/40">
          <CardHeader title={`Low stock — reorder (${lowItems.length})`} />
          <div className="flex flex-wrap gap-2">
            {lowItems.map((i) => <Pill key={i.id} tone="red">{i.name}: {i.currentStock} / {i.reorderLevel} {i.unit}</Pill>)}
          </div>
        </Card>
      )}

      <div className="flex flex-wrap gap-1.5 border-b border-line">
        {(["stock", "requisitions"] as Tab[]).map((t) => (
          <button key={t} type="button" onClick={() => setTab(t)}
            className={`rounded-t-lg px-3.5 py-2 text-sm font-semibold capitalize transition ${tab === t ? "border-b-2 border-gold text-gold-dark" : "text-muted hover:text-ink"}`}>{t}</button>
        ))}
      </div>

      {tab === "stock" && (
        <Card>
          <CardHeader title={`Inventory (${activeItems.length})`} action={<Button size="sm" onClick={() => setItemEdit({ id: newItemId(), name: "", category: INVENTORY_CATEGORIES[0], unit: "kg", currentStock: 0, active: true, by: user.email, on: nowISO() })}>＋ Add item</Button>} />
          <TableWrap>
            <thead><tr><Th>Item</Th><Th>Category</Th><Th className="text-right">Stock</Th><Th className="text-right">Reorder</Th><Th className="text-right">Unit cost</Th><Th className="text-right">Value</Th><Th></Th></tr></thead>
            <tbody>
              {activeItems.length === 0 ? <EmptyRow colSpan={7} text="No inventory items yet." /> : activeItems.map((i) => (
                <tr key={i.id}>
                  <Td className="font-medium">{i.name}{isLow(i) && <Pill tone="red" className="ml-2">Low</Pill>}</Td>
                  <Td>{i.category}</Td>
                  <Td className="text-right">{i.currentStock.toLocaleString()} {i.unit}</Td>
                  <Td className="text-right">{i.reorderLevel != null ? `${i.reorderLevel} ${i.unit}` : "—"}</Td>
                  <Td className="text-right">{i.unitCost ? formatRWF(i.unitCost) : "—"}</Td>
                  <Td className="text-right">{i.unitCost ? formatRWF(i.currentStock * i.unitCost) : "—"}</Td>
                  <Td><div className="flex justify-end gap-1"><Button size="sm" variant="ghost" onClick={() => setMoveItem(i)}>Move</Button><Button size="sm" variant="ghost" onClick={() => setItemEdit(i)}>Edit</Button></div></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          {moves.length > 0 && (
            <div className="mt-4">
              <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Recent movements</div>
              <TableWrap>
                <thead><tr><Th>Date</Th><Th>Item</Th><Th>Type</Th><Th className="text-right">Qty</Th><Th>Flock</Th><Th>Reason</Th></tr></thead>
                <tbody>
                  {moves.slice(0, 12).map((m) => (
                    <tr key={m.id}><Td>{formatDate(m.date)}</Td><Td className="font-medium">{m.itemName}</Td><Td>{m.type}</Td>
                      <Td className={`text-right ${moveEffect(m) < 0 ? "text-red" : "text-green"}`}>{moveEffect(m) > 0 ? "+" : ""}{moveEffect(m).toLocaleString()}</Td>
                      <Td>{m.flockCode || "—"}</Td><Td>{m.reason || "—"}</Td></tr>
                  ))}
                </tbody>
              </TableWrap>
            </div>
          )}
        </Card>
      )}

      {tab === "requisitions" && (
        <Card>
          <CardHeader title={`Requisitions (${reqs.length})`} action={<Button size="sm" onClick={() => setReqOpen(true)}>＋ New requisition</Button>} />
          <TableWrap>
            <thead><tr><Th>Ref</Th><Th>Item</Th><Th className="text-right">Qty</Th><Th>Reason</Th><Th>Status</Th><Th></Th></tr></thead>
            <tbody>
              {reqs.length === 0 ? <EmptyRow colSpan={6} text="No requisitions yet." /> : reqs.map((r) => (
                <tr key={r.id}>
                  <Td className="font-medium">{r.ref}</Td>
                  <Td>{r.itemName}<div className="text-xs text-muted">{r.category}</div></Td>
                  <Td className="text-right">{r.quantity.toLocaleString()} {r.unit}</Td>
                  <Td className="max-w-[16rem] truncate">{r.reason || "—"}</Td>
                  <Td><Pill tone={reqTone(r.status)}>{r.status}</Pill></Td>
                  <Td><div className="flex justify-end gap-1">
                    {r.status === "Requested" && <><Button size="sm" variant="ghost" onClick={() => decideReq(r, "Rejected")}>Reject</Button><Button size="sm" onClick={() => decideReq(r, "Approved")}>Approve</Button></>}
                    {r.status === "Approved" && <Button size="sm" onClick={() => decideReq(r, "Issued")} disabled={!r.itemId}>Issue</Button>}
                  </div></Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
          <p className="mt-2 text-xs text-muted">The Parent Stock Manager approves internal requisitions; issuing draws the stock down. Approved ones with a linked item reduce inventory when issued.</p>
        </Card>
      )}

      {itemEdit && <ItemModal key={itemEdit.id} initial={itemEdit} onClose={() => setItemEdit(null)} onSave={saveItem} />}
      {moveItem && <MoveModal item={moveItem} email={user.email} flockOpts={flockOpts} onClose={() => setMoveItem(null)} onSave={recordMove} />}
      {reqOpen && <ReqModal items={activeItems} email={user.email} nextRefValue={nextRef("REQ", reqs)} onClose={() => setReqOpen(false)} onSave={(r) => { void saveReq(r); setReqOpen(false); toast("Requisition raised."); }} />}
    </div>
  );
}

function ItemModal({ initial, onClose, onSave }: { initial: InventoryItem; onClose: () => void; onSave: (i: InventoryItem) => void }) {
  const [i, setI] = useState<InventoryItem>(initial);
  const set = (p: Partial<InventoryItem>) => setI((x) => ({ ...x, ...p }));
  return (
    <Modal open onClose={onClose} title={initial.name ? "Edit item" : "Add item"} className="max-w-xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => { if (i.name.trim()) onSave({ ...i, name: i.name.trim() }); }}>Save item</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Item name" required><Input value={i.name} onChange={(e) => set({ name: e.target.value })} /></Field></div>
        <Field label="Category"><Select value={i.category} onChange={(e) => set({ category: e.target.value })} options={INVENTORY_CATEGORIES.map((c) => ({ value: c, label: c }))} /></Field>
        <Field label="Unit"><Input value={i.unit} onChange={(e) => set({ unit: e.target.value })} placeholder="kg, bag, ml, pcs" /></Field>
        <Field label="Current stock"><Input type="number" min={0} value={i.currentStock || ""} onChange={(e) => set({ currentStock: Number(e.target.value) || 0 })} /></Field>
        <Field label="Reorder level"><Input type="number" min={0} value={i.reorderLevel ?? ""} onChange={(e) => set({ reorderLevel: Number(e.target.value) || undefined })} /></Field>
        <Field label="Unit cost (RWF)"><Input type="number" min={0} value={i.unitCost ?? ""} onChange={(e) => set({ unitCost: Number(e.target.value) || undefined })} /></Field>
        <div className="flex items-end"><label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" checked={i.active} onChange={(e) => set({ active: e.target.checked })} /> Active</label></div>
      </div>
    </Modal>
  );
}

function MoveModal({ item, email, flockOpts, onClose, onSave }: {
  item: InventoryItem; email: string; flockOpts: { value: string; label: string }[]; onClose: () => void; onSave: (m: StockMove) => void;
}) {
  const [type, setType] = useState<MoveType>("Receipt");
  const [quantity, setQuantity] = useState(0);
  const [date, setDate] = useState(todayISO());
  const [flockId, setFlockId] = useState("");
  const [reason, setReason] = useState("");
  const effect = moveEffect({ type, quantity });
  const after = Math.max(0, item.currentStock + effect);
  return (
    <Modal open onClose={onClose} title={`Stock movement · ${item.name}`} className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => { if (quantity !== 0) onSave({ id: newMoveId(), itemId: item.id, itemName: item.name, type, quantity: Math.abs(quantity), date, flockId: flockId || undefined, flockCode: flockOpts.find((o) => o.value === flockId)?.label, reason: reason.trim() || undefined, by: email, on: nowISO() }); }} disabled={quantity === 0}>Record</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as MoveType)} options={MOVE_TYPES.map((t) => ({ value: t, label: t }))} /></Field>
        <Field label="Quantity"><Input type="number" value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value) || 0)} /></Field>
        <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        {(type === "Issue") && <Field label="Issued to flock"><Select value={flockId} onChange={(e) => setFlockId(e.target.value)} options={flockOpts} /></Field>}
        <div className="sm:col-span-2"><Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      </div>
      <p className="mt-3 text-xs text-muted">{item.currentStock.toLocaleString()} {item.unit} → <strong>{after.toLocaleString()} {item.unit}</strong> after this {type.toLowerCase()}.</p>
    </Modal>
  );
}

function ReqModal({ items, email, nextRefValue, onClose, onSave }: {
  items: InventoryItem[]; email: string; nextRefValue: string; onClose: () => void; onSave: (r: Requisition) => void;
}) {
  const [itemId, setItemId] = useState("");
  const [itemName, setItemName] = useState("");
  const [quantity, setQuantity] = useState(0);
  const [reason, setReason] = useState("");
  const linked = items.find((i) => i.id === itemId);

  return (
    <Modal open onClose={onClose} title="New requisition" className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => { const name = linked?.name ?? itemName.trim(); if (name && quantity > 0) onSave({ id: newRequisitionId(), ref: nextRefValue, itemId: itemId || undefined, itemName: name, category: linked?.category, quantity, unit: linked?.unit, reason: reason.trim() || undefined, status: "Requested", requestedBy: email, on: nowISO(), history: [stamp(email, "requested")] }); }} disabled={quantity <= 0 || (!itemId && !itemName.trim())}>Raise requisition</Button></>}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><Field label="Existing item"><Select value={itemId} onChange={(e) => setItemId(e.target.value)} options={[{ value: "", label: "— or type a new item below —" }, ...items.map((i) => ({ value: i.id, label: `${i.name} (${i.currentStock} ${i.unit})` }))]} /></Field></div>
        {!itemId && <div className="sm:col-span-2"><Field label="New item name"><Input value={itemName} onChange={(e) => setItemName(e.target.value)} /></Field></div>}
        <Field label="Quantity"><Input type="number" min={0} value={quantity || ""} onChange={(e) => setQuantity(Number(e.target.value) || 0)} /></Field>
        <Field label="Unit"><Input value={linked?.unit ?? ""} disabled placeholder="from item" /></Field>
        <div className="sm:col-span-2"><Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      </div>
    </Modal>
  );
}

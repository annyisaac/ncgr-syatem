"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate, formatDateTime } from "@/lib/format";
import type { SparePart, SparePartRequest, Purchase } from "@/lib/hatchery/types";

const CAN_MANAGE = ["Admin", "Hatchery Manager", "Operations Manager"];

const num = (v: string) => Number(v) || 0;
const rwf = (n: number) => `${Math.round(n).toLocaleString()} RWF`;
const totalBought = (p: SparePart) => (p.purchases ?? []).reduce((a, x) => a + x.qty, 0);
const totalSpent = (p: SparePart) => (p.purchases ?? []).reduce((a, x) => a + x.qty * x.unitCost, 0);

export default function SparePartsPage() {
  const { user } = useAuth();
  const { spareParts, spareRequests, upsertSparePart, upsertSpareRequest, newId } = useHatchery();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({ name: "", unit: "pcs", location: "", qty: "", unitCost: "", supplier: "", date: todayISO() });
  const [err, setErr] = useState<string | null>(null);

  const [buyFor, setBuyFor] = useState<SparePart | null>(null);
  const [buy, setBuy] = useState({ qty: "", unitCost: "", supplier: "", date: todayISO() });
  const [buyErr, setBuyErr] = useState<string | null>(null);

  const [reqFor, setReqFor] = useState<SparePart | null>(null);
  const [req, setReq] = useState({ qty: "", reason: "" });
  const [reqErr, setReqErr] = useState<string | null>(null);

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const partName = (id: string) => spareParts.find((p) => p.id === id)?.name ?? "—";

  const parts = useMemo(() => spareParts.slice().sort((a, b) => a.name.localeCompare(b.name)), [spareParts]);
  const pending = useMemo(() => spareRequests.filter((r) => r.status === "pending").sort((a, b) => (a.on < b.on ? 1 : -1)), [spareRequests]);
  const myRequests = useMemo(
    () => spareRequests.filter((r) => r.requestedBy === user?.email).sort((a, b) => (a.on < b.on ? 1 : -1)).slice(0, 10),
    [spareRequests, user]
  );
  const history = useMemo(
    () => spareRequests.filter((r) => r.status !== "pending").sort((a, b) => ((a.decidedOn ?? a.on) < (b.decidedOn ?? b.on) ? 1 : -1)).slice(0, 20),
    [spareRequests]
  );

  if (!user) return null;

  function addPart(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.name.trim()) return setErr("Enter a name.");
    const qty = num(f.qty), cost = num(f.unitCost), on = nowISO();
    const purchases: Purchase[] = qty > 0 ? [{ qty, unitCost: cost, supplier: f.supplier.trim(), on: `${f.date}T08:00:00Z`, by: user!.email }] : [];
    upsertSparePart({
      id: newId("part"), name: f.name.trim(), unit: f.unit.trim() || "pcs", location: f.location.trim() || undefined,
      quantity: qty, purchases,
      history: [`${on} — recorded${qty > 0 ? ` with ${qty} @ ${rwf(cost)}` : ""} by ${user!.name}`], by: user!.email, on,
    });
    toast(`${f.name.trim()} recorded in spare-part room.`);
    setShowAdd(false); setF({ ...f, name: "", location: "", qty: "", unitCost: "", supplier: "" });
  }

  function openBuy(p: SparePart) {
    setBuyFor(p); setBuyErr(null);
    setBuy({ qty: "", unitCost: String(p.purchases?.slice(-1)[0]?.unitCost ?? ""), supplier: p.purchases?.slice(-1)[0]?.supplier ?? "", date: todayISO() });
  }
  function saveBuy() {
    if (!buyFor) return;
    setBuyErr(null);
    const qty = num(buy.qty);
    if (qty <= 0) return setBuyErr("Enter a quantity.");
    const cost = num(buy.unitCost), on = nowISO();
    upsertSparePart({
      ...buyFor, quantity: buyFor.quantity + qty,
      purchases: [...(buyFor.purchases ?? []), { qty, unitCost: cost, supplier: buy.supplier.trim(), on: `${buy.date}T08:00:00Z`, by: user!.email }],
      history: [...buyFor.history, `${on} — bought ${qty} @ ${rwf(cost)} from ${buy.supplier || "—"} by ${user!.name}`], on,
    });
    toast(`Added ${qty} ${buyFor.unit} of ${buyFor.name}.`);
    setBuyFor(null);
  }

  function openReq(p: SparePart) {
    setReqFor(p); setReqErr(null); setReq({ qty: "", reason: "" });
  }
  function saveReq() {
    if (!reqFor) return;
    setReqErr(null);
    const qty = num(req.qty);
    if (qty <= 0) return setReqErr("Enter a quantity.");
    if (!req.reason.trim()) return setReqErr("Say what it's for.");
    const on = nowISO();
    upsertSpareRequest({
      id: newId("spreq"), partId: reqFor.id, partName: reqFor.name, quantity: qty, reason: req.reason.trim(),
      requestedBy: user!.email, requestedByName: user!.name, status: "pending", on,
    });
    toast(`Requested ${qty} × ${reqFor.name} — awaiting the Hatchery Manager.`);
    setReqFor(null);
  }

  function approve(r: SparePartRequest) {
    const part = spareParts.find((p) => p.id === r.partId);
    if (!part) return toast("Part no longer exists.");
    if (part.quantity < r.quantity) return toast(`Only ${part.quantity} ${part.unit} of ${part.name} in stock.`);
    const on = nowISO();
    upsertSparePart({
      ...part, quantity: part.quantity - r.quantity,
      history: [...part.history, `${on} — issued ${r.quantity} to ${r.requestedByName} (approved by ${user!.name})`], on,
    });
    upsertSpareRequest({ ...r, status: "approved", decidedBy: user!.name, decidedOn: on });
    toast(`Approved — ${r.quantity} × ${part.name} issued to ${r.requestedByName}.`);
  }
  function reject(r: SparePartRequest) {
    upsertSpareRequest({ ...r, status: "rejected", decidedBy: user!.name, decidedOn: nowISO() });
    toast(`Rejected ${r.requestedByName}'s request for ${r.partName}.`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Spare Parts</h1>
        {canManage && <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Hide" : "Record part"}</Button>}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label="Parts tracked" value={parts.length.toLocaleString()} />
        <Kpi label="Out of stock" value={parts.filter((p) => p.quantity <= 0).length.toLocaleString()} />
        <Kpi label="Pending requests" value={pending.length.toLocaleString()} tone={pending.length ? "gold" : "green"} />
        <Kpi label="Total spent" value={rwf(parts.reduce((a, p) => a + totalSpent(p), 0))} tone="gold" />
      </div>

      {showAdd && canManage && (
        <Card>
          <CardHeader title="Record a spare part" />
          <form onSubmit={addPart} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Part name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="e.g. Setter fan motor" /></Field>
            <Field label="Unit"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
            <Field label="Location (shelf/bin)"><Input value={f.location} onChange={(e) => setF({ ...f, location: e.target.value })} /></Field>
            <Field label="Quantity"><Input type="number" value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} /></Field>
            <Field label="Unit cost (RWF)"><Input type="number" value={f.unitCost} onChange={(e) => setF({ ...f, unitCost: e.target.value })} /></Field>
            <Field label="Supplier"><Input value={f.supplier} onChange={(e) => setF({ ...f, supplier: e.target.value })} /></Field>
            <Field label="Date bought"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            {err && <p className="sm:col-span-3 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowAdd(false)}>Cancel</Button>
              <Button type="submit">Save part</Button>
            </div>
          </form>
        </Card>
      )}

      {canManage && (
        <Card>
          <CardHeader title={`Requests to approve (${pending.length})`} />
          <TableWrap>
            <thead><tr><Th>When</Th><Th>Part</Th><Th className="text-right">Qty</Th><Th>For</Th><Th>Requested by</Th><Th>Decision</Th></tr></thead>
            <tbody>
              {pending.length === 0 ? <EmptyRow colSpan={6} text="No pending requests." /> : pending.map((r) => {
                const part = spareParts.find((p) => p.id === r.partId);
                const short = !!part && part.quantity < r.quantity;
                return (
                  <tr key={r.id}>
                    <Td className="text-xs text-muted">{formatDateTime(r.on)}</Td>
                    <Td className="font-medium">{r.partName}{short && <span className="ml-1 text-xs text-status-refunded">(only {part!.quantity} left)</span>}</Td>
                    <Td className="text-right">{r.quantity.toLocaleString()}</Td>
                    <Td className="text-sm">{r.reason}</Td>
                    <Td>{r.requestedByName}</Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => approve(r)} disabled={short}>Approve</Button>
                        <Button size="sm" variant="ghost" onClick={() => reject(r)}>Reject</Button>
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}

      <Card>
        <CardHeader title="Spare-part room" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Part</Th><Th>Location</Th><Th className="text-right">In stock</Th>
              {canManage && <><Th className="text-right">Bought</Th><Th className="text-right">Spent</Th></>}
              <Th>Action</Th>
            </tr>
          </thead>
          <tbody>
            {parts.length === 0 ? (
              <EmptyRow colSpan={canManage ? 6 : 4} text="No spare parts recorded yet." />
            ) : parts.map((p) => (
              <tr key={p.id}>
                <Td className="font-medium">{p.name}</Td>
                <Td className="text-muted">{p.location ?? "—"}</Td>
                <Td className="text-right">{p.quantity.toLocaleString()} {p.unit} {p.quantity <= 0 && <Pill tone="gold">out</Pill>}</Td>
                {canManage && <><Td className="text-right text-muted">{totalBought(p).toLocaleString()}</Td><Td className="text-right text-muted">{rwf(totalSpent(p))}</Td></>}
                <Td>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" variant="secondary" onClick={() => openReq(p)} disabled={p.quantity <= 0}>Request</Button>
                    {canManage && <Button size="sm" onClick={() => openBuy(p)}>Buy</Button>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title={canManage ? "Recent decisions" : "My requests"} />
        <TableWrap>
          <thead><tr><Th>When</Th><Th>Part</Th><Th className="text-right">Qty</Th>{canManage && <Th>Requested by</Th>}<Th>Status</Th><Th>By</Th></tr></thead>
          <tbody>
            {(canManage ? history : myRequests).length === 0 ? (
              <EmptyRow colSpan={canManage ? 6 : 5} text="Nothing yet." />
            ) : (canManage ? history : myRequests).map((r) => (
              <tr key={r.id}>
                <Td className="text-xs text-muted">{formatDate((r.decidedOn ?? r.on).slice(0, 10))}</Td>
                <Td>{r.partName || partName(r.partId)}</Td>
                <Td className="text-right">{r.quantity.toLocaleString()}</Td>
                {canManage && <Td>{r.requestedByName}</Td>}
                <Td><Pill tone={r.status === "approved" ? "green" : r.status === "rejected" ? "neutral" : "gold"}>{r.status}</Pill></Td>
                <Td className="text-xs text-muted">{r.decidedBy ?? "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {/* Request modal */}
      <Modal
        open={!!reqFor}
        onClose={() => setReqFor(null)}
        title={reqFor ? `Request — ${reqFor.name}` : "Request a part"}
        footer={<><Button variant="ghost" onClick={() => setReqFor(null)}>Cancel</Button><Button onClick={saveReq}>Send request</Button></>}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted">In stock: <strong className="text-ink">{reqFor?.quantity.toLocaleString()} {reqFor?.unit}</strong>. The Hatchery Manager approves before it leaves the room.</p>
          <Field label={`Quantity (${reqFor?.unit ?? ""})`}><Input type="number" value={req.qty} onChange={(e) => setReq({ ...req, qty: e.target.value })} /></Field>
          <Field label="What is it for?"><Input value={req.reason} onChange={(e) => setReq({ ...req, reason: e.target.value })} placeholder="e.g. Setter S03 fan replacement" /></Field>
          {reqErr && <p className="text-sm text-status-refunded">{reqErr}</p>}
        </div>
      </Modal>

      {/* Buy modal */}
      <Modal
        open={!!buyFor}
        onClose={() => setBuyFor(null)}
        title={buyFor ? `Record purchase — ${buyFor.name}` : "Record purchase"}
        footer={<><Button variant="ghost" onClick={() => setBuyFor(null)}>Cancel</Button><Button onClick={saveBuy}>Save purchase</Button></>}
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

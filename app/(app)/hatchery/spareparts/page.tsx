"use client";

import { useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate, formatDateTime } from "@/lib/format";
import type { SparePart, SparePartRequest, Purchase } from "@/lib/hatchery/types";

// Register parts, record purchases (buy) and request them.
const CAN_MANAGE = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager"];
// Approve/reject requests to take parts out of the room — kept from the
// Hatchery Operations Manager: they run the room but don't self-authorise issues.
const CAN_APPROVE = ["Admin", "Hatchery Manager", "Operations Manager"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

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

  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const canApprove = !!user && CAN_APPROVE.includes(user.role);
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

  // Summary.
  const outOfStock = parts.filter((p) => p.quantity <= 0).length;
  const unitsInStock = parts.reduce((a, p) => a + p.quantity, 0);
  const spentAll = parts.reduce((a, p) => a + totalSpent(p), 0);

  // Filtered + paginated parts.
  const s = q.trim().toLowerCase();
  const filtered = parts.filter((p) => !s || p.name.toLowerCase().includes(s) || (p.location ?? "").toLowerCase().includes(s) || p.unit.toLowerCase().includes(s));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Spare Parts</h1>
          <p className="text-sm text-muted">Stock the spare-part room, record purchases and issue parts on request</p>
        </div>
        {canManage && <Button onClick={() => setShowAdd(true)}>＋ Record part</Button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoBox />} tone="blue" value={parts.length.toLocaleString()} label="Parts tracked" />
        <StatCard icon={<IcoStack />} tone="green" value={unitsInStock.toLocaleString()} label="Units in stock" />
        <StatCard icon={<IcoAlert />} tone={outOfStock ? "red" : "default"} value={outOfStock.toLocaleString()} label="Out of stock" />
        <StatCard icon={<IcoClock />} tone={pending.length ? "gold" : "green"} value={pending.length.toLocaleString()} label="Pending requests" />
        <StatCard icon={<IcoCoin />} tone="gold" value={rwf(spentAll)} label="Total spent" />
      </div>

      {canApprove && (
        <Card>
          <CardHeader title={`Requests to approve (${pending.length})`} />
          <TableWrap>
            <thead>
              <tr>
                <th className={`${HG} first:rounded-tl-lg`}>When</th>
                <th className={HG}>Part</th>
                <th className={`${HG} text-right`}>Qty</th>
                <th className={HG}>For</th>
                <th className={HG}>Requested by</th>
                <th className={`${HG} last:rounded-tr-lg`}>Decision</th>
              </tr>
            </thead>
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

      {/* Spare-part room */}
      <Card>
        <div className="sticky top-16 z-20 -mx-5 -mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border-b border-line bg-paper/95 px-5 pb-3 pt-5 backdrop-blur">
          <h2 className="text-[0.95rem] font-bold text-ink">Spare-part room</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search part, location or unit…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Part</th>
              <th className={HG}>Location</th>
              <th className={`${HG} text-right`}>In stock</th>
              {canManage && <><th className={`${HG} text-right`}>Bought</th><th className={`${HG} text-right`}>Spent</th></>}
              <th className={`${HG} last:rounded-tr-lg`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={canManage ? 6 : 4} text={parts.length === 0 ? "No spare parts recorded yet." : "No spare parts match."} />
            ) : pageRows.map((p) => (
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No parts" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} parts`}</span>
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

      <Card>
        <CardHeader title={canManage ? "Recent decisions" : "My requests"} />
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>When</th>
              <th className={HG}>Part</th>
              <th className={`${HG} text-right`}>Qty</th>
              {canManage && <th className={HG}>Requested by</th>}
              <th className={HG}>Status</th>
              <th className={`${HG} last:rounded-tr-lg`}>By</th>
            </tr>
          </thead>
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

      {/* Record part modal */}
      <Modal open={showAdd && canManage} onClose={() => setShowAdd(false)} title="Record a spare part" className="max-w-2xl">
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
      </Modal>

      {/* Request modal */}
      <Modal
        open={!!reqFor}
        onClose={() => setReqFor(null)}
        title={reqFor ? `Request — ${reqFor.name}` : "Request a part"}
        className="max-w-2xl"
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
        className="max-w-2xl"
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
const IcoBox = () => fsvg(<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>);
const IcoStack = () => fsvg(<><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 12l9 5 9-5M3 16l9 5 9-5" /></>);
const IcoAlert = () => fsvg(<><path d="M12 3l9 16H3l9-16z" /><path d="M12 10v4M12 17h.01" /></>);
const IcoClock = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoCoin = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M9.5 14.5h4a1.5 1.5 0 0 0 0-3h-3a1.5 1.5 0 0 1 0-3h4M12 7v10" /></>);

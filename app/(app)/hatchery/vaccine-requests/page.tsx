"use client";

import { useMemo, useState, type ReactNode } from "react";

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
import type { Supply, VaccineRequest, VaccineRequestStatus } from "@/lib/hatchery/types";

const CAN_REQUEST = ["Admin", "Hatchery Veterinary"];
const CAN_CONFIRM = ["Admin", "Operations Manager"];
const CAN_FULFILL = ["Admin", "Hatchery Manager"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

const statusTone: Record<VaccineRequestStatus, "gold" | "info" | "green" | "red"> = {
  requested: "gold", confirmed: "info", sent: "green", declined: "red",
};

export default function VaccineRequestsPage() {
  const { user } = useAuth();
  const { vaccineRequests, supplies, upsertVaccineRequest, upsertSupply, newId } = useHatchery();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [f, setF] = useState({ vaccine: "", quantity: "", unit: "doses", reason: "", date: todayISO() });
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const role = user?.role;
  const canRequest = !!role && CAN_REQUEST.includes(role);
  const canConfirm = !!role && CAN_CONFIRM.includes(role);
  const canFulfill = !!role && CAN_FULFILL.includes(role);

  const rows = useMemo(() => vaccineRequests.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [vaccineRequests]);

  // Summary.
  const requestedCount = rows.filter((r) => r.status === "requested").length;
  const confirmedCount = rows.filter((r) => r.status === "confirmed").length;
  const sentCount = rows.filter((r) => r.status === "sent").length;
  const declinedCount = rows.filter((r) => r.status === "declined").length;

  // Filtered + paginated requests.
  const s = q.trim().toLowerCase();
  const filtered = rows.filter((r) => !s || (r.vaccine ?? "").toLowerCase().includes(s) || (r.requestedBy ?? "").toLowerCase().includes(s) || (r.reason ?? "").toLowerCase().includes(s) || (r.status ?? "").toLowerCase().includes(s));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  if (!user) return null;

  function openNew() {
    setF({ vaccine: "", quantity: "", unit: "doses", reason: "", date: todayISO() });
    setErr(null);
    setShow(true);
  }

  function request(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.vaccine.trim()) return setErr("Enter the vaccine name.");
    if (Number(f.quantity) <= 0) return setErr("Enter the quantity needed.");
    const on = nowISO();
    const rec: VaccineRequest = {
      id: newId("vreq"), date: f.date, vaccine: f.vaccine.trim(), quantity: Number(f.quantity),
      unit: f.unit.trim() || "doses", reason: f.reason.trim() || undefined, status: "requested",
      requestedBy: user!.email, by: user!.email, on,
      history: [`${on} — Requested ${f.quantity} ${f.unit} of ${f.vaccine.trim()} (by ${user!.name})`],
    };
    upsertVaccineRequest(rec);
    toast(`Requested ${rec.quantity} ${rec.unit} of ${rec.vaccine}.`);
    setShow(false);
  }

  function setStatus(r: VaccineRequest, status: VaccineRequestStatus, note: string, extra: Partial<VaccineRequest> = {}) {
    upsertVaccineRequest({ ...r, status, ...extra, history: [...r.history, `${nowISO()} — ${note} (by ${user!.name})`] });
    toast(note + ".");
  }

  function fulfill(r: VaccineRequest) {
    // Add the received vaccine to inventory (increment existing or create).
    const on = nowISO();
    const existing = supplies.find((s) => s.kind === "vaccine" && s.name.toLowerCase() === r.vaccine.toLowerCase());
    if (existing) {
      upsertSupply({ ...existing, quantity: existing.quantity + r.quantity, history: [...existing.history, `${on} — +${r.quantity} received from request by ${user!.name}`], on });
    } else {
      const s: Supply = { id: newId("sup"), kind: "vaccine", name: r.vaccine, unit: r.unit, quantity: r.quantity, history: [`${on} — created with ${r.quantity} from request by ${user!.name}`], by: user!.email, on };
      upsertSupply(s);
    }
    setStatus(r, "sent", `Received & added ${r.quantity} ${r.unit} to inventory`, { sentBy: user!.email });
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Vaccine Requests</h1>
          <p className="text-sm text-muted">Vet requests → Operations Manager confirms → Hatchery Manager receives &amp; stocks it</p>
        </div>
        {canRequest && <Button onClick={openNew}>＋ New Request</Button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoList />} tone="blue" value={rows.length.toLocaleString()} label="Total requests" />
        <StatCard icon={<IcoClock />} tone="gold" value={requestedCount.toLocaleString()} label="Awaiting confirm" />
        <StatCard icon={<IcoTruck />} tone="blue" value={confirmedCount.toLocaleString()} label="Awaiting receipt" />
        <StatCard icon={<IcoCheck />} tone="green" value={sentCount.toLocaleString()} label="Received" />
        <StatCard icon={<IcoX />} tone="red" value={declinedCount.toLocaleString()} label="Declined" />
      </div>

      {/* Requests */}
      <Card>
        <div className="sticky top-16 z-20 -mx-5 -mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border-b border-line bg-paper/95 px-5 pb-3 pt-5 backdrop-blur">
          <h2 className="text-[0.95rem] font-bold text-ink">Requests</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search vaccine, requester or status…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Date</th>
              <th className={HG}>Vaccine</th>
              <th className={`${HG} text-right`}>Qty</th>
              <th className={HG}>Requested by</th>
              <th className={HG}>Status</th>
              <th className={`${HG} last:rounded-tr-lg`}>Action</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? <EmptyRow colSpan={6} text="No vaccine requests match." /> : pageRows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{formatDate(r.date)}</Td>
                <Td className="font-medium">{r.vaccine}{r.reason && <span className="block text-xs text-muted">{r.reason}</span>}</Td>
                <Td className="text-right tabular-nums">{r.quantity.toLocaleString()} {r.unit}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{r.requestedBy}</Td>
                <Td><Pill tone={statusTone[r.status]}>{r.status}</Pill></Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {r.status === "requested" && canConfirm && (
                      <>
                        <Button size="sm" onClick={() => setStatus(r, "confirmed", "Confirmed — sent to Hatchery Manager", { confirmedBy: user!.email })}>Confirm</Button>
                        <Button size="sm" variant="ghost" onClick={() => setStatus(r, "declined", "Declined request")}>Decline</Button>
                      </>
                    )}
                    {r.status === "confirmed" && canFulfill && (
                      <Button size="sm" onClick={() => fulfill(r)}>Mark received</Button>
                    )}
                    {(r.status === "sent" || r.status === "declined") && <span className="text-xs text-muted">—</span>}
                    {r.status === "requested" && !canConfirm && <span className="text-xs text-muted">Awaiting Operations Manager</span>}
                    {r.status === "confirmed" && !canFulfill && <span className="text-xs text-muted">Awaiting Hatchery Manager</span>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No requests" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} requests`}</span>
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

      {/* New request modal */}
      <Modal open={show && canRequest} onClose={() => setShow(false)} title="Request a vaccine to be bought" className="max-w-2xl">
        <form onSubmit={request} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2"><Field label="Vaccine"><Input value={f.vaccine} onChange={(e) => setF({ ...f, vaccine: e.target.value })} placeholder="e.g. Marek's" /></Field></div>
          <Field label="Quantity"><Input type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
          <Field label="Unit"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
          <div className="sm:col-span-4"><Field label="Reason (optional)"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field></div>
          {err && <p className="sm:col-span-4 text-sm text-status-refunded">{err}</p>}
          <div className="sm:col-span-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
            <Button type="submit">Send request</Button>
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
const IcoList = () => fsvg(<><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.01M4 12h.01M4 18h.01" /></>);
const IcoClock = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoTruck = () => fsvg(<><rect x="2" y="7" width="12" height="9" rx="1" /><path d="M14 10h4l3 3v3h-7z" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></>);
const IcoCheck = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M8.5 12l2.5 2.5 4.5-4.5" /></>);
const IcoX = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M9 9l6 6M15 9l-6 6" /></>);

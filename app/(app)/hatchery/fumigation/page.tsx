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
import type { Fumigation, Reception, TrolleyRow } from "@/lib/hatchery/types";
import { settableEggs } from "@/lib/hatchery/lifecycle";

const CAN_ADD = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];
const HG = "bg-green px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-white whitespace-nowrap";

export default function FumigationPage() {
  const { user } = useAuth();
  const { fumigations, receptions, farms, upsertFumigation, upsertReception, newId } = useHatchery();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [receptionId, setReceptionId] = useState("");
  const [chemicals, setChemicals] = useState("");
  const [time, setTime] = useState("");
  const [date, setDate] = useState(todayISO());
  const [trolleys, setTrolleys] = useState<{ label: string; eggs: string }[]>([{ label: "1", eggs: "" }]);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const canAdd = !!user && CAN_ADD.includes(user.role);
  const farmLoc = (name: string) => farms.find((x) => x.name === name)?.location ?? "";

  const available = useMemo(
    () => receptions.filter((r) => !r.batchId).sort((a, b) => (a.date < b.date ? 1 : -1)),
    [receptions]
  );
  const reception = available.find((r) => r.id === receptionId) ?? null;
  const settable = reception ? settableEggs(reception) : 0;
  const alreadyFum = reception?.fumigatedEggs ?? 0;
  const totalEggs = trolleys.reduce((s, t) => s + (Number(t.eggs) || 0), 0);

  const runs = useMemo(() => fumigations.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [fumigations]);
  const recLabel = (id?: string) => {
    const r = receptions.find((x) => x.id === id);
    return r ? `${r.farm} · ${r.flockId}` : "—";
  };

  // Summary.
  const eggsFumigated = runs.reduce((s, r) => s + (r.totalEggs ?? 0), 0);
  const pendingRecs = available.filter((r) => settableEggs(r) > (r.fumigatedEggs ?? 0));
  const eggsPending = pendingRecs.reduce((s, r) => s + Math.max(0, settableEggs(r) - (r.fumigatedEggs ?? 0)), 0);
  const fullyFum = available.filter((r) => settableEggs(r) > 0 && (r.fumigatedEggs ?? 0) >= settableEggs(r)).length;

  // Filtered + paginated runs.
  const s = q.trim().toLowerCase();
  const filtered = runs.filter((r) => !s || (r.farm ?? "").toLowerCase().includes(s) || (r.flockId ?? "").toLowerCase().includes(s) || (r.chemicals ?? "").toLowerCase().includes(s));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  if (!user) return null;

  function openNew(r?: Reception) {
    setReceptionId(r?.id ?? "");
    setChemicals(""); setTime(""); setDate(todayISO()); setTrolleys([{ label: "1", eggs: "" }]); setErr(null);
    setShow(true);
  }
  function addTrolley() { setTrolleys([...trolleys, { label: String(trolleys.length + 1), eggs: "" }]); }
  function removeTrolley(i: number) { setTrolleys(trolleys.length === 1 ? trolleys : trolleys.filter((_, j) => j !== i)); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!reception) return setErr("Select a reception to fumigate.");
    if (!chemicals.trim()) return setErr("Enter the chemicals used.");
    if (totalEggs <= 0) return setErr("Add at least one trolley with eggs.");
    if (alreadyFum + totalEggs > settable) return setErr(`That exceeds settable eggs — ${settable.toLocaleString()} settable, ${alreadyFum.toLocaleString()} already fumigated.`);
    const rowsOut: TrolleyRow[] = trolleys.map((t) => ({ label: t.label.trim() || "-", eggs: Number(t.eggs) || 0 })).filter((t) => t.eggs > 0);
    const rec: Fumigation = {
      id: newId("fum"), date, receptionId: reception.id, farm: reception.farm, flockId: reception.flockId,
      chemicals: chemicals.trim(), trolleys: rowsOut, totalEggs, time: time.trim(), by: user!.email, on: nowISO(),
    };
    upsertFumigation(rec);
    upsertReception({ ...reception, fumigatedEggs: alreadyFum + totalEggs });
    toast(`Fumigated ${totalEggs.toLocaleString()} eggs on ${rowsOut.length} trolley(s).`);
    setShow(false);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Fumigation Records</h1>
          <p className="text-sm text-muted">Fumigate receptions before setting and track every run</p>
        </div>
        {canAdd && <Button onClick={() => openNew()}>＋ New Fumigation</Button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoSpray />} tone="blue" value={runs.length.toLocaleString()} label="Fumigation runs" />
        <StatCard icon={<IcoEgg />} tone="green" value={eggsFumigated.toLocaleString()} label="Eggs fumigated" />
        <StatCard icon={<IcoClock />} tone="gold" value={pendingRecs.length.toLocaleString()} label="Receptions pending" />
        <StatCard icon={<IcoEgg />} tone="gold" value={eggsPending.toLocaleString()} label="Eggs pending" />
        <StatCard icon={<IcoCheck />} tone="green" value={fullyFum.toLocaleString()} label="Fully fumigated" />
      </div>

      {/* Fumigation status per reception */}
      <Card>
        <h2 className="mb-3 text-[0.95rem] font-bold text-ink">Fumigation status</h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Farm</th>
              <th className={HG}>Flock</th>
              <th className={HG}>Product</th>
              <th className={`${HG} text-right`}>Settable</th>
              <th className={`${HG} text-right`}>Fumigated</th>
              <th className={`${HG} text-right`}>Not fumigated</th>
              <th className={HG}>Where</th>
              <th className={HG}>Status</th>
              {canAdd && <th className={`${HG} last:rounded-tr-lg text-right`}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {available.length === 0 ? (
              <EmptyRow colSpan={canAdd ? 9 : 8} text="No receptions to fumigate." />
            ) : available.map((r) => {
              const st = settableEggs(r); const fum = r.fumigatedEggs ?? 0; const left = Math.max(0, st - fum);
              const done = st > 0 && fum >= st;
              return (
                <tr key={r.id}>
                  <Td><div className="font-semibold text-ink">{r.farm}</div>{farmLoc(r.farm) && <div className="text-xs text-muted">{farmLoc(r.farm)}</div>}</Td>
                  <Td className="whitespace-nowrap font-medium">{r.flockId}</Td>
                  <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: r.productType === "Ross 308" ? "#1565c0" : "#b8860b" }} />{r.productType}</span></Td>
                  <Td className="text-right tabular-nums">{st.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums text-green">{fum.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{left.toLocaleString()}</Td>
                  <Td>{r.location === "store" ? <Pill tone="info">Store</Pill> : r.location === "ready" ? <Pill tone="gold">Ready</Pill> : <Pill tone="neutral">—</Pill>}</Td>
                  <Td>{done ? <Pill tone="green">Fumigated</Pill> : fum > 0 ? <Pill tone="gold">Partial</Pill> : <Pill tone="red">Pending</Pill>}</Td>
                  {canAdd && <Td className="text-right">{!done && <Button size="sm" onClick={() => openNew(r)}>Fumigate</Button>}</Td>}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {/* Fumigation runs */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[0.95rem] font-bold text-ink">Fumigation runs</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search farm, flock or chemicals…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Date</th>
              <th className={HG}>Reception</th>
              <th className={HG}>Chemicals</th>
              <th className={`${HG} text-right`}>Trolleys</th>
              <th className={`${HG} text-right`}>Eggs</th>
              <th className={HG}>Time</th>
              <th className={`${HG} last:rounded-tr-lg`}>By</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={7} text="No fumigation runs match." />
            ) : pageRows.map((r) => {
              const trolleyCount = Array.isArray(r.trolleys) ? r.trolleys.length : Number(r.trolleys) || 0;
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap">{formatDate(r.date)}</Td>
                  <Td className="whitespace-nowrap">{recLabel(r.receptionId)}</Td>
                  <Td>{r.chemicals}</Td>
                  <Td className="text-right tabular-nums">{trolleyCount}</Td>
                  <Td className="text-right tabular-nums">{(r.totalEggs ?? 0).toLocaleString()}</Td>
                  <Td className="whitespace-nowrap">{r.time}</Td>
                  <Td className="whitespace-nowrap text-xs text-muted">{r.by}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No runs" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} runs`}</span>
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

      {/* New fumigation modal */}
      <Modal open={show && canAdd} onClose={() => setShow(false)} title="Fumigate a reception" className="max-w-2xl">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Reception to fumigate">
            <Select value={receptionId} onChange={(e) => { setReceptionId(e.target.value); setErr(null); }}
              placeholder={available.length ? "Select reception" : "No available receptions"}
              options={available.map((r) => ({ value: r.id, label: `${r.farm} · ${r.flockId} · ${settableEggs(r).toLocaleString()} settable${(r.fumigatedEggs ?? 0) > 0 ? ` · ${r.fumigatedEggs} fumigated` : ""}` }))} />
          </Field>
          {reception && (
            <div className="flex flex-wrap gap-2 text-xs">
              <Pill tone="info">{settable.toLocaleString()} settable</Pill>
              <Pill tone={alreadyFum >= settable ? "green" : "gold"}>{alreadyFum.toLocaleString()} fumigated</Pill>
              <Pill tone="neutral">{Math.max(0, settable - alreadyFum).toLocaleString()} not fumigated</Pill>
              {reception.location === "store" && <Pill tone="info">in store room</Pill>}
            </div>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Chemicals used"><Input value={chemicals} onChange={(e) => setChemicals(e.target.value)} placeholder="e.g. Formaldehyde + KMnO₄" /></Field>
            <Field label="Time / duration"><Input value={time} onChange={(e) => setTime(e.target.value)} placeholder="e.g. 20 min / 08:30" /></Field>
            <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-ink">Trolleys</p>
              <Button size="sm" variant="ghost" onClick={addTrolley}>+ Add trolley</Button>
            </div>
            {trolleys.map((t, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <Field label={`Trolley ${i + 1}`}><Input value={t.label} onChange={(e) => setTrolleys(trolleys.map((x, j) => j === i ? { ...x, label: e.target.value } : x))} /></Field>
                <Field label="Eggs on trolley"><Input type="number" min={0} value={t.eggs} onChange={(e) => setTrolleys(trolleys.map((x, j) => j === i ? { ...x, eggs: e.target.value } : x))} /></Field>
                <Button size="sm" variant="ghost" onClick={() => removeTrolley(i)} disabled={trolleys.length === 1}>Remove</Button>
              </div>
            ))}
            <p className="text-sm">Total this run: <strong>{totalEggs.toLocaleString()}</strong> eggs across {trolleys.filter((t) => Number(t.eggs) > 0).length} trolley(s).</p>
          </div>
          {err && <p className="text-sm text-status-refunded">{err}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
            <Button type="submit">Save fumigation</Button>
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
const IcoSpray = () => fsvg(<><rect x="8" y="9" width="7" height="12" rx="1.5" /><path d="M8 9V6h4v3M14 5h2M14 8h2M17 4v5" /></>);
const IcoEgg = () => fsvg(<ellipse cx="12" cy="13" rx="6" ry="8" />);
const IcoClock = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoCheck = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M8.5 12l2.5 2.5 4.5-4.5" /></>);

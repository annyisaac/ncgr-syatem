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
import { ALL_TIME, inRange } from "@/components/ui/DateRange";

import { FarmsManager } from "@/components/hatchery/FarmsManager";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { PERIODS, presetToRange, type PeriodPreset } from "@/lib/period";
import { PRODUCTS } from "@/lib/types";
import type { Reception, ReceptionLocation } from "@/lib/hatchery/types";
import { settableEggs, remainingSettable } from "@/lib/hatchery/lifecycle";

const CAN_ADD = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];
const CAN_MANAGE_FARMS = ["Admin", "Hatchery Manager"];
const CAN_EDIT = ["Admin", "Hatchery Manager"];

const num = (v: string) => Number(v) || 0;
const crackedOf = (r: Reception) => r.crackedOnFarm + r.crackedOnSet;
function csvCell(v: string) { return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }

export default function ReceptionPage() {
  const { user } = useAuth();
  const { receptions, batches, farms, flocks, upsertReception, removeReception, newId } = useHatchery();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [showFarms, setShowFarms] = useState(false);
  const [editing, setEditing] = useState<Reception | null>(null);
  const [f, setF] = useState({
    flock: "", ageOfFlock: "", eggsReceived: "", ageOfEggs: "",
    crackedOnFarm: "", crackedOnSet: "", misshapen: "", dirty: "", date: todayISO(),
  });
  const [err, setErr] = useState<string | null>(null);

  // Filters + pagination
  const [q, setQ] = useState("");
  const [farmF, setFarmF] = useState("all");
  const [productF, setProductF] = useState("all");
  const [batchF, setBatchF] = useState("all");
  const [preset, setPreset] = useState<PeriodPreset>("all");
  const [page, setPage] = useState(1);
  const range = presetToRange(preset, ALL_TIME, todayISO());
  const [perPage, setPerPage] = useState(10);

  const canAdd = !!user && CAN_ADD.includes(user.role);
  const canEdit = !!user && CAN_EDIT.includes(user.role);
  const canManageFarms = !!user && CAN_MANAGE_FARMS.includes(user.role);
  const isAdmin = !!user && user.role === "Admin";

  const rows = useMemo(() => receptions.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), [receptions]);
  const batchNo = (id?: string) => (id ? batches.find((b) => b.id === id)?.batchNo ?? id : null);
  const farmName = (id: string) => farms.find((x) => x.id === id)?.name ?? "—";
  const farmLoc = (name: string) => farms.find((x) => x.name === name)?.location ?? "";

  const activeFlocks = useMemo(
    () => flocks
      .filter((x) => x.active && farms.find((fm) => fm.id === x.farmId)?.active !== false)
      .map((x) => ({ ...x, farmName: farmName(x.farmId) }))
      .sort((a, b) => (a.farmName === b.farmName ? a.code.localeCompare(b.code) : a.farmName.localeCompare(b.farmName))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [flocks, farms]
  );

  if (!user) return null;

  const farmOptions = [...new Set(rows.map((r) => r.farm))].sort();
  const batchOptions = [...new Set(rows.map((r) => batchNo(r.batchId)).filter(Boolean) as string[])].sort();

  // Filter the receptions.
  const s = q.trim().toLowerCase();
  const filtered = rows.filter((r) => {
    if (farmF !== "all" && r.farm !== farmF) return false;
    if (productF !== "all" && r.productType !== productF) return false;
    if (batchF !== "all" && (batchNo(r.batchId) ?? "") !== batchF) return false;
    if ((range.from || range.to) && !inRange(r.date, range)) return false;
    if (s && !(r.farm.toLowerCase().includes(s) || r.flockId.toLowerCase().includes(s) || r.productType.toLowerCase().includes(s) || (batchNo(r.batchId) ?? "").toLowerCase().includes(s))) return false;
    return true;
  });

  // Summary over the filtered set.
  const totalReceived = filtered.reduce((a, r) => a + r.eggsReceived, 0);
  const totalCracked = filtered.reduce((a, r) => a + crackedOf(r), 0);
  const totalDirty = filtered.reduce((a, r) => a + r.dirty, 0);
  const totalSettable = filtered.reduce((a, r) => a + settableEggs(r), 0);
  const avgSettablePct = totalReceived > 0 ? (totalSettable / totalReceived) * 100 : 0;

  // Pagination.
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  function resetForm() {
    setF({ flock: "", ageOfFlock: "", eggsReceived: "", ageOfEggs: "", crackedOnFarm: "", crackedOnSet: "", misshapen: "", dirty: "", date: todayISO() });
  }
  function openNew() { setEditing(null); resetForm(); setErr(null); setShowFarms(false); setShow(true); }
  function startEdit(r: Reception) {
    setEditing(r);
    setF({ flock: "", ageOfFlock: String(r.ageOfFlock), eggsReceived: String(r.eggsReceived), ageOfEggs: String(r.ageOfEggs), crackedOnFarm: String(r.crackedOnFarm), crackedOnSet: String(r.crackedOnSet), misshapen: String(r.misshapen), dirty: String(r.dirty), date: r.date });
    setErr(null); setShow(true);
  }
  function cancelForm() { setShow(false); setEditing(null); resetForm(); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (num(f.eggsReceived) <= 0) return setErr("Enter eggs received.");
    if (editing) {
      const rec: Reception = { ...editing, date: f.date, ageOfFlock: num(f.ageOfFlock), eggsReceived: num(f.eggsReceived), ageOfEggs: num(f.ageOfEggs), crackedOnFarm: num(f.crackedOnFarm), crackedOnSet: num(f.crackedOnSet), misshapen: num(f.misshapen), dirty: num(f.dirty) };
      upsertReception(rec);
      toast(`Updated reception — ${settableEggs(rec).toLocaleString()} settable.`);
      cancelForm();
      return;
    }
    const flock = flocks.find((x) => x.id === f.flock);
    if (!flock) return setErr("Select the flock.");
    const farm = farmName(flock.farmId);
    const rec: Reception = {
      id: newId("rec"), date: f.date, farm, flockId: flock.code, ageOfFlock: num(f.ageOfFlock),
      eggsReceived: num(f.eggsReceived), ageOfEggs: num(f.ageOfEggs), crackedOnFarm: num(f.crackedOnFarm),
      crackedOnSet: num(f.crackedOnSet), misshapen: num(f.misshapen), dirty: num(f.dirty),
      productType: flock.productType, by: user!.email, on: nowISO(),
    };
    upsertReception(rec);
    toast(`Received ${rec.eggsReceived} eggs from ${farm} — ${settableEggs(rec).toLocaleString()} settable.`);
    setShow(false); resetForm();
  }

  function setLocation(r: Reception, location: ReceptionLocation) {
    upsertReception({ ...r, location });
    toast(location === "store" ? "Sent to egg store room." : "Marked ready to set.");
  }
  function bringBack(r: Reception) {
    upsertReception({ ...r, location: undefined });
    toast(`${r.farm} · flock ${r.flockId} brought back to reception.`);
  }
  function deleteReception(r: Reception) {
    if (r.batchId || (r.eggsSet ?? 0) > 0) { toast("This reception is already set into a batch — delete that batch first.", "error"); return; }
    if (!confirm(`Delete the reception from ${r.farm} · Flock ${r.flockId} (${r.eggsReceived.toLocaleString()} eggs, ${formatDate(r.date)})?\n\nThis cannot be undone.`)) return;
    void removeReception(r.id);
    toast("Reception deleted.");
  }

  function exportCsv() {
    const header = ["Date", "Farm", "Location", "Flock", "Product", "Received", "Cracked", "Misshapen", "Dirty", "Settable", "Where", "Batch"];
    const body = filtered.map((r) => [
      formatDate(r.date), r.farm, farmLoc(r.farm), r.flockId, r.productType,
      String(r.eggsReceived), String(crackedOf(r)), String(r.misshapen), String(r.dirty), String(settableEggs(r)),
      r.batchId ? "Set" : r.location ?? "Pending", batchNo(r.batchId) ?? "",
    ]);
    const blob = new Blob([[header, ...body].map((row) => row.map(csvCell).join(",")).join("\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `receptions-${todayISO()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }

  const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Reception Records</h1>
          <p className="text-sm text-muted">Track all egg receptions from farms and flocks</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManageFarms && (
            <Button variant="secondary" onClick={() => { setShow(false); setShowFarms(true); }}>Manage farms & flocks</Button>
          )}
          {canAdd && <Button onClick={openNew}>＋ New Reception</Button>}
        </div>
      </div>

      <Modal open={showFarms && canManageFarms} onClose={() => setShowFarms(false)} title="Farms & flocks" className="max-w-4xl">
        <FarmsManager />
      </Modal>

      <Modal open={show && canAdd} onClose={cancelForm} title={editing ? "Edit reception" : "Receive eggs from farm"} className="max-w-3xl">
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Farm · Flock (product)">
              {editing ? (
                <div className="rounded-[9px] border border-line bg-grey-bg px-3.5 py-2.5 text-[0.9rem] text-ink">{editing.farm} · {editing.flockId} · {editing.productType}</div>
              ) : (
                <Select value={f.flock} onChange={(e) => setF({ ...f, flock: e.target.value })} placeholder={activeFlocks.length ? "Select flock" : "No flocks defined"} options={activeFlocks.map((x) => ({ value: x.id, label: `${x.farmName} · ${x.code} · ${x.productType}` }))} />
              )}
            </Field>
            <Field label="Age of flock (weeks)"><Input type="number" value={f.ageOfFlock} onChange={(e) => setF({ ...f, ageOfFlock: e.target.value })} /></Field>
            <Field label="Eggs received"><Input type="number" value={f.eggsReceived} onChange={(e) => setF({ ...f, eggsReceived: e.target.value })} /></Field>
            <Field label="Age of eggs (days)"><Input type="number" value={f.ageOfEggs} onChange={(e) => setF({ ...f, ageOfEggs: e.target.value })} /></Field>
            <Field label="Cracked on farm"><Input type="number" value={f.crackedOnFarm} onChange={(e) => setF({ ...f, crackedOnFarm: e.target.value })} /></Field>
            <Field label="Cracked on set"><Input type="number" value={f.crackedOnSet} onChange={(e) => setF({ ...f, crackedOnSet: e.target.value })} /></Field>
            <Field label="Misshapen eggs"><Input type="number" value={f.misshapen} onChange={(e) => setF({ ...f, misshapen: e.target.value })} /></Field>
            <Field label="Dirty eggs"><Input type="number" value={f.dirty} onChange={(e) => setF({ ...f, dirty: e.target.value })} /></Field>
            <Field label="Date received"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <div className="sm:col-span-3 rounded-md border border-line bg-cream/40 px-3 py-3 text-center">
              <p className="text-xs text-muted">Settable eggs</p>
              <p className="text-2xl font-bold text-green">{Math.max(0, num(f.eggsReceived) - num(f.crackedOnFarm) - num(f.crackedOnSet) - num(f.misshapen) - num(f.dirty)).toLocaleString()}</p>
            </div>
            {err && <p className="sm:col-span-3 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-3 flex justify-end gap-2">
              <Button variant="ghost" onClick={cancelForm}>Cancel</Button>
              <Button type="submit">{editing ? "Update reception" : "Save reception"}</Button>
            </div>
        </form>
      </Modal>

      {/* Summary */}
      <Card>
        <p className="mb-3 flex items-center gap-2 text-[0.68rem] font-bold uppercase tracking-[0.09em] text-muted">
          <IcoLock />Reception summary
        </p>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <SummaryStat icon={<IcoDoc />} tone="green" value={total.toLocaleString()} label="Total Receptions" />
          <SummaryStat icon={<IcoEgg />} tone="gold" value={totalReceived.toLocaleString()} label="Total Eggs Received" />
          <SummaryStat icon={<IcoCrack />} tone="red" value={totalCracked.toLocaleString()} label="Total Cracked" />
          <SummaryStat icon={<IcoDrop />} tone="gold" value={totalDirty.toLocaleString()} label="Total Dirty" />
          <SummaryStat icon={<IcoBox />} tone="green" value={totalSettable.toLocaleString()} label="Total Settable" />
          <SummaryStat icon={<IcoCheck />} tone="green" value={`${avgSettablePct.toFixed(1)}%`} label="Avg Settable %" />
        </div>
      </Card>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[200px] flex-1">
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
          <Input className="pl-9" placeholder="Search by farm, flock, batch or product…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
        </div>
        <div className="w-36"><Select value={preset} onChange={(e) => { setPreset(e.target.value as PeriodPreset); setPage(1); }} options={PERIODS.filter((p) => p.value !== "custom").map((p) => ({ value: p.value, label: p.label }))} /></div>
        <div className="w-40"><Select value={farmF} onChange={(e) => { setFarmF(e.target.value); setPage(1); }} options={[{ value: "all", label: "All Farms" }, ...farmOptions.map((n) => ({ value: n, label: n }))]} /></div>
        <div className="w-40"><Select value={productF} onChange={(e) => { setProductF(e.target.value); setPage(1); }} options={[{ value: "all", label: "All Products" }, ...PRODUCTS.map((p) => ({ value: p, label: p }))]} /></div>
        <div className="w-40"><Select value={batchF} onChange={(e) => { setBatchF(e.target.value); setPage(1); }} options={[{ value: "all", label: "All Batches" }, ...batchOptions.map((b) => ({ value: b, label: b }))]} /></div>
        <Button variant="secondary" size="sm" onClick={exportCsv}>⭳ Export</Button>
      </div>

      {/* Table */}
      <Card>
        <TableWrap>
          <thead>
            <tr>
              <th rowSpan={2} className={`${HG} first:rounded-tl-lg`}>Date</th>
              <th rowSpan={2} className={HG}>Farm</th>
              <th rowSpan={2} className={HG}>Flock</th>
              <th rowSpan={2} className={HG}>Product</th>
              <th colSpan={4} className={`${HG} border-l border-white/15 text-center`}>Eggs received</th>
              <th rowSpan={2} className={`${HG} border-l border-white/15 text-right`}>Settable</th>
              <th rowSpan={2} className={HG}>Where</th>
              <th rowSpan={2} className={HG}>Batch</th>
              {canEdit && <th rowSpan={2} className={`${HG} last:rounded-tr-lg text-right`}>Actions</th>}
            </tr>
            <tr>
              <th className={`${HG} border-l border-white/15 text-right`}>Received</th>
              <th className={`${HG} text-right`}>Cracked</th>
              <th className={`${HG} text-right`}>Misshapen</th>
              <th className={`${HG} text-right`}>Dirty</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={canEdit ? 12 : 11} text="No receptions match these filters." />
            ) : pageRows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap">{formatDate(r.date)}</Td>
                <Td><div className="font-semibold text-ink">{r.farm}</div>{farmLoc(r.farm) && <div className="text-xs text-muted">{farmLoc(r.farm)}</div>}</Td>
                <Td className="whitespace-nowrap font-medium">{r.flockId}</Td>
                <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: r.productType === "Ross 308" ? "#1565c0" : "#b8860b" }} />{r.productType}</span></Td>
                <Td className="text-right tabular-nums">{r.eggsReceived.toLocaleString()}</Td>
                <Td className="text-right tabular-nums text-red">{crackedOf(r).toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{r.misshapen.toLocaleString()}</Td>
                <Td className="text-right tabular-nums text-gold-dark">{r.dirty.toLocaleString()}</Td>
                <Td className="text-right font-semibold tabular-nums text-green">
                  {settableEggs(r).toLocaleString()}
                  {(r.eggsSet ?? 0) > 0 && remainingSettable(r) > 0 && <div className="text-[11px] font-normal text-gold-dark">{(r.eggsSet ?? 0).toLocaleString()} set · {remainingSettable(r).toLocaleString()} left</div>}
                </Td>
                <Td>
                  {r.batchId ? (
                    <Pill tone="green">Set</Pill>
                  ) : (r.eggsSet ?? 0) > 0 && r.location === "ready" ? (
                    <div className="flex flex-wrap items-center gap-1"><Pill tone="gold">Partly set · {remainingSettable(r).toLocaleString()} left</Pill>{isAdmin && <Button size="sm" variant="ghost" onClick={() => bringBack(r)}>Bring back</Button>}</div>
                  ) : r.location === "store" ? (
                    <div className="flex flex-wrap items-center gap-1"><Pill tone="info">Store room</Pill>{isAdmin && <Button size="sm" variant="ghost" onClick={() => bringBack(r)}>Bring back</Button>}</div>
                  ) : r.location === "ready" ? (
                    <div className="flex flex-wrap items-center gap-1"><Pill tone="gold">Ready to set</Pill>{isAdmin && <Button size="sm" variant="ghost" onClick={() => bringBack(r)}>Bring back</Button>}</div>
                  ) : canAdd ? (
                    <div className="flex flex-wrap gap-1"><Button size="sm" variant="ghost" onClick={() => setLocation(r, "store")}>Store</Button><Button size="sm" onClick={() => setLocation(r, "ready")}>Ready to set</Button></div>
                  ) : (
                    <Pill tone="neutral">Pending</Pill>
                  )}
                </Td>
                <Td className="whitespace-nowrap">{r.batchId ? <Pill tone="gold" className="whitespace-nowrap">{batchNo(r.batchId)}</Pill> : <span className="text-muted">—</span>}</Td>
                {canEdit && (
                  <Td className="text-right">
                    <div className="flex flex-wrap justify-end gap-1">
                      <Button size="sm" variant="ghost" onClick={() => startEdit(r)}>Edit</Button>
                      {isAdmin && <Button size="sm" variant="ghost" className="text-red hover:border-red" onClick={() => deleteReception(r)}>Delete</Button>}
                    </div>
                  </Td>
                )}
              </tr>
            ))}
          </tbody>
        </TableWrap>

        {/* Pagination */}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No receptions" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} receptions`}</span>
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
    </div>
  );
}

// ---- summary stat + icons -------------------------------------------------

type Tone = "green" | "gold" | "red" | "blue" | "default";
const CHIP: Record<Tone, string> = {
  green: "bg-green-bg text-green", gold: "bg-gold-bg text-gold-dark", red: "bg-red-bg text-red", blue: "bg-blue-bg text-blue", default: "bg-grey-bg text-ink",
};
function SummaryStat({ icon, value, label, tone = "default" }: { icon: ReactNode; value: string; label: string; tone?: Tone }) {
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

const rsvg = (children: ReactNode) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">{children}</svg>
);
const IcoLock = () => <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="text-gold-dark"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>;
const IcoDoc = () => rsvg(<><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M4 9h16M9 4v16" /></>);
const IcoEgg = () => rsvg(<ellipse cx="12" cy="13" rx="6" ry="8" />);
const IcoCrack = () => rsvg(<><ellipse cx="12" cy="13" rx="6" ry="8" /><path d="M10 6l2 4-2 2 3 2" /></>);
const IcoDrop = () => rsvg(<path d="M12 3s6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 6-10 6-10Z" />);
const IcoBox = () => rsvg(<><path d="M4 8l8-4 8 4-8 4-8-4Z" /><path d="M4 8v8l8 4 8-4V8" /></>);
const IcoCheck = () => rsvg(<><circle cx="12" cy="12" r="8" /><path d="M8.5 12l2.5 2.5 4.5-4.5" /></>);

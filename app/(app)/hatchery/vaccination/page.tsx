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
import type { Batch, Supply, Vaccination } from "@/lib/hatchery/types";
import { markStep } from "@/lib/hatchery/lifecycle";

const CAN_VAX = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician", "Hatchery Attendant", "Hatchery Veterinary"];
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

export default function VaccinationPage() {
  const { user } = useAuth();
  const { batches, supplies, vaccinations, inventory, upsertBatch, upsertVaccination, upsertSupply, upsertInventory, newId } = useHatchery();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [batchId, setBatchId] = useState("");
  const [vaccineId, setVaccineId] = useState("");
  const [doses, setDoses] = useState("");
  const [date, setDate] = useState(todayISO());
  const [vaxCulls, setVaxCulls] = useState(""); // culls removed during vaccination (batch total)
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const canVax = !!user && CAN_VAX.includes(user.role);
  const vaccineSupplies = useMemo(() => supplies.filter((s) => s.kind === "vaccine"), [supplies]);

  const hatched = useMemo(() => batches.filter((b) => b.steps["hatching"]), [batches]);
  const batch = hatched.find((b) => b.id === batchId) ?? null;
  const vaccine = vaccineSupplies.find((s) => s.id === vaccineId) ?? null;
  const dosesN = Number(doses) || 0;

  const vaxCullsN = Number(vaxCulls) || 0;
  const finalSaleable = batch ? Math.max(0, batch.saleableCount - vaxCullsN) : 0;

  const rows = useMemo(() => vaccinations.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [vaccinations]);
  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;

  // Every vaccine a batch has received (newest first) — a batch can get several.
  const vaxByBatch = useMemo(() => {
    const m = new Map<string, Vaccination[]>();
    for (const v of rows) { const a = m.get(v.batchId) ?? []; a.push(v); m.set(v.batchId, a); }
    return m;
  }, [rows]);

  // Summary.
  const dosesGiven = rows.reduce((s, v) => s + (v.doses ?? 0), 0);
  const vaccinatedBatches = hatched.filter((b) => b.vaccinated).length;
  const awaiting = hatched.filter((b) => !b.vaccinated).length;
  const dosesInStock = vaccineSupplies.reduce((s, v) => s + (v.quantity ?? 0), 0);

  // Filtered + paginated log.
  const s = q.trim().toLowerCase();
  const filtered = rows.filter((v) => !s || batchNo(v.batchId).toLowerCase().includes(s) || (v.vaccine ?? "").toLowerCase().includes(s) || (v.administeredBy ?? "").toLowerCase().includes(s));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

  if (!user) return null;

  function openNew(b?: Batch) {
    setBatchId(b?.id ?? "");
    setVaccineId(""); setDoses(""); setDate(todayISO()); setVaxCulls(""); setErr(null);
    setShow(true);
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!batch) return setErr("Select a hatched batch.");
    if (!vaccine) return setErr("Select a vaccine.");
    if (dosesN <= 0) return setErr("Enter the number of doses.");
    if (dosesN > vaccine.quantity) return setErr(`Only ${vaccine.quantity} doses of ${vaccine.name} in stock.`);
    if (vaxCullsN > batch.saleableCount) return setErr(`Culls (${vaxCullsN}) can't exceed the ${batch.saleableCount.toLocaleString()} saleable.`);
    const on = nowISO();

    // Vaccination record + deduct vaccine stock.
    const rec: Vaccination = { id: newId("vax"), batchId: batch.id, vaccine: vaccine.name, doses: dosesN, date, administeredBy: user!.name, on };
    upsertVaccination(rec);
    const sup: Supply = { ...vaccine, quantity: vaccine.quantity - dosesN, history: [...vaccine.history, `${on} — ${dosesN} doses to ${batch.batchNo} by ${user!.name}`], on };
    upsertSupply(sup);

    // Final saleable = counted saleable − culls removed at vaccination.
    const saleableTot = Math.max(0, batch.saleableCount - vaxCullsN);
    const cullsTot = (batch.culls ?? 0) + vaxCullsN;
    let nb: Batch = { ...batch, vaccinated: true, saleableCount: saleableTot, culls: cullsTot };
    if (!nb.steps["vaccination"]) nb = markStep(nb, "vaccination", user!);
    upsertBatch(nb);

    // Update chick inventory to the post-vaccination saleable.
    const inv = inventory.find((i) => i.batchId === batch.id);
    upsertInventory(
      inv
        ? { ...inv, availableCount: saleableTot, updatedBy: user!.email, on }
        : { id: newId("inv"), productType: batch.productType, hatchDate: todayISO(), availableCount: saleableTot, batchId: batch.id, updatedBy: user!.email, on }
    );

    toast(`${dosesN} doses of ${vaccine.name} given to ${batch.batchNo} — final saleable ${saleableTot.toLocaleString()}.`);
    setDoses(""); setVaxCulls("");
    setShow(false);
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Vaccination</h1>
          <p className="text-sm text-muted">Give hatched batches their vaccines — a batch can receive several — and record any culls to finalise saleable chicks</p>
        </div>
        {canVax && <Button onClick={() => openNew()}>＋ New Vaccination</Button>}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoSyringe />} tone="blue" value={rows.length.toLocaleString()} label="Vaccinations logged" />
        <StatCard icon={<IcoDose />} tone="green" value={dosesGiven.toLocaleString()} label="Doses given" />
        <StatCard icon={<IcoCheck />} tone="green" value={vaccinatedBatches.toLocaleString()} label="Batches vaccinated" />
        <StatCard icon={<IcoClock />} tone="gold" value={awaiting.toLocaleString()} label="Awaiting vaccination" />
        <StatCard icon={<IcoVial />} tone={dosesInStock > 0 ? "blue" : "red"} value={dosesInStock.toLocaleString()} label="Doses in stock" />
      </div>

      {/* Vaccination status per hatched batch */}
      <Card>
        <h2 className="mb-3 text-[0.95rem] font-bold text-ink">Vaccination status</h2>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Batch</th>
              <th className={HG}>Product</th>
              <th className={`${HG} text-right`}>Saleable</th>
              <th className={HG}>Vaccines given</th>
              {canVax && <th className={`${HG} last:rounded-tr-lg text-right`}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {hatched.length === 0 ? (
              <EmptyRow colSpan={canVax ? 5 : 4} text="No hatched batches available to vaccinate." />
            ) : hatched.map((b) => {
              const given = vaxByBatch.get(b.id) ?? [];
              return (
                <tr key={b.id}>
                  <Td className="whitespace-nowrap font-semibold text-ink">{b.batchNo}</Td>
                  <Td><span className="inline-flex items-center gap-1.5 whitespace-nowrap"><span className="h-2 w-2 rounded-full" style={{ background: b.productType === "Ross 308" ? "#1565c0" : "#b8860b" }} />{b.productType}</span></Td>
                  <Td className="text-right tabular-nums">{b.saleableCount.toLocaleString()}</Td>
                  <Td>
                    {given.length === 0 ? (
                      <Pill tone="gold">None yet</Pill>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {given.map((v) => (
                          <span key={v.id} title={`${formatDate(v.date)} · ${v.administeredBy}`} className="rounded-full bg-green-bg px-2 py-0.5 text-[0.7rem] font-medium text-green">{v.vaccine} · {v.doses.toLocaleString()}</span>
                        ))}
                      </div>
                    )}
                  </Td>
                  {canVax && <Td className="text-right"><Button size="sm" variant={given.length ? "ghost" : "primary"} onClick={() => openNew(b)}>{given.length ? "＋ Add vaccine" : "Vaccinate"}</Button></Td>}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {/* Vaccination log */}
      <Card>
        <div className="sticky top-16 z-20 -mx-5 -mt-5 mb-3 flex flex-wrap items-center justify-between gap-2 rounded-t-2xl border-b border-line bg-paper/95 px-5 pb-3 pt-5 backdrop-blur">
          <h2 className="text-[0.95rem] font-bold text-ink">Vaccination log</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search batch, vaccine or person…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Date</th>
              <th className={HG}>Batch</th>
              <th className={HG}>Vaccine</th>
              <th className={`${HG} text-right`}>Doses</th>
              <th className={`${HG} last:rounded-tr-lg`}>By</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={5} text="No vaccinations match." />
            ) : pageRows.map((v) => (
              <tr key={v.id}>
                <Td className="whitespace-nowrap">{formatDate(v.date)}</Td>
                <Td className="whitespace-nowrap">{batchNo(v.batchId)}</Td>
                <Td>{v.vaccine}</Td>
                <Td className="text-right tabular-nums">{v.doses.toLocaleString()}</Td>
                <Td className="whitespace-nowrap text-xs text-muted">{v.administeredBy}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No vaccinations" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} vaccinations`}</span>
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

      {/* New vaccination modal */}
      <Modal open={show && canVax} onClose={() => setShow(false)} title="Record vaccination" className="max-w-2xl">
        {hatched.length === 0 ? (
          <p className="text-sm text-muted">No hatched batches available to vaccinate.</p>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Hatched batch">
                <Select value={batchId} onChange={(e) => { setBatchId(e.target.value); setVaxCulls(""); setErr(null); }} placeholder="Select batch"
                  options={hatched.map((b) => ({ value: b.id, label: `${b.batchNo} · ${b.saleableCount.toLocaleString()} saleable${b.vaccinated ? " · vaccinated" : ""}` }))} />
              </Field>
              <Field label="Vaccine (from inventory)">
                <Select value={vaccineId} onChange={(e) => setVaccineId(e.target.value)}
                  placeholder={vaccineSupplies.length ? "Select vaccine" : "No vaccines in inventory"}
                  options={vaccineSupplies.map((sp) => ({ value: sp.id, label: `${sp.name} (${sp.quantity} ${sp.unit})` }))} />
              </Field>
              <Field label="Doses"><Input type="number" min={0} value={doses} onChange={(e) => setDoses(e.target.value)} /></Field>
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            </div>

            {batch && (
              <div className="space-y-2 rounded-lg border border-line p-3">
                <p className="text-sm font-semibold text-ink">Culls removed this session <span className="font-normal text-muted">(optional — leave 0 if none)</span></p>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label={`Culls (of ${batch.saleableCount.toLocaleString()} saleable)`}>
                    <Input type="number" min={0} value={vaxCulls} onChange={(e) => setVaxCulls(e.target.value)} />
                  </Field>
                  <div className="flex items-end">
                    <p className="text-sm">Final saleable (batch): <strong className="text-green">{finalSaleable.toLocaleString()}</strong></p>
                  </div>
                </div>
              </div>
            )}

            {err && <p className="text-sm text-status-refunded">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
              <Button type="submit">Save vaccination</Button>
            </div>
          </form>
        )}
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
const IcoSyringe = () => fsvg(<><path d="M4 20l2-2M17 3l4 4M14 6l4 4M15 5l-9 9v4h4l9-9M10 10l2 2" /></>);
const IcoDose = () => fsvg(<><path d="M9 3h6M10 3v5l-4 8a2 2 0 0 0 2 3h8a2 2 0 0 0 2-3l-4-8V3" /><path d="M8 14h8" /></>);
const IcoCheck = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M8.5 12l2.5 2.5 4.5-4.5" /></>);
const IcoClock = () => fsvg(<><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>);
const IcoVial = () => fsvg(<><path d="M7 3h10M9 3v13a3 3 0 0 0 6 0V3" /><path d="M9 9h6" /></>);

"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { nowISO, formatDateTime } from "@/lib/format";
import type { Machine, MachineReading, MachineType, TurnDirection } from "@/lib/hatchery/types";
import { MAX_MACHINE_TEMP_F } from "@/lib/hatchery/types";
import { eggsInMachine, isMachineOverTemp } from "@/lib/hatchery/lifecycle";

const CAN_MANAGE = ["Admin", "Hatchery Manager"];
const CAN_RECORD = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Attendant", "Maintenance Technician", "Production Technician"];

type TypeFilter = "all" | MachineType;

export default function MachinesPage() {
  const { user } = useAuth();
  const { machines, operators, batches, readings, upsertMachine, upsertReading, newId } = useHatchery();
  const { operator: sessionOp } = useOperator();
  const { toast } = useToast();

  // Attendants only see active (in-use) machines; everyone else sees all,
  // including deactivated ones, and can filter down if they want.
  const isAttendant = user?.role === "Hatchery Attendant";

  const [query, setQuery] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [activeOnly, setActiveOnly] = useState(false);

  // Add machine
  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState<MachineType>("setter");
  const [capacity, setCapacity] = useState("");
  const [cErr, setCErr] = useState<string | null>(null);

  // Record reading
  const [showRecord, setShowRecord] = useState(false);
  const [r, setR] = useState({ machineCode: "", fanSpeed: "", dryF: "", wetF: "", digitalTempF: "", digitalHumidityF: "", turning: "" as "" | TurnDirection, operatorId: "", operatorCode: "", comment: "" });
  const [rErr, setRErr] = useState<string | null>(null);

  // Edit machine
  const [editM, setEditM] = useState<Machine | null>(null);
  const [ef, setEf] = useState({ code: "", capacity: "", type: "setter" as MachineType, active: true });
  const [eErr, setEErr] = useState<string | null>(null);

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const canRecord = !!user && CAN_RECORD.includes(user.role);
  // Attendants only record readings — they don't drill into machine detail/graphs.
  const canViewDetail = !!user && user.role !== "Hatchery Attendant";
  const activeOps = useMemo(() => operators.filter((o) => o.active), [operators]);

  const latestByMachine = useMemo(() => {
    const m = new Map<string, MachineReading>();
    for (const rd of readings) {
      const cur = m.get(rd.machineCode);
      if (!cur || cur.timestamp < rd.timestamp) m.set(rd.machineCode, rd);
    }
    return m;
  }, [readings]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return machines
      .filter((m) => (typeFilter === "all" ? true : m.type === typeFilter))
      .filter((m) => (activeOnly || isAttendant ? m.active : true))
      .filter((m) => {
        if (!q) return true;
        const op = latestByMachine.get(m.code)?.operator ?? "";
        return m.code.toLowerCase().includes(q) || op.toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [machines, typeFilter, activeOnly, isAttendant, query, latestByMachine]);

  const selectedReadings = useMemo(
    () => (r.machineCode ? readings.filter((rd) => rd.machineCode === r.machineCode).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 5) : []),
    [readings, r.machineCode]
  );

  const lastTurnOf = (mcode: string): TurnDirection | undefined =>
    readings.filter((rd) => rd.machineCode === mcode && rd.turning).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))[0]?.turning;
  const opposite = (t?: TurnDirection): "" | TurnDirection => (t === "left" ? "right" : t === "right" ? "left" : "");

  const machineInUse = (mcode: string) =>
    readings.some((rd) => rd.machineCode === mcode) ||
    batches.some((b) =>
      (b.setters ?? []).some((s) => s.machineCode === mcode) ||
      (b.transfers ?? []).some((t) => t.machineCode === mcode) ||
      (b.flocks ?? []).some((fl) => (fl.transfers ?? []).some((t) => t.machineCode === mcode))
    );

  if (!user) return null;

  function createMachine(e?: React.FormEvent) {
    e?.preventDefault();
    setCErr(null);
    const cap = Number(capacity) || 0;
    if (!code.trim()) return setCErr("Enter the machine code (e.g. S01 / H01).");
    if (machines.some((m) => m.code.toLowerCase() === code.trim().toLowerCase())) return setCErr("A machine with that code exists.");
    if (cap <= 0) return setCErr("Enter the capacity (eggs).");
    // A new machine holds no eggs yet, so it starts inactive; setting eggs into
    // it (or a manual toggle) activates it.
    const m: Machine = { id: newId("mac"), code: code.trim().toUpperCase(), type, capacity: cap, active: false, by: user!.email, on: nowISO() };
    upsertMachine(m);
    toast(`Machine ${m.code} created.`);
    setShowCreate(false); setCode(""); setCapacity("");
  }

  function openEdit(m: Machine) {
    setEditM(m);
    setEf({ code: m.code, capacity: String(m.capacity), type: m.type, active: m.active });
    setEErr(null);
  }

  function saveEdit() {
    if (!editM) return;
    setEErr(null);
    const newCode = ef.code.trim().toUpperCase();
    const cap = Number(ef.capacity) || 0;
    if (!newCode) return setEErr("Enter the machine code.");
    if (cap <= 0) return setEErr("Enter the capacity (eggs).");
    const codeChanged = newCode !== editM.code.toUpperCase();
    if (codeChanged) {
      if (machines.some((m) => m.id !== editM.id && m.code.toUpperCase() === newCode)) return setEErr("Another machine already uses that code.");
      if (machineInUse(editM.code)) return setEErr("This machine is already in use (readings or batch assignments) — its code can't be changed. Capacity, type and status can still be updated.");
    }
    upsertMachine({ ...editM, code: newCode, capacity: cap, type: ef.type, active: ef.active, on: nowISO() });
    toast(`Machine ${newCode} updated.`);
    setEditM(null);
  }

  function toggleActive(m: Machine) {
    if (m.active) {
      const held = eggsInMachine(batches, m.code, m.type === "setter" ? "setters" : "transfers");
      if (held > 0 && !window.confirm(
        `${m.code} still holds ${held.toLocaleString()} eggs. Deactivating removes it from the pool for new sets/transfers and from the reading list, but its current eggs stay put. Continue?`
      )) return;
    }
    upsertMachine({ ...m, active: !m.active, on: nowISO() });
    toast(`Machine ${m.code} ${m.active ? "deactivated" : "activated"}.`);
  }

  function recordReading(e?: React.FormEvent) {
    e?.preventDefault();
    setRErr(null);
    if (!r.machineCode) return setRErr("Select a machine.");
    const op = sessionOp ?? activeOps.find((o) => o.id === r.operatorId);
    if (!op) return setRErr("Select the operator.");
    if (!sessionOp && r.operatorCode.trim().toUpperCase() !== op.code) return setRErr("Operator code does not match — enter your own code.");
    const dry = Number(r.dryF), wet = Number(r.wetF), dig = Number(r.digitalTempF), hum = Number(r.digitalHumidityF);
    if (isMachineOverTemp(dry, wet, dig)) return setRErr(`Temperature cannot exceed ${MAX_MACHINE_TEMP_F}°F.`);
    const reading: MachineReading = {
      id: newId("read"), machineCode: r.machineCode, timestamp: nowISO(),
      fanSpeed: Number(r.fanSpeed) || 0, dryF: dry, wetF: wet, digitalTempF: dig, digitalHumidityF: hum,
      turning: r.turning || undefined,
      operator: op.name, operatorCode: op.code, comment: r.comment.trim() || undefined, recordedBy: user!.email,
    };
    upsertReading(reading);
    toast(`Reading recorded for ${r.machineCode} by ${op.name}${r.turning ? ` — turned ${r.turning}` : ""}.`);
    setR({ ...r, fanSpeed: "", dryF: "", wetF: "", digitalTempF: "", digitalHumidityF: "", turning: "", comment: "" });
    setShowRecord(false);
  }

  // Pre-fill the turning with the opposite of the machine's last recorded turn.
  function openRecord(machineCode = "") {
    setR((prev) => ({ ...prev, machineCode, turning: machineCode ? opposite(lastTurnOf(machineCode)) : "" }));
    setRErr(null);
    setShowRecord(true);
  }

  return (
    <div className="space-y-5 pb-24">
      <div className="flex flex-wrap items-center justify-between gap-2">
      </div>

      {/* Search + filter */}
      <div className="flex items-center gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by machine code, operator…"
          className="min-w-0 grow rounded-xl border border-line bg-paper px-3.5 py-2.5 text-sm outline-none focus:border-gold"
        />
        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-label="Filters"
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${showFilters || typeFilter !== "all" || activeOnly ? "border-gold bg-gold-bg/40 text-gold-dark" : "border-line bg-paper text-muted"}`}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        </button>
      </div>

      {showFilters && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-cream/30 p-3 text-sm">
          {(["all", "setter", "hatcher"] as TypeFilter[]).map((t) => (
            <button key={t} onClick={() => setTypeFilter(t)}
              className={`rounded-full px-3 py-1 capitalize ${typeFilter === t ? "bg-gold text-[#231b04]" : "border border-line bg-paper text-muted"}`}>
              {t === "all" ? "All types" : `${t}s`}
            </button>
          ))}
          {!isAttendant && (
            <label className="ml-2 flex items-center gap-2 text-muted">
              <input type="checkbox" checked={activeOnly} onChange={(e) => setActiveOnly(e.target.checked)} /> Active only
            </label>
          )}
        </div>
      )}

      {/* Card grid */}
      {visible.length === 0 ? (
        <div className="rounded-xl border border-line bg-paper p-6 text-center text-sm text-muted">
          {machines.length === 0 ? "No machines yet." : "No machines match your search."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {visible.map((m) => {
            const rd = latestByMachine.get(m.code);
            const used = eggsInMachine(batches, m.code, m.type === "setter" ? "setters" : "transfers");
            const hot = rd ? isMachineOverTemp(rd.dryF, rd.wetF, rd.digitalTempF) : false;
            return (
              <div key={m.id} className={`rounded-2xl border bg-paper p-4 ${hot ? "border-red/40" : "border-line"}`}>
                <div className="flex items-start justify-between gap-2">
                  <span className={`rounded-md px-2 py-0.5 text-[0.6rem] font-bold uppercase tracking-wide ${m.type === "hatcher" ? "bg-gold-bg text-gold-dark" : "bg-blue-bg text-blue"}`}>
                    {m.type}
                  </span>
                  <span className="text-[0.7rem] text-muted">{rd ? formatDateTime(rd.timestamp) : "no readings"}</span>
                </div>

                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h2 className="text-lg font-bold text-ink">{m.code}</h2>
                    <span className={`rounded-full px-2 py-0.5 text-[0.6rem] font-semibold ${m.active ? "bg-green-bg text-green" : "bg-grey-bg text-muted"}`}>
                      {m.active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  {canManage && (
                    <button
                      onClick={() => toggleActive(m)}
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${m.active ? "bg-red-bg text-red" : "bg-green-bg text-green"}`}
                    >
                      {m.active ? "Deactivate" : "Activate"}
                    </button>
                  )}
                </div>
                <p className="text-[0.72rem] text-muted">cap {m.capacity.toLocaleString()} · free {(m.capacity - used).toLocaleString()}</p>

                <div className="mt-3 grid grid-cols-3 gap-2">
                  <Stat label="Dry Temp" value={rd ? `${rd.dryF}°F` : "—"} />
                  <Stat label="Wet Temp" value={rd ? `${rd.wetF}°F` : "—"} />
                  <Stat label="Dig. Temp" value={rd ? `${rd.digitalTempF}°F` : "—"} hot={hot} />
                  <Stat label="Humidity" value={rd ? `${rd.digitalHumidityF}%` : "—"} />
                  <Stat label="Fan Speed" value={rd ? `${rd.fanSpeed} RPM` : "—"} />
                  <Stat label="Last turn" value={lastTurnOf(m.code) ? (lastTurnOf(m.code) === "left" ? "◄ Left" : "Right ►") : "—"} />
                </div>

                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="truncate text-sm text-muted">Operator: <span className="text-ink">{rd?.operator ?? "—"}</span></span>
                  <div className="flex shrink-0 items-center gap-2">
                    {canManage && <button onClick={() => openEdit(m)} className="text-xs text-gold-dark underline">Edit</button>}
                    {canViewDetail && <Link href={`/hatchery/machines/${encodeURIComponent(m.code)}`} className="text-sm font-semibold text-gold-dark">View Details →</Link>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Floating actions */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">
        {canManage && (
          <Button variant="secondary" onClick={() => { setShowCreate(true); setCErr(null); }} className="shadow-pop">+ Add machine</Button>
        )}
        {canRecord && machines.length > 0 && (
          <Button onClick={() => openRecord()} className="shadow-pop">+ Record reading</Button>
        )}
      </div>

      {/* Add machine modal */}
      <Modal
        open={showCreate}
        onClose={() => setShowCreate(false)}
        title="Add machine"
        footer={<><Button variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button><Button onClick={() => createMachine()}>Save machine</Button></>}
      >
        <form onSubmit={createMachine} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Code" hint="Setters S01, hatchers H01"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
          <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as MachineType)} options={[{ value: "setter", label: "Setter" }, { value: "hatcher", label: "Hatcher" }]} /></Field>
          <Field label="Capacity (eggs)"><Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
          {cErr && <p className="sm:col-span-2 text-sm text-status-refunded">{cErr}</p>}
        </form>
      </Modal>

      {/* Edit machine modal */}
      <Modal
        open={!!editM}
        onClose={() => setEditM(null)}
        title={editM ? `Edit machine — ${editM.code}` : "Edit machine"}
        footer={<><Button variant="ghost" onClick={() => setEditM(null)}>Cancel</Button><Button onClick={saveEdit}>Save changes</Button></>}
      >
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Code" hint="Setters S01, hatchers H01"><Input value={ef.code} onChange={(e) => setEf({ ...ef, code: e.target.value })} /></Field>
          <Field label="Capacity (eggs)"><Input type="number" value={ef.capacity} onChange={(e) => setEf({ ...ef, capacity: e.target.value })} /></Field>
          <Field label="Type"><Select value={ef.type} onChange={(e) => setEf({ ...ef, type: e.target.value as MachineType })} options={[{ value: "setter", label: "Setter" }, { value: "hatcher", label: "Hatcher" }]} /></Field>
          <Field label="Status"><Select value={ef.active ? "active" : "inactive"} onChange={(e) => setEf({ ...ef, active: e.target.value === "active" })} options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]} /></Field>
          {editM && machineInUse(editM.code) && (
            <p className="sm:col-span-2 text-xs text-muted">This machine is in use — its code is locked, but capacity, type and status can be changed.</p>
          )}
          {eErr && <p className="sm:col-span-2 text-sm text-status-refunded">{eErr}</p>}
        </div>
      </Modal>

      {/* Record reading modal */}
      <Modal
        open={showRecord}
        onClose={() => setShowRecord(false)}
        title="Record machine reading"
        footer={<><Button variant="ghost" onClick={() => setShowRecord(false)}>Cancel</Button><Button onClick={() => recordReading()}>Record reading</Button></>}
      >
        {!sessionOp && activeOps.length === 0 ? (
          <p className="text-sm text-status-refunded">No operators registered yet. Ask the Hatchery Manager to register operators first.</p>
        ) : (
          <form onSubmit={recordReading} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {sessionOp && <p className="sm:col-span-2 text-sm text-muted">Recording as <strong className="text-ink">{sessionOp.name}</strong>.</p>}
            <Field label="Machine"><Select value={r.machineCode} onChange={(e) => setR({ ...r, machineCode: e.target.value, turning: e.target.value ? opposite(lastTurnOf(e.target.value)) : "" })} placeholder="Select" options={machines.filter((m) => m.active).map((m) => ({ value: m.code, label: `${m.code} (${m.type})` }))} /></Field>
            {r.machineCode && (
              <div className="sm:col-span-2 rounded-md border border-line bg-cream/40 px-3 py-2 text-sm">
                {lastTurnOf(r.machineCode)
                  ? <>Last turn on {r.machineCode}: <strong className="text-ink capitalize">{lastTurnOf(r.machineCode)}</strong> — turn <strong className="text-gold-dark capitalize">{opposite(lastTurnOf(r.machineCode)) || "either way"}</strong> next.</>
                  : <>No turning recorded yet for {r.machineCode}.</>}
              </div>
            )}
            <Field label="Turning direction">
              <Select value={r.turning} onChange={(e) => setR({ ...r, turning: e.target.value as "" | TurnDirection })}
                placeholder="Not recorded"
                options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} />
            </Field>
            {!sessionOp && <Field label="Operator"><Select value={r.operatorId} onChange={(e) => setR({ ...r, operatorId: e.target.value })} placeholder="Select operator" options={activeOps.map((o) => ({ value: o.id, label: o.name }))} /></Field>}
            {!sessionOp && <Field label="Operator code" hint="Your own code proves it's you"><Input value={r.operatorCode} onChange={(e) => setR({ ...r, operatorCode: e.target.value })} placeholder="OP-XXXX" /></Field>}
            <Field label="Fan speed"><Input type="number" value={r.fanSpeed} onChange={(e) => setR({ ...r, fanSpeed: e.target.value })} /></Field>
            <Field label="Dry (°F)"><Input type="number" step="0.1" value={r.dryF} onChange={(e) => setR({ ...r, dryF: e.target.value })} /></Field>
            <Field label="Wet (°F)"><Input type="number" step="0.1" value={r.wetF} onChange={(e) => setR({ ...r, wetF: e.target.value })} /></Field>
            <Field label="Digital Temp (°F)"><Input type="number" step="0.1" value={r.digitalTempF} onChange={(e) => setR({ ...r, digitalTempF: e.target.value })} /></Field>
            <Field label="Digital Humidity (%)"><Input type="number" step="1" value={r.digitalHumidityF} onChange={(e) => setR({ ...r, digitalHumidityF: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Comment"><Input value={r.comment} onChange={(e) => setR({ ...r, comment: e.target.value })} /></Field></div>
            {r.machineCode && selectedReadings.length > 0 && (
              <p className="sm:col-span-2 text-xs text-muted">Last reading: {formatDateTime(selectedReadings[0].timestamp)} · dry {selectedReadings[0].dryF}°F · dig {selectedReadings[0].digitalTempF}°F</p>
            )}
            {rErr && <p className="sm:col-span-2 text-sm text-status-refunded">{rErr}</p>}
          </form>
        )}
      </Modal>
    </div>
  );
}

function Stat({ label, value, hot }: { label: string; value: string; hot?: boolean }) {
  return (
    <div className="rounded-lg border border-line bg-cream/40 px-2 py-1.5 text-center">
      <p className="text-[0.62rem] text-muted">{label}</p>
      <p className={`text-[0.82rem] font-bold ${hot ? "text-red" : "text-ink"}`}>{value}</p>
    </div>
  );
}

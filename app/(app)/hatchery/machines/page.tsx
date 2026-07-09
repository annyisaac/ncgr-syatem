"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, formatDateTime } from "@/lib/format";
import type { Machine, MachineReading, MachineType } from "@/lib/hatchery/types";
import { MAX_MACHINE_TEMP_F } from "@/lib/hatchery/types";
import { eggsInMachine, isMachineOverTemp } from "@/lib/hatchery/lifecycle";

// Only Admin & Hatchery Manager may create machines.
const CAN_MANAGE = ["Admin", "Hatchery Manager"];
const CAN_RECORD = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Hatchery Attendant", "Maintenance Technician", "Production Technician"];

export default function MachinesPage() {
  const { user } = useAuth();
  const { machines, operators, batches, readings, upsertMachine, upsertReading, newId } = useHatchery();
  const { operator: sessionOp } = useOperator();
  const { toast } = useToast();

  const [showCreate, setShowCreate] = useState(false);
  const [code, setCode] = useState("");
  const [type, setType] = useState<MachineType>("setter");
  const [capacity, setCapacity] = useState("");
  const [cErr, setCErr] = useState<string | null>(null);

  const [r, setR] = useState({ machineCode: "", fanSpeed: "", dryF: "", wetF: "", digitalTempF: "", digitalHumidityF: "", operatorId: "", operatorCode: "", comment: "" });
  const [rErr, setRErr] = useState<string | null>(null);

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const canRecord = !!user && CAN_RECORD.includes(user.role);
  const isAttendant = user?.role === "Hatchery Attendant";
  const activeOps = useMemo(() => operators.filter((o) => o.active), [operators]);

  const recentReadings = useMemo(
    () => readings.slice().sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 40),
    [readings]
  );

  // Last five readings for the machine currently selected in the form.
  const selectedReadings = useMemo(
    () =>
      r.machineCode
        ? readings.filter((rd) => rd.machineCode === r.machineCode).sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1)).slice(0, 5)
        : [],
    [readings, r.machineCode]
  );

  if (!user) return null;

  function createMachine(e: React.FormEvent) {
    e.preventDefault();
    setCErr(null);
    const cap = Number(capacity) || 0;
    if (!code.trim()) return setCErr("Enter the machine code (e.g. S01 / H01).");
    if (machines.some((m) => m.code.toLowerCase() === code.trim().toLowerCase())) return setCErr("A machine with that code exists.");
    if (cap <= 0) return setCErr("Enter the capacity (eggs).");
    const m: Machine = { id: newId("mac"), code: code.trim().toUpperCase(), type, capacity: cap, active: true, by: user!.email, on: nowISO() };
    upsertMachine(m);
    toast(`Machine ${m.code} created.`);
    setShowCreate(false); setCode(""); setCapacity("");
  }

  function recordReading(e: React.FormEvent) {
    e.preventDefault();
    setRErr(null);
    if (!r.machineCode) return setRErr("Select a machine.");
    // On the shared tablet the operator is already identified for the session;
    // otherwise the recorder selects their name + enters their code here.
    const op = sessionOp ?? activeOps.find((o) => o.id === r.operatorId);
    if (!op) return setRErr("Select the operator.");
    if (!sessionOp && r.operatorCode.trim().toUpperCase() !== op.code) return setRErr("Operator code does not match — enter your own code.");
    const dry = Number(r.dryF), wet = Number(r.wetF), dig = Number(r.digitalTempF), hum = Number(r.digitalHumidityF);
    if (isMachineOverTemp(dry, wet, dig)) return setRErr(`Temperature cannot exceed ${MAX_MACHINE_TEMP_F}°F.`);
    const reading: MachineReading = {
      id: newId("read"), machineCode: r.machineCode, timestamp: nowISO(),
      fanSpeed: Number(r.fanSpeed) || 0, dryF: dry, wetF: wet, digitalTempF: dig, digitalHumidityF: hum,
      operator: op.name, operatorCode: op.code, comment: r.comment.trim() || undefined, recordedBy: user!.email,
    };
    upsertReading(reading);
    toast(`Reading recorded for ${r.machineCode} by ${op.name}.`);
    setR({ ...r, fanSpeed: "", dryF: "", wetF: "", digitalTempF: "", digitalHumidityF: "", comment: "" });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Machines</h1>
        {canManage && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Hide" : "Add machine"}</Button>}
      </div>

      {showCreate && canManage && (
        <Card>
          <CardHeader title="Add machine" />
          <form onSubmit={createMachine} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Code" hint="Setters S01, hatchers H01"><Input value={code} onChange={(e) => setCode(e.target.value)} /></Field>
            <Field label="Type"><Select value={type} onChange={(e) => setType(e.target.value as MachineType)} options={[{ value: "setter", label: "Setter" }, { value: "hatcher", label: "Hatcher" }]} /></Field>
            <Field label="Capacity (eggs)"><Input type="number" value={capacity} onChange={(e) => setCapacity(e.target.value)} /></Field>
            {cErr && <p className="sm:col-span-3 text-sm text-status-refunded">{cErr}</p>}
            <div className="sm:col-span-3 flex justify-end"><Button type="submit">Save machine</Button></div>
          </form>
        </Card>
      )}

      {!isAttendant && (
        <Card>
          <CardHeader title="Machines & capacity" />
          <TableWrap>
            <thead><tr><Th>Code</Th><Th>Type</Th><Th className="text-right">Capacity</Th><Th className="text-right">In use</Th><Th className="text-right">Free</Th><Th></Th></tr></thead>
            <tbody>
              {machines.length === 0 ? <EmptyRow colSpan={6} text="No machines yet." /> : machines.map((m) => {
                const used = eggsInMachine(batches, m.code, m.type === "setter" ? "setters" : "transfers");
                return (
                  <tr key={m.id}>
                    <Td><Link href={`/hatchery/machines/${encodeURIComponent(m.code)}`} className="font-medium text-gold-dark underline underline-offset-2">{m.code}</Link></Td>
                    <Td><Pill tone={m.type === "setter" ? "info" : "purple"}>{m.type}</Pill></Td>
                    <Td className="text-right">{m.capacity.toLocaleString()}</Td>
                    <Td className="text-right">{used.toLocaleString()}</Td>
                    <Td className="text-right">{(m.capacity - used).toLocaleString()}</Td>
                    <Td><Link href={`/hatchery/machines/${encodeURIComponent(m.code)}`} className="text-xs text-gold-dark underline">View graphs →</Link></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}

      {canRecord && machines.length > 0 && (
        <Card>
          <CardHeader title="Record machine reading" />
          {!sessionOp && activeOps.length === 0 ? (
            <p className="text-sm text-status-refunded">No operators registered yet. Ask the Hatchery Manager to register operators first.</p>
          ) : (
            <form onSubmit={recordReading} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              {sessionOp && (
                <p className="sm:col-span-4 text-sm text-muted">Recording as <strong className="text-ink">{sessionOp.name}</strong>.</p>
              )}
              <Field label="Machine"><Select value={r.machineCode} onChange={(e) => setR({ ...r, machineCode: e.target.value })} placeholder="Select" options={machines.map((m) => ({ value: m.code, label: `${m.code} (${m.type})` }))} /></Field>
              {!sessionOp && <Field label="Operator"><Select value={r.operatorId} onChange={(e) => setR({ ...r, operatorId: e.target.value })} placeholder="Select operator" options={activeOps.map((o) => ({ value: o.id, label: o.name }))} /></Field>}
              {!sessionOp && <Field label="Operator code" hint="Your own code proves it's you"><Input value={r.operatorCode} onChange={(e) => setR({ ...r, operatorCode: e.target.value })} placeholder="OP-XXXX" /></Field>}
              <Field label="Fan speed"><Input type="number" value={r.fanSpeed} onChange={(e) => setR({ ...r, fanSpeed: e.target.value })} /></Field>
              <Field label="Dry (°F)"><Input type="number" step="0.1" value={r.dryF} onChange={(e) => setR({ ...r, dryF: e.target.value })} /></Field>
              <Field label="Wet (°F)"><Input type="number" step="0.1" value={r.wetF} onChange={(e) => setR({ ...r, wetF: e.target.value })} /></Field>
              <Field label="Digital Temp (°F)"><Input type="number" step="0.1" value={r.digitalTempF} onChange={(e) => setR({ ...r, digitalTempF: e.target.value })} /></Field>
              <Field label="Digital Humidity (%)"><Input type="number" step="1" value={r.digitalHumidityF} onChange={(e) => setR({ ...r, digitalHumidityF: e.target.value })} /></Field>
              <div className="sm:col-span-4"><Field label="Comment"><Input value={r.comment} onChange={(e) => setR({ ...r, comment: e.target.value })} /></Field></div>
              {rErr && <p className="sm:col-span-4 text-sm text-status-refunded">{rErr}</p>}
              <div className="sm:col-span-4 flex justify-end"><Button type="submit">Record reading</Button></div>
            </form>
          )}
        </Card>
      )}

      {isAttendant ? (
        <Card>
          <CardHeader title={r.machineCode ? `Last 5 readings — ${r.machineCode}` : "Last 5 readings"} />
          {!r.machineCode ? (
            <p className="text-sm text-muted">Select a machine above to see its last five readings.</p>
          ) : (
            <TableWrap>
              <thead><tr><Th>When</Th><Th className="text-right">Fan</Th><Th className="text-right">Dry°F</Th><Th className="text-right">Wet°F</Th><Th className="text-right">Digital°F</Th><Th className="text-right">Hum%</Th><Th>Operator</Th></tr></thead>
              <tbody>
                {selectedReadings.length === 0 ? <EmptyRow colSpan={7} text="No readings for this machine yet." /> : selectedReadings.map((rd) => {
                  const hot = isMachineOverTemp(rd.dryF, rd.wetF, rd.digitalTempF);
                  return (
                    <tr key={rd.id}>
                      <Td>{formatDateTime(rd.timestamp)}</Td>
                      <Td className="text-right">{rd.fanSpeed}</Td>
                      <Td className="text-right">{rd.dryF}</Td>
                      <Td className="text-right">{rd.wetF}</Td>
                      <Td className={`text-right ${hot ? "font-bold text-red" : ""}`}>{rd.digitalTempF}</Td>
                      <Td className="text-right">{rd.digitalHumidityF}</Td>
                      <Td>{rd.operator}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </TableWrap>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Recent readings" />
          <TableWrap>
            <thead><tr><Th>When</Th><Th>Machine</Th><Th className="text-right">Fan</Th><Th className="text-right">Dry°F</Th><Th className="text-right">Wet°F</Th><Th className="text-right">Digital°F</Th><Th className="text-right">Hum%</Th><Th>Operator</Th></tr></thead>
            <tbody>
              {recentReadings.length === 0 ? <EmptyRow colSpan={8} text="No readings yet." /> : recentReadings.map((rd) => {
                const hot = isMachineOverTemp(rd.dryF, rd.wetF, rd.digitalTempF);
                return (
                  <tr key={rd.id}>
                    <Td>{formatDateTime(rd.timestamp)}</Td>
                    <Td><Link href={`/hatchery/machines/${encodeURIComponent(rd.machineCode)}`} className="text-gold-dark underline underline-offset-2">{rd.machineCode}</Link></Td>
                    <Td className="text-right">{rd.fanSpeed}</Td>
                    <Td className="text-right">{rd.dryF}</Td>
                    <Td className="text-right">{rd.wetF}</Td>
                    <Td className={`text-right ${hot ? "font-bold text-red" : ""}`}>{rd.digitalTempF}</Td>
                    <Td className="text-right">{rd.digitalHumidityF}</Td>
                    <Td>{rd.operator}</Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}

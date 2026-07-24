"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate, formatDateTime } from "@/lib/format";
import type { HandoverMachine, HandoverStatus, ShiftHandover, ShiftName, Machine } from "@/lib/hatchery/types";

const AREA = "w-full rounded-[9px] border border-line bg-field px-3.5 py-2.5 text-[0.9rem] text-ink outline-none focus:border-gold";

/** Default machine rows for the form — the real machines, or the template's four. */
function defaultMachines(machines: Machine[]): HandoverMachine[] {
  const live = machines.filter((m) => m.active);
  if (live.length > 0) return live.map((m) => ({ name: `${m.type === "hatcher" ? "Hatcher" : "Setter"} ${m.code}`, ok: true, remarks: "" }));
  return [
    { name: "Setter 1", ok: true, remarks: "" },
    { name: "Setter 2", ok: true, remarks: "" },
    { name: "Hatcher 1", ok: true, remarks: "" },
    { name: "Hatcher 2", ok: true, remarks: "" },
  ];
}

const blankForm = (machines: Machine[]) => ({
  date: todayISO(),
  shift: "day" as ShiftName,
  outgoingLeader: "",
  incomingLeader: "",
  summary: "",
  status: {} as HandoverStatus,
  machines: defaultMachines(machines),
  problems: "",
  pending: "",
  consumables: "",
  time: new Date().toTimeString().slice(0, 5),
});

export default function HandoverPage() {
  const { user } = useAuth();
  const { shiftHandovers, upsertShiftHandover, newId, machines } = useHatchery();
  const { operator: sessionOp } = useOperator();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [f, setF] = useState(() => blankForm(machines));
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<ShiftHandover | null>(null);

  const rows = useMemo(() => shiftHandovers.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [shiftHandovers]);
  if (!user) return null;

  const set = (p: Partial<ReturnType<typeof blankForm>>) => setF((x) => ({ ...x, ...p }));
  const setStatus = (p: Partial<HandoverStatus>) => setF((x) => ({ ...x, status: { ...x.status, ...p } }));
  const setMachine = (i: number, p: Partial<HandoverMachine>) => setF((x) => ({ ...x, machines: x.machines.map((m, j) => (j === i ? { ...m, ...p } : m)) }));

  function open() { setF(blankForm(machines)); setErr(null); setShow(true); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.summary.trim()) return setErr("Add a short note of the work completed this shift.");
    const h: ShiftHandover = {
      id: newId("shift"),
      date: f.date,
      shift: f.shift,
      outgoingLeader: f.outgoingLeader.trim() || undefined,
      incomingLeader: f.incomingLeader.trim() || undefined,
      summary: f.summary.trim(),
      status: f.status,
      machines: f.machines.filter((m) => m.name.trim()),
      problems: f.problems.trim() || undefined,
      pending: f.pending.trim(),
      consumables: f.consumables.trim() || undefined,
      time: f.time || undefined,
      by: user!.email,
      byName: sessionOp?.name ?? user!.name,
      on: nowISO(),
    };
    void upsertShiftHandover(h);
    toast("Shift handover recorded.");
    setShow(false);
  }

  const numField = (label: string, key: keyof HandoverStatus) => (
    <Field label={label}>
      <Input type="number" min={0} value={(f.status[key] as number | undefined) ?? ""} onChange={(e) => setStatus({ [key]: Number(e.target.value) || undefined } as Partial<HandoverStatus>)} />
    </Field>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">End-of-shift log so the next shift knows the state of the floor.</p>
        <Button onClick={() => (show ? setShow(false) : open())}>{show ? "Hide form" : "Record handover"}</Button>
      </div>

      {show && (
        <Card>
          <CardHeader title="Hatchery shift handover log" />
          <form onSubmit={submit} className="space-y-5">
            {/* Header */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Date"><Input type="date" value={f.date} onChange={(e) => set({ date: e.target.value })} /></Field>
              <Field label="Shift"><Select value={f.shift} onChange={(e) => set({ shift: e.target.value as ShiftName })} options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]} /></Field>
              <Field label="Outgoing team leader"><Input value={f.outgoingLeader} onChange={(e) => set({ outgoingLeader: e.target.value })} placeholder={sessionOp?.name ?? user.name} /></Field>
              <Field label="Incoming team leader"><Input value={f.incomingLeader} onChange={(e) => set({ incomingLeader: e.target.value })} /></Field>
            </div>

            {/* 1. Work completed */}
            <section>
              <h3 className="mb-1 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">1 · Work completed</h3>
              <textarea className={AREA} rows={3} value={f.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="What was done this shift…" />
            </section>

            {/* 2. Current hatchery status */}
            <section>
              <h3 className="mb-2 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">2 · Current hatchery status</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {numField("Eggs received", "eggsReceived")}
                {numField("Eggs set", "eggsSet")}
                <Field label="Candling done">
                  <Select value={f.status.candlingDone ? "yes" : "no"} onChange={(e) => setStatus({ candlingDone: e.target.value === "yes" })} options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} />
                </Field>
                {numField("Eggs transferred", "eggsTransferred")}
                {numField("Chicks hatched", "chicksHatched")}
                {numField("Chicks vaccinated / packed", "chicksPacked")}
              </div>
            </section>

            {/* 3. Machine status */}
            <section>
              <h3 className="mb-2 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">3 · Machine status</h3>
              <TableWrap>
                <thead><tr><Th>Machine</Th><Th>Status</Th><Th>Remarks</Th><Th></Th></tr></thead>
                <tbody>
                  {f.machines.map((m, i) => (
                    <tr key={i}>
                      <Td className="w-44"><Input value={m.name} onChange={(e) => setMachine(i, { name: e.target.value })} /></Td>
                      <Td className="w-28">
                        <button type="button" onClick={() => setMachine(i, { ok: !m.ok })}
                          className={`rounded-md border px-3 py-1.5 text-sm font-semibold ${m.ok ? "border-green/40 bg-green-bg text-green" : "border-red/40 bg-red-bg text-red"}`}>
                          {m.ok ? "✓ OK" : "✗ Fault"}
                        </button>
                      </Td>
                      <Td><Input value={m.remarks ?? ""} onChange={(e) => setMachine(i, { remarks: e.target.value })} placeholder="optional" /></Td>
                      <Td>{f.machines.length > 1 && <Button size="sm" variant="ghost" onClick={() => set({ machines: f.machines.filter((_, j) => j !== i) })}>✕</Button>}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              <Button size="sm" variant="ghost" className="mt-2" onClick={() => set({ machines: [...f.machines, { name: "", ok: true, remarks: "" }] })}>＋ Add machine</Button>
            </section>

            {/* 4-6 text sections */}
            <section>
              <h3 className="mb-1 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">4 · Problems encountered</h3>
              <textarea className={AREA} rows={2} value={f.problems} onChange={(e) => set({ problems: e.target.value })} placeholder="Any issues this shift…" />
            </section>
            <section>
              <h3 className="mb-1 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">5 · Tasks for the next shift</h3>
              <textarea className={AREA} rows={2} value={f.pending} onChange={(e) => set({ pending: e.target.value })} placeholder="What the next shift must pick up…" />
            </section>
            <section>
              <h3 className="mb-1 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">6 · Consumables needed</h3>
              <textarea className={AREA} rows={2} value={f.consumables} onChange={(e) => set({ consumables: e.target.value })} placeholder="Vaccines, boxes, gas, disinfectant…" />
            </section>

            <div className="w-40"><Field label="Handover time"><Input type="time" value={f.time} onChange={(e) => set({ time: e.target.value })} /></Field></div>

            {err && <p className="text-sm text-status-refunded">{err}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
              <Button type="submit">Save handover</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`Recent handovers (${rows.length})`} />
        <TableWrap>
          <thead>
            <tr><Th>Date</Th><Th>Shift</Th><Th>Leaders (out → in)</Th><Th>Work completed</Th><Th>Machines</Th><Th>By</Th><Th></Th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={7} text="No handovers recorded yet." />
            ) : rows.map((h) => {
              const faults = (h.machines ?? []).filter((m) => !m.ok).length;
              return (
                <tr key={h.id}>
                  <Td>{formatDate(h.date)}{h.time ? <div className="text-xs text-muted">{h.time}</div> : null}</Td>
                  <Td className="capitalize">{h.shift}</Td>
                  <Td className="text-xs">{h.outgoingLeader || "—"} → {h.incomingLeader || "—"}</Td>
                  <Td className="max-w-[20rem] truncate">{h.summary}</Td>
                  <Td>{h.machines?.length ? (faults > 0 ? <Pill tone="red">{faults} fault{faults > 1 ? "s" : ""}</Pill> : <Pill tone="green">all OK</Pill>) : (h.machinesNote ? <span className="text-xs text-muted">note</span> : "—")}</Td>
                  <Td className="text-xs text-muted">{h.byName ?? h.by}<div>{formatDateTime(h.on)}</div></Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => setView(h)}>View</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {view && <HandoverView h={view} onClose={() => setView(null)} />}
    </div>
  );
}

function HandoverView({ h, onClose }: { h: ShiftHandover; onClose: () => void }) {
  const s = h.status ?? {};
  const statusItems: [string, string | number | undefined][] = [
    ["Eggs received", s.eggsReceived], ["Eggs set", s.eggsSet],
    ["Candling done", s.candlingDone == null ? undefined : (s.candlingDone ? "Yes" : "No")],
    ["Eggs transferred", s.eggsTransferred], ["Chicks hatched", s.chicksHatched], ["Chicks vaccinated / packed", s.chicksPacked],
  ];
  return (
    <Modal open onClose={onClose} title={`Handover — ${formatDate(h.date)} · ${h.shift} shift`} className="max-w-2xl"
      footer={<Button onClick={onClose}>Close</Button>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted">Outgoing:</span> <strong>{h.outgoingLeader || "—"}</strong></div>
          <div><span className="text-muted">Incoming:</span> <strong>{h.incomingLeader || "—"}</strong></div>
        </div>

        <Detail label="1 · Work completed" value={h.summary} />

        <div>
          <p className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">2 · Current hatchery status</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {statusItems.map(([label, val]) => (
              <div key={label} className="rounded-lg border border-line bg-field px-3 py-2">
                <p className="text-[0.66rem] text-muted">{label}</p>
                <p className="text-sm font-semibold text-ink">{val ?? "—"}</p>
              </div>
            ))}
          </div>
        </div>

        {h.machines && h.machines.length > 0 && (
          <div>
            <p className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">3 · Machine status</p>
            <TableWrap>
              <thead><tr><Th>Machine</Th><Th>Status</Th><Th>Remarks</Th></tr></thead>
              <tbody>
                {h.machines.map((m, i) => (
                  <tr key={i}><Td className="font-medium">{m.name}</Td>
                    <Td>{m.ok ? <Pill tone="green">✓ OK</Pill> : <Pill tone="red">✗ Fault</Pill>}</Td>
                    <Td>{m.remarks || "—"}</Td></tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}

        {h.problems && <Detail label="4 · Problems encountered" value={h.problems} />}
        <Detail label="5 · Tasks for the next shift" value={h.pending || "—"} />
        {h.consumables && <Detail label="6 · Consumables needed" value={h.consumables} />}
        {h.machinesNote && <Detail label="Machine notes" value={h.machinesNote} />}

        <div className="border-t border-line pt-3 text-xs text-muted">
          Recorded by {h.byName ?? h.by} · {formatDateTime(h.on)}{h.time ? ` · handover time ${h.time}` : ""}
        </div>
      </div>
    </Modal>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink">{value}</p>
    </div>
  );
}

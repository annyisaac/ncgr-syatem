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
import { todayISO, formatDate, formatDateTime } from "@/lib/format";
import type { Batch, HandoverChecks, HandoverEnv, HandoverMachine, HandoverStatus, Reception, ShiftHandover, ShiftName, Machine } from "@/lib/hatchery/types";

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

/** Today's hatchery activity, computed from live batches & receptions, used to
 *  pre-fill the status so the leader confirms rather than re-types. */
function liveStatus(batches: Batch[], receptions: Reception[]): HandoverStatus {
  const today = todayISO();
  const isToday = (iso?: string) => !!iso && iso.slice(0, 10) === today;
  return {
    eggsReceived: receptions.filter((r) => r.date === today).reduce((s, r) => s + (r.eggsReceived || 0), 0) || undefined,
    eggsSet: batches.filter((b) => b.setDate === today).reduce((s, b) => s + (b.eggsSet || 0), 0) || undefined,
    candlingDone: batches.some((b) => (b.candlings ?? []).some((c) => isToday(c.on))),
    eggsTransferred: batches.filter((b) => isToday(b.steps?.["transfer"]?.on)).reduce((s, b) => s + (b.transfers ?? []).reduce((t, a) => t + (a.eggs || 0), 0), 0) || undefined,
    chicksHatched: batches.filter((b) => isToday(b.steps?.["hatching"]?.on)).reduce((s, b) => s + (b.hatchedCount || 0), 0) || undefined,
    chicksPacked: batches.filter((b) => isToday(b.steps?.["counting"]?.on)).reduce((s, b) => s + (b.countedTotal || 0), 0) || undefined,
  };
}

const blankForm = (machines: Machine[], batches: Batch[], receptions: Reception[]) => ({
  shift: "day" as ShiftName,
  outgoingLeader: "",
  incomingLeader: "",
  attendants: "",
  summary: "",
  status: liveStatus(batches, receptions),
  env: {} as HandoverEnv,
  machines: defaultMachines(machines),
  problems: "",
  pending: "",
  consumables: "",
  checks: {} as HandoverChecks,
});

export default function HandoverPage() {
  const { user } = useAuth();
  const { shiftHandovers, upsertShiftHandover, newId, machines, batches, receptions } = useHatchery();
  const { operator: sessionOp } = useOperator();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [f, setF] = useState(() => blankForm(machines, batches, receptions));
  const [err, setErr] = useState<string | null>(null);
  const [view, setView] = useState<ShiftHandover | null>(null);

  const rows = useMemo(() => shiftHandovers.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [shiftHandovers]);
  if (!user) return null;

  const set = (p: Partial<ReturnType<typeof blankForm>>) => setF((x) => ({ ...x, ...p }));
  const setStatus = (p: Partial<HandoverStatus>) => setF((x) => ({ ...x, status: { ...x.status, ...p } }));
  const setEnv = (p: Partial<HandoverEnv>) => setF((x) => ({ ...x, env: { ...x.env, ...p } }));
  const setChecks = (p: Partial<HandoverChecks>) => setF((x) => ({ ...x, checks: { ...x.checks, ...p } }));
  const setMachine = (i: number, p: Partial<HandoverMachine>) => setF((x) => ({ ...x, machines: x.machines.map((m, j) => (j === i ? { ...m, ...p } : m)) }));

  function open() { setF(blankForm(machines, batches, receptions)); setErr(null); setShow(true); }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.summary.trim()) return setErr("Add a short note of the work completed this shift.");
    // The system stamps the date and time the handover is recorded — not chosen.
    const now = new Date();
    const h: ShiftHandover = {
      id: newId("shift"),
      date: todayISO(),
      shift: f.shift,
      outgoingLeader: f.outgoingLeader.trim() || undefined,
      incomingLeader: f.incomingLeader.trim() || undefined,
      attendants: f.attendants.trim() || undefined,
      summary: f.summary.trim(),
      status: f.status,
      env: f.env,
      machines: f.machines.filter((m) => m.name.trim()),
      problems: f.problems.trim() || undefined,
      pending: f.pending.trim(),
      consumables: f.consumables.trim() || undefined,
      checks: f.checks,
      time: now.toTimeString().slice(0, 5),
      by: user!.email,
      byName: sessionOp?.name ?? user!.name,
      on: now.toISOString(),
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
  const envField = (label: string, key: keyof HandoverEnv, unit: string) => (
    <Field label={`${label} (${unit})`}>
      <Input type="number" value={(f.env[key] as number | undefined) ?? ""} onChange={(e) => setEnv({ [key]: Number(e.target.value) || undefined } as Partial<HandoverEnv>)} />
    </Field>
  );
  const CHECK_ITEMS: [keyof HandoverChecks, string][] = [["footbath", "Footbath charged"], ["doors", "Doors & locks secured"], ["generator", "Generator & fuel ready"], ["cleaning", "Cleaning done"]];

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
            {/* Header — the date & time are stamped by the system when you save. */}
            <p className="rounded-lg border border-line bg-field px-3 py-2 text-xs text-muted">
              Recording now — <strong className="text-ink">{formatDate(todayISO())}</strong>. The time is saved automatically when you press Save.
            </p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Shift"><Select value={f.shift} onChange={(e) => set({ shift: e.target.value as ShiftName })} options={[{ value: "day", label: "Day" }, { value: "night", label: "Night" }]} /></Field>
              <div />
              <Field label="Outgoing team leader"><Input value={f.outgoingLeader} onChange={(e) => set({ outgoingLeader: e.target.value })} placeholder={sessionOp?.name ?? user.name} /></Field>
              <Field label="Incoming team leader"><Input value={f.incomingLeader} onChange={(e) => set({ incomingLeader: e.target.value })} /></Field>
              <div className="sm:col-span-2"><Field label="Attendants on this shift"><Input value={f.attendants} onChange={(e) => set({ attendants: e.target.value })} placeholder="Names of the operators who worked the shift" /></Field></div>
            </div>

            {/* 1. Work completed */}
            <section>
              <h3 className="mb-1 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">1 · Work completed</h3>
              <textarea className={AREA} rows={3} value={f.summary} onChange={(e) => set({ summary: e.target.value })} placeholder="What was done this shift…" />
            </section>

            {/* 2. Current hatchery status */}
            <section>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">2 · Current hatchery status</h3>
                <Button size="sm" variant="ghost" onClick={() => set({ status: liveStatus(batches, receptions) })}>↻ Refill from system</Button>
              </div>
              <p className="-mt-1 mb-2 text-xs text-muted">Pre-filled from today&apos;s batches &amp; receptions — check and adjust before saving.</p>
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

            {/* Environment */}
            <section>
              <h3 className="mb-2 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">Environment readings</h3>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
                {envField("Setter temp", "setterTemp", "°F")}
                {envField("Setter humidity", "setterHumidity", "%")}
                {envField("Hatcher temp", "hatcherTemp", "°F")}
                {envField("Hatcher humidity", "hatcherHumidity", "%")}
                {envField("Room temp", "roomTemp", "°C")}
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

            {/* Safety & biosecurity check */}
            <section>
              <h3 className="mb-2 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">7 · Safety &amp; biosecurity check</h3>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {CHECK_ITEMS.map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 rounded-lg border border-line bg-field px-3 py-2 text-sm text-ink">
                    <input type="checkbox" checked={!!f.checks[key]} onChange={(e) => setChecks({ [key]: e.target.checked } as Partial<HandoverChecks>)} /> {label}
                  </label>
                ))}
              </div>
            </section>

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
        {h.attendants && <Detail label="Attendants on shift" value={h.attendants} />}

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

        {h.env && Object.values(h.env).some((v) => v != null) && (
          <div>
            <p className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Environment readings</p>
            <p className="text-sm text-ink">
              {[
                h.env.setterTemp != null && `Setter ${h.env.setterTemp}°F`,
                h.env.setterHumidity != null && `${h.env.setterHumidity}% RH`,
                h.env.hatcherTemp != null && `Hatcher ${h.env.hatcherTemp}°F`,
                h.env.hatcherHumidity != null && `${h.env.hatcherHumidity}% RH`,
                h.env.roomTemp != null && `Room ${h.env.roomTemp}°C`,
              ].filter(Boolean).join(" · ") || "—"}
            </p>
          </div>
        )}

        {h.problems && <Detail label="4 · Problems encountered" value={h.problems} />}
        <Detail label="5 · Tasks for the next shift" value={h.pending || "—"} />
        {h.consumables && <Detail label="6 · Consumables needed" value={h.consumables} />}

        {h.checks && Object.values(h.checks).some((v) => v != null) && (
          <div>
            <p className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">7 · Safety &amp; biosecurity check</p>
            <div className="flex flex-wrap gap-2">
              {([["footbath", "Footbath"], ["doors", "Doors & locks"], ["generator", "Generator & fuel"], ["cleaning", "Cleaning done"]] as [keyof typeof h.checks, string][]).map(([k, label]) => (
                <Pill key={k} tone={h.checks?.[k] ? "green" : "neutral"}>{h.checks?.[k] ? "✓" : "○"} {label}</Pill>
              ))}
            </div>
          </div>
        )}

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

"use client";

import { useMemo, useState, type ReactNode } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useOperator } from "@/components/OperatorProvider";
import { useToast } from "@/components/ui/Toast";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { todayISO, formatDate, formatDateTime } from "@/lib/format";
import type { Batch, HandoverChecks, HandoverEnv, HandoverMachine, HandoverStatus, Reception, ShiftHandover, ShiftName, Machine } from "@/lib/hatchery/types";

const AREA = "w-full rounded-[9px] border border-line bg-field px-3.5 py-2.5 text-[0.9rem] text-ink outline-none focus:border-gold";
const HG = "bg-onyx px-3 py-2.5 text-left text-[0.62rem] font-bold uppercase tracking-wider text-[#f3e9c9] whitespace-nowrap";

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
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(10);

  const rows = useMemo(() => shiftHandovers.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [shiftHandovers]);

  // Summary KPIs derived from existing handover data.
  const today = todayISO();
  const todayCount = rows.filter((h) => h.date === today).length;
  const dayCount = rows.filter((h) => h.shift === "day").length;
  const nightCount = rows.filter((h) => h.shift === "night").length;
  const withFaults = rows.filter((h) => (h.machines ?? []).some((m) => !m.ok)).length;

  // Filtered + paginated handovers.
  const s = q.trim().toLowerCase();
  const filtered = rows.filter((h) => !s
    || (h.summary ?? "").toLowerCase().includes(s)
    || (h.outgoingLeader ?? "").toLowerCase().includes(s)
    || (h.incomingLeader ?? "").toLowerCase().includes(s)
    || (h.shift ?? "").toLowerCase().includes(s)
    || (h.byName ?? h.by ?? "").toLowerCase().includes(s));
  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / perPage));
  const curPage = Math.min(page, pageCount);
  const start = (curPage - 1) * perPage;
  const pageRows = filtered.slice(start, start + perPage);

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
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-extrabold tracking-tight text-ink">Shift Handover</h1>
          <p className="text-sm text-muted">End-of-shift log so the next shift knows the state of the floor</p>
        </div>
        <Button onClick={open}>＋ New handover</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatCard icon={<IcoClipboard />} tone="blue" value={rows.length.toLocaleString()} label="Total handovers" />
        <StatCard icon={<IcoCalendar />} tone="green" value={todayCount.toLocaleString()} label="Today" />
        <StatCard icon={<IcoSun />} tone="gold" value={dayCount.toLocaleString()} label="Day shift" />
        <StatCard icon={<IcoMoon />} tone="default" value={nightCount.toLocaleString()} label="Night shift" />
        <StatCard icon={<IcoAlert />} tone="red" value={withFaults.toLocaleString()} label="With faults" />
      </div>

      {/* New handover modal */}
      <Modal open={show} onClose={() => setShow(false)} title="Record shift handover" className="max-w-3xl">
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
      </Modal>

      {/* Recent handovers */}
      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[0.95rem] font-bold text-ink">Recent handovers</h2>
          <div className="relative w-full max-w-xs">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <Input className="pl-9" placeholder="Search shift, leader or work…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          </div>
        </div>
        <TableWrap>
          <thead>
            <tr>
              <th className={`${HG} first:rounded-tl-lg`}>Date</th>
              <th className={HG}>Shift</th>
              <th className={HG}>Leaders (out → in)</th>
              <th className={HG}>Work completed</th>
              <th className={HG}>Machines</th>
              <th className={HG}>By</th>
              <th className={`${HG} last:rounded-tr-lg`}></th>
            </tr>
          </thead>
          <tbody>
            {pageRows.length === 0 ? (
              <EmptyRow colSpan={7} text="No handovers match." />
            ) : pageRows.map((h) => {
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
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
          <span>{total === 0 ? "No handovers" : `Showing ${start + 1} to ${Math.min(start + perPage, total)} of ${total} handovers`}</span>
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
const IcoClipboard = () => fsvg(<><rect x="6" y="4" width="12" height="17" rx="2" /><path d="M9 4h6v2.5H9zM9 11h6M9 15h4" /></>);
const IcoCalendar = () => fsvg(<><rect x="4" y="5" width="16" height="16" rx="2" /><path d="M4 9h16M8 3v4M16 3v4" /></>);
const IcoSun = () => fsvg(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19" /></>);
const IcoMoon = () => fsvg(<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5Z" />);
const IcoAlert = () => fsvg(<><path d="M12 3 2.5 20h19L12 3Z" /><path d="M12 10v4M12 17h.01" /></>);

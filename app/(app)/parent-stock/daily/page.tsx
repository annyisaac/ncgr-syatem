"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { LineChartView } from "@/components/charts/Charts";
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listFlocks, upsertFlock, type BreederFlock } from "@/lib/parentStock";
import {
  birdsLost, cumulativeLost, dailyLogId, eggProductionPct, hatchablePct, listDailyLogs, logsForFlock,
  recentMortality, recomputeFlock, rejectEggsTotal, rejectPct, upsertDailyLog, type DailyLog,
} from "@/lib/psDaily";

export default function DailyRecordsPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [date, setDate] = useState(todayISO());
  const [editing, setEditing] = useState<{ flock: BreederFlock; log: DailyLog } | null>(null);
  const [trendFlock, setTrendFlock] = useState<string>("");

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";

  const load = useCallback(async () => {
    try { const [f, l] = await Promise.all([listFlocks(), listDailyLogs()]); setFlocks(f); setLogs(l); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-daily-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "ps_daily" || p.table === "ps_flocks") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const today = todayISO();
  const active = useMemo(() => flocks.filter((f) => f.active && f.stage !== "Depleted"), [flocks]);
  const logByFlockDate = useMemo(() => new Map(logs.map((l) => [l.id, l])), [logs]);

  const dayLogs = useMemo(() => logs.filter((l) => l.date === date), [logs, date]);
  const dayMortality = dayLogs.reduce((s, l) => s + birdsLost(l), 0);
  const dayEggs = dayLogs.reduce((s, l) => s + (Number(l.eggsProduced) || 0), 0);
  const dayFeed = dayLogs.reduce((s, l) => s + (Number(l.feedKg) || 0), 0);
  const recordedCount = active.filter((f) => logByFlockDate.has(dailyLogId(f.id, date))).length;

  const trendData = useMemo(() => {
    if (!trendFlock) return { mort: [] as { label: string; value: number }[], eggs: [] as { label: string; value: number }[] };
    const fl = logsForFlock(logs, trendFlock).slice(-21);
    return {
      mort: fl.map((l) => ({ label: formatDate(l.date), value: birdsLost(l) })),
      eggs: fl.map((l) => ({ label: formatDate(l.date), value: Number(l.eggsProduced) || 0 })),
    };
  }, [logs, trendFlock]);
  const trendIsFemale = flocks.find((f) => f.id === trendFlock)?.sex === "Female";

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  function openRecord(f: BreederFlock) {
    const existing = logByFlockDate.get(dailyLogId(f.id, date));
    setEditing({ flock: f, log: existing ?? { id: dailyLogId(f.id, date), flockId: f.id, flockCode: f.code, sex: f.sex, date, by: user!.email, on: nowISO() } });
  }
  async function save(log: DailyLog) {
    const clean = { ...log, on: nowISO(), by: user!.email };
    const nextLogs = [...logs.filter((l) => l.id !== clean.id), clean];
    setLogs(nextLogs);
    const flock = flocks.find((f) => f.id === clean.flockId);
    try {
      await upsertDailyLog(clean);
      if (flock) { const updated = recomputeFlock(flock, nextLogs); setFlocks((p) => p.map((f) => f.id === updated.id ? updated : f)); await upsertFlock(updated); }
      toast("Daily record saved.");
    } catch { toast("Could not save.", "error"); void load(); }
    setEditing(null);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-muted">Record each flock&apos;s day — mortality, feed, water, weight and eggs. The logs keep every flock&apos;s population current.</p>
        </div>
        <div className="w-44"><Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} max={today} /></Field></div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Flocks recorded" value={`${recordedCount} / ${active.length}`} tone={recordedCount === active.length && active.length > 0 ? "green" : "gold"} />
        <StatTile label="Mortality today" value={dayMortality.toLocaleString()} tone={dayMortality > 0 ? "red" : "default"} />
        <StatTile label="Eggs today" value={dayEggs.toLocaleString()} />
        <StatTile label="Feed today" value={`${dayFeed.toLocaleString()} kg`} />
      </div>

      <Card>
        <CardHeader title={`Flocks — ${formatDate(date)}`} />
        <TableWrap>
          <thead><tr>
            <Th>Flock</Th><Th>Sex</Th><Th className="text-right">Birds</Th><Th className="text-right">Mortality</Th><Th className="text-right">Feed</Th>
            <Th className="text-right">Eggs</Th><Th className="text-right">Egg %</Th><Th>Recorded</Th><Th></Th>
          </tr></thead>
          <tbody>
            {active.length === 0 ? <EmptyRow colSpan={9} text="No active flocks. Add breeder flocks first." /> : active.map((f) => {
              const log = logByFlockDate.get(dailyLogId(f.id, date));
              return (
                <tr key={f.id}>
                  <Td className="font-medium">{f.code}</Td>
                  <Td>{f.sex}</Td>
                  <Td className="text-right">{f.currentPopulation.toLocaleString()}</Td>
                  <Td className="text-right">{log ? birdsLost(log).toLocaleString() : "—"}</Td>
                  <Td className="text-right">{log?.feedKg ? `${log.feedKg} kg` : "—"}</Td>
                  <Td className="text-right">{f.sex === "Female" && log?.eggsProduced ? log.eggsProduced.toLocaleString() : "—"}</Td>
                  <Td className="text-right">{f.sex === "Female" && log?.eggsProduced ? `${eggProductionPct(log, f.currentPopulation)}%` : "—"}</Td>
                  <Td>{log ? <Pill tone="green">Recorded</Pill> : <Pill tone="neutral">Pending</Pill>}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => openRecord(f)}>{log ? "Edit" : "Record"}</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title="Trends" action={<div className="w-56"><Select value={trendFlock} onChange={(e) => setTrendFlock(e.target.value)} options={[{ value: "", label: "Choose a flock…" }, ...active.map((f) => ({ value: f.id, label: `${f.code} (${f.sex})` }))]} /></div>} />
        {!trendFlock ? <p className="text-sm text-muted">Pick a flock to see its mortality and egg-production trend (last 21 days).</p> : (
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div>
              <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Daily mortality</div>
              <LineChartView data={trendData.mort} color="#b91c1c" valueName="Birds" />
              <p className="mt-1 text-xs text-muted">Cumulative lost: {cumulativeLost(logs, trendFlock).toLocaleString()} · last 7 days: {recentMortality(logs, trendFlock, 7, today).toLocaleString()}</p>
            </div>
            {trendIsFemale && (
              <div>
                <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Eggs produced</div>
                <LineChartView data={trendData.eggs} color="#15803d" valueName="Eggs" />
              </div>
            )}
          </div>
        )}
      </Card>

      {editing && <DailyModal key={editing.log.id} flock={editing.flock} initial={editing.log} onClose={() => setEditing(null)} onSave={save} />}
    </div>
  );
}

function DailyModal({ flock, initial, onClose, onSave }: {
  flock: BreederFlock; initial: DailyLog; onClose: () => void; onSave: (l: DailyLog) => void;
}) {
  const [l, setL] = useState<DailyLog>(initial);
  const set = (p: Partial<DailyLog>) => setL((x) => ({ ...x, ...p }));
  const isFemaleLaying = flock.sex === "Female" && (flock.laying || (Number(l.eggsProduced) || 0) > 0);
  const numField = (label: string, key: keyof DailyLog, unit?: string) => (
    <Field label={unit ? `${label} (${unit})` : label}>
      <Input type="number" min={0} value={(l[key] as number | undefined) ?? ""} onChange={(e) => set({ [key]: Number(e.target.value) || undefined } as Partial<DailyLog>)} />
    </Field>
  );

  return (
    <Modal open onClose={onClose} title={`${flock.code} · ${formatDate(l.date)}`} className="max-w-2xl"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSave(l)}>Save record</Button></>}>
      <div className="space-y-4">
        <div className="text-xs text-muted">{flock.sex} breeder · {flock.currentPopulation.toLocaleString()} birds · {flock.breed}{flock.house ? ` · ${flock.house}` : ""}</div>
        <div>
          <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Flock</div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {numField("Mortality", "mortality")}
            {numField("Culls", "culls")}
            {numField("Body weight", "bodyWeightG", "g")}
            {numField("Uniformity", "uniformityPct", "%")}
            {numField("Feed", "feedKg", "kg")}
            {numField("Water", "waterL", "L")}
          </div>
        </div>

        {flock.sex === "Female" && (
          <div>
            <div className="mb-1 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Egg production</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {numField("Eggs produced", "eggsProduced")}
              {numField("Hatchable", "hatchableEggs")}
              {numField("Floor", "floorEggs")}
              {numField("Dirty", "dirtyEggs")}
              {numField("Cracked", "crackedEggs")}
              {numField("Misshaped", "misshapedEggs")}
              {numField("Reject", "rejectEggs")}
            </div>
            {(Number(l.eggsProduced) || 0) > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatTile label="Hen-day %" value={`${eggProductionPct(l, flock.currentPopulation)}%`} tone="gold" />
                <StatTile label="Hatchable %" value={`${hatchablePct(l)}%`} tone="green" />
                <StatTile label="Reject %" value={`${rejectPct(l)}%`} tone={rejectPct(l) > 10 ? "red" : "default"} />
                <StatTile label="Non-hatchable" value={rejectEggsTotal(l).toLocaleString()} />
              </div>
            )}
            {!isFemaleLaying && <p className="mt-2 text-xs text-muted">Entering eggs marks this flock as laying.</p>}
          </div>
        )}

        <Field label="Notes"><Input value={l.notes ?? ""} onChange={(e) => set({ notes: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

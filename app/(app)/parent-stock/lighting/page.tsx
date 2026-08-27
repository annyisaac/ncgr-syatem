"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { ageWeeks, listFlocks, upsertFlock, type BreederFlock } from "@/lib/parentStock";
import { listDailyLogs, type DailyLog } from "@/lib/psDaily";
import { PHOTOSTIM_MIN_WEEKS, assessBodyWeight, photostimReadiness, recommendedLight } from "@/lib/psStandards";

const daysBetween = (fromISO: string, toISO: string) => Math.floor((Date.parse(toISO) - Date.parse(fromISO)) / 86_400_000);

export default function LightingPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";
  const today = todayISO();

  const load = useCallback(async () => {
    try { const [f, l] = await Promise.all([listFlocks(), listDailyLogs()]); setFlocks(f); setLogs(l); } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-lighting-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["ps_flocks", "ps_daily"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const rows = useMemo(() => {
    return flocks.filter((f) => f.active && f.stage !== "Depleted").map((f) => {
      const weeks = ageWeeks(f, today);
      const weighed = logs.filter((l) => l.flockId === f.id && (l.bodyWeightG ?? 0) > 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const assess = assessBodyWeight(weighed?.bodyWeightG ?? 0, weeks, f.sex);
      const daysSince = f.photostimOn ? daysBetween(f.photostimOn, today) : null;
      const light = recommendedLight(weeks, daysSince);
      const readiness = photostimReadiness(weeks, weighed?.bodyWeightG ? assess.status : "on", weighed?.cvPct ?? 0, weighed?.uniformityPct ?? 0);
      return { flock: f, weeks, daysSince, light, readiness, stimulated: !!f.photostimOn };
    }).sort((a, b) => (a.weeks ?? 0) - (b.weeks ?? 0));
  }, [flocks, logs, today]);

  const readyNow = rows.filter((r) => !r.stimulated && r.readiness.ready).length;
  const stimulated = rows.filter((r) => r.stimulated).length;
  const rearing = rows.filter((r) => !r.stimulated).length;

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  async function recordPhotostim(flock: BreederFlock) {
    if (!confirm(`Record first light stimulation for ${flock.code} today (${formatDate(today)})? The light program will then step up from 11h.`)) return;
    try {
      const line = `${nowISO()} — First light stimulation (photostimulation) — light increased (by ${user!.name})`;
      await upsertFlock({ ...flock, photostimOn: today, history: [...(flock.history ?? []), line] });
      setFlocks((p) => p.map((f) => (f.id === flock.id ? { ...f, photostimOn: today } : f)));
      toast(`Photostimulation recorded for ${flock.code}.`);
    } catch { toast("Could not record photostimulation.", "error"); }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">Lighting &amp; photostimulation</h1>
        <p className="text-sm text-muted">The Ross light program per flock, and when each is ready for first light stimulation (not before 21 weeks, at target weight & uniformity).</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Ready to stimulate" value={String(readyNow)} tone={readyNow > 0 ? "green" : "default"} />
        <StatTile label="In rearing" value={String(rearing)} />
        <StatTile label="Stimulated" value={String(stimulated)} tone="gold" />
      </div>

      <Card>
        <CardHeader title="Light program & photostimulation status" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Flock</Th><Th>Sex</Th><Th className="text-right">Age (wk)</Th><Th>Recommended light</Th><Th>Photostimulation</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} text="No active flocks." />
            ) : rows.map((r) => (
              <tr key={r.flock.id}>
                <Td className="font-medium">{r.flock.code}</Td>
                <Td>{r.flock.sex}</Td>
                <Td className="text-right tabular-nums">{r.weeks ?? "—"}</Td>
                <Td>{r.light.label}</Td>
                <Td>
                  {r.stimulated ? (
                    <Pill tone="gold">Stimulated · {r.daysSince}d ago</Pill>
                  ) : r.readiness.ready ? (
                    <Pill tone="green">Ready to stimulate</Pill>
                  ) : (r.weeks ?? 0) >= PHOTOSTIM_MIN_WEEKS - 2 ? (
                    <span className="text-sm text-red">Not yet — {r.readiness.reasons[0]}</span>
                  ) : (
                    <span className="text-sm text-muted">Rearing</span>
                  )}
                </Td>
                <Td className="text-right">
                  {!r.stimulated && r.readiness.ready && (
                    <Button size="sm" onClick={() => recordPhotostim(r.flock)}>Stimulate</Button>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">Brooding 23h → reduce to a constant 8h by day 10 → hold through rearing. First light increase not before 21 weeks; after stimulation the program steps ~11h → 14h. Readiness needs target body weight and good uniformity.</p>
      </Card>

      {rows.some((r) => !r.stimulated && !r.readiness.ready && (r.weeks ?? 0) >= PHOTOSTIM_MIN_WEEKS - 2) && (
        <Card>
          <CardHeader title="Blocking light stimulation" />
          <div className="space-y-2.5">
            {rows.filter((r) => !r.stimulated && !r.readiness.ready && (r.weeks ?? 0) >= PHOTOSTIM_MIN_WEEKS - 2).map((r) => (
              <div key={r.flock.id} className="rounded-xl border border-line bg-paper p-3 text-sm shadow-card">
                <p className="font-semibold text-ink">{r.flock.code} <span className="font-normal text-muted">· {r.flock.sex} · wk {r.weeks ?? "—"}</span></p>
                <ul className="mt-1 list-disc pl-5 text-ink">{r.readiness.reasons.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

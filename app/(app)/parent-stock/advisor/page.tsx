"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatDate, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { ageWeeks, listFlocks, type BreederFlock } from "@/lib/parentStock";
import { listDailyLogs, type DailyLog } from "@/lib/psDaily";
import {
  CV_TARGET, PHOTOSTIM_MIN_WEEKS, UNIFORMITY_TARGET, assessBodyWeight, feedAdvice,
  henDayTarget, photostimReadiness,
} from "@/lib/psStandards";

type Sev = "high" | "med" | "info";
interface Action { flockId: string; flockCode: string; sex: string; weeks: number | null; sev: Sev; title: string; detail: string; }
const sevRank: Record<Sev, number> = { high: 0, med: 1, info: 2 };
const sevTone: Record<Sev, "red" | "gold" | "info"> = { high: "red", med: "gold", info: "info" };
const daysBetween = (a: string, b: string) => Math.floor((Date.parse(b) - Date.parse(a)) / 86_400_000);

export default function AdvisorPage() {
  const { user } = useAuth();
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
    const ch = sb.channel("ps-advisor-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["ps_flocks", "ps_daily"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  // Per-flock derived metrics + production.
  const perFlock = useMemo(() => flocks.filter((f) => f.active && f.stage !== "Depleted").map((f) => {
    const weeks = ageWeeks(f, today);
    const weighed = logs.filter((l) => l.flockId === f.id && (l.bodyWeightG ?? 0) > 0).sort((a, b) => (a.date < b.date ? 1 : -1))[0];
    const assess = assessBodyWeight(weighed?.bodyWeightG ?? 0, weeks, f.sex);
    const cv = weighed?.cvPct ?? 0, uni = weighed?.uniformityPct ?? 0;
    const daysSinceWeigh = weighed ? daysBetween(weighed.date, today) : null;
    // Recent hen-day % (last 7 laying days) for female flocks.
    const eggLogs = logs.filter((l) => l.flockId === f.id && (l.eggsProduced ?? 0) > 0).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 7);
    const pop = f.currentPopulation || 0;
    const actualHenDay = f.sex === "Female" && eggLogs.length > 0 && pop > 0
      ? Math.round((eggLogs.reduce((s, l) => s + (l.eggsProduced ?? 0), 0) / (eggLogs.length * pop)) * 1000) / 10
      : null;
    const targetHenDay = f.sex === "Female" ? henDayTarget(weeks) : 0;
    return { f, weeks, weighed, assess, cv, uni, daysSinceWeigh, actualHenDay, targetHenDay };
  }), [flocks, logs, today]);

  // Build the prioritized action list.
  const actions = useMemo(() => {
    const out: Action[] = [];
    for (const r of perFlock) {
      const base = { flockId: r.f.id, flockCode: r.f.code, sex: r.f.sex, weeks: r.weeks };
      if (r.weighed && r.assess.target > 0 && r.assess.status !== "on") {
        out.push({ ...base, sev: r.assess.status === "under" ? "high" : "med", title: `Feed — ${r.assess.status === "under" ? "below" : "above"} target ${r.assess.deltaPct > 0 ? "+" : ""}${r.assess.deltaPct}%`, detail: feedAdvice(r.assess.status) });
      }
      if (r.weighed && r.cv > CV_TARGET) {
        out.push({ ...base, sev: (r.weeks ?? 99) <= 4 ? "high" : "med", title: `Grade — CV ${r.cv}% (target ≤ ${CV_TARGET}%)`, detail: "Uniformity is low; grade the flock into weight classes." });
      }
      if (!r.f.photostimOn) {
        const ready = photostimReadiness(r.weeks, r.weighed?.bodyWeightG ? r.assess.status : "on", r.cv, r.uni);
        if (ready.ready) out.push({ ...base, sev: "high", title: "Light-stimulate now", detail: "Flock is at ≥21 weeks, on target weight and uniform — start the first light increase." });
        else if ((r.weeks ?? 0) >= PHOTOSTIM_MIN_WEEKS - 2) out.push({ ...base, sev: "med", title: "Prepare for light stimulation", detail: ready.reasons.join("; ") });
      }
      if ((r.weeks ?? 99) < 25 && (r.daysSinceWeigh == null || r.daysSinceWeigh > 10)) {
        out.push({ ...base, sev: "med", title: "Weigh the flock", detail: r.daysSinceWeigh == null ? "No weighing recorded yet." : `Last weighed ${r.daysSinceWeigh} days ago — weigh weekly to track the profile.` });
      }
      if (r.actualHenDay != null && r.targetHenDay > 0 && r.actualHenDay < r.targetHenDay - 5) {
        out.push({ ...base, sev: "high", title: `Production below standard (${r.actualHenDay}% vs ${r.targetHenDay}%)`, detail: "Review feed allocation, light hours, water and health." });
      }
    }
    return out.sort((a, b) => sevRank[a.sev] - sevRank[b.sev] || a.flockCode.localeCompare(b.flockCode));
  }, [perFlock]);

  const laying = perFlock.filter((r) => r.actualHenDay != null);
  const highCount = actions.filter((a) => a.sev === "high").length;

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">Farm advisor</h1>
        <p className="text-sm text-muted">What to do next per flock, and production against the Ross standard — from the daily records.</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <StatTile label="Priority actions" value={String(highCount)} tone={highCount > 0 ? "red" : "green"} />
        <StatTile label="Total actions" value={String(actions.length)} tone={actions.length > 0 ? "gold" : "green"} />
        <StatTile label="Laying flocks" value={String(laying.length)} />
      </div>

      <Card>
        <CardHeader title={`Next actions (${actions.length})`} />
        {actions.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">Everything is on track — no actions needed.</p>
        ) : (
          <div className="space-y-2">
            {actions.map((a, i) => (
              <div key={i} className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-paper p-3 shadow-card">
                <Pill tone={sevTone[a.sev]}>{a.sev === "high" ? "Priority" : a.sev === "med" ? "Soon" : "Note"}</Pill>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">{a.title} <span className="font-normal text-muted">· {a.flockCode} · {a.sex} · wk {a.weeks ?? "—"}</span></p>
                  <p className="text-sm text-muted">{a.detail}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Production vs Ross standard" action={<Link href="/parent-stock/growth" className="text-xs font-semibold text-gold-dark underline">Growth</Link>} />
        <TableWrap>
          <thead>
            <tr><Th>Flock</Th><Th className="text-right">Age (wk)</Th><Th className="text-right">Hens</Th><Th className="text-right">Hen-day %</Th><Th className="text-right">Ross target</Th><Th>vs target</Th></tr>
          </thead>
          <tbody>
            {laying.length === 0 ? (
              <EmptyRow colSpan={6} text="No laying flocks with egg records yet." />
            ) : laying.map((r) => {
              const diff = Math.round(((r.actualHenDay ?? 0) - r.targetHenDay) * 10) / 10;
              return (
                <tr key={r.f.id}>
                  <Td className="font-medium">{r.f.code}</Td>
                  <Td className="text-right tabular-nums">{r.weeks ?? "—"}</Td>
                  <Td className="text-right tabular-nums">{r.f.currentPopulation.toLocaleString()}</Td>
                  <Td className="text-right tabular-nums">{r.actualHenDay}%</Td>
                  <Td className="text-right tabular-nums text-muted">{r.targetHenDay ? `${r.targetHenDay}%` : "—"}</Td>
                  <Td>{r.targetHenDay > 0 ? <Pill tone={diff >= -3 ? "green" : diff >= -8 ? "gold" : "red"}>{diff > 0 ? "+" : ""}{diff} pts</Pill> : "—"}</Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">Hen-day % = eggs ÷ hens (recent laying days). Target is the Ross 308 standard for the flock&apos;s age.</p>
      </Card>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { ageWeeks, listFlocks, upsertFlock, type BreederFlock } from "@/lib/parentStock";
import { dailyLogId, listDailyLogs, recomputeFlock, upsertDailyLog, type DailyLog } from "@/lib/psDaily";
import {
  CV_TARGET, UNIFORMITY_TARGET, assessBodyWeight, feedAdvice, gradeSample, sampleSize, sampleStats,
  targetBodyWeightG, uniformityAdvice, type GradeResult,
} from "@/lib/psStandards";

const toneForStatus = (s: "under" | "on" | "over") => (s === "on" ? "green" : s === "under" ? "red" : "gold");

export default function GrowthPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [weigh, setWeigh] = useState<BreederFlock | null>(null);
  const [grade, setGrade] = useState<BreederFlock | null>(null);

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
    const ch = sb.channel("ps-growth-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["ps_daily", "ps_flocks"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  // Latest weighing per flock (newest log that carries a body weight).
  const rows = useMemo(() => {
    return flocks.filter((f) => f.active && f.stage !== "Depleted").map((f) => {
      const weighed = logs
        .filter((l) => l.flockId === f.id && (l.bodyWeightG ?? 0) > 0)
        .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
      const weeks = ageWeeks(f, today);
      const bw = weighed?.bodyWeightG ?? 0;
      const assess = assessBodyWeight(bw, weeks, f.sex);
      const cv = weighed?.cvPct ?? 0;
      const uni = weighed?.uniformityPct ?? 0;
      return { flock: f, weeks, weighed, bw, assess, cv, uni };
    }).sort((a, b) => (a.weeks ?? 0) - (b.weeks ?? 0));
  }, [flocks, logs, today]);

  const onTarget = rows.filter((r) => r.bw > 0 && r.assess.status === "on").length;
  const under = rows.filter((r) => r.bw > 0 && r.assess.status === "under").length;
  const over = rows.filter((r) => r.bw > 0 && r.assess.status === "over").length;
  const cvVals = rows.filter((r) => r.cv > 0).map((r) => r.cv);
  const avgCv = cvVals.length ? Math.round((cvVals.reduce((s, v) => s + v, 0) / cvVals.length) * 10) / 10 : 0;

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  async function saveWeighing(flock: BreederFlock, date: string, stats: NonNullable<ReturnType<typeof sampleStats>>) {
    const id = dailyLogId(flock.id, date);
    const existing = logs.find((l) => l.id === id);
    const log: DailyLog = {
      ...(existing ?? { id, flockId: flock.id, flockCode: flock.code, sex: flock.sex, date, by: user!.email, on: nowISO() }),
      bodyWeightG: stats.meanG, uniformityPct: stats.uniformityPct, cvPct: stats.cvPct,
      by: user!.email, on: nowISO(),
    };
    try {
      await upsertDailyLog(log);
      const merged = [...logs.filter((l) => l.id !== id), log];
      await upsertFlock(recomputeFlock(flock, merged));
      setLogs(merged);
      toast(`Weighing saved — ${flock.code}: ${stats.meanG} g, CV ${stats.cvPct}%.`);
      setWeigh(null);
    } catch {
      toast("Could not save the weighing.", "error");
    }
  }

  async function recordGrade(flock: BreederFlock, date: string, result: GradeResult) {
    const line = `${nowISO()} — Graded (${result.recommend}) — Light ${result.light.pct}% (~${result.light.count}), Normal ${result.normal.pct}%, Heavy ${result.heavy.pct}% at mean ${result.meanG} g (by ${user!.name})`;
    try {
      await upsertFlock({ ...flock, lastGradedOn: date, history: [...(flock.history ?? []), line] });
      setFlocks((p) => p.map((f) => (f.id === flock.id ? { ...f, lastGradedOn: date } : f)));
      toast(`Grading recorded for ${flock.code}.`);
      setGrade(null);
    } catch {
      toast("Could not record the grading.", "error");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">Growth &amp; uniformity</h1>
        <p className="text-sm text-muted">Body weight vs the Ross standard, uniformity (CV%) from a weighed sample, and feed guidance per flock.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="On target" value={String(onTarget)} tone="green" />
        <StatTile label="Under target" value={String(under)} tone={under > 0 ? "red" : "default"} />
        <StatTile label="Over target" value={String(over)} tone={over > 0 ? "gold" : "default"} />
        <StatTile label="Avg CV%" value={avgCv ? `${avgCv}%` : "—"} tone={avgCv && avgCv > CV_TARGET ? "red" : "green"} />
      </div>

      <Card>
        <CardHeader title="Flocks — actual vs Ross target" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Flock</Th><Th>Sex</Th><Th className="text-right">Age (wk)</Th><Th className="text-right">Birds</Th>
              <Th className="text-right">Body wt (g)</Th><Th className="text-right">Target</Th><Th>vs target</Th>
              <Th className="text-right">CV%</Th><Th className="text-right">Unif.</Th><Th></Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={10} text="No active flocks in rearing/lay." />
            ) : rows.map((r) => (
              <tr key={r.flock.id}>
                <Td className="font-medium">{r.flock.code}</Td>
                <Td>{r.flock.sex}</Td>
                <Td className="text-right tabular-nums">{r.weeks ?? "—"}</Td>
                <Td className="text-right tabular-nums">{r.flock.currentPopulation.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{r.bw ? r.bw.toLocaleString() : "—"}</Td>
                <Td className="text-right tabular-nums text-muted">{r.assess.target ? r.assess.target.toLocaleString() : "—"}</Td>
                <Td>{r.bw > 0 && r.assess.target > 0 ? <Pill tone={toneForStatus(r.assess.status)}>{r.assess.deltaPct > 0 ? "+" : ""}{r.assess.deltaPct}%</Pill> : "—"}</Td>
                <Td className="text-right tabular-nums">{r.cv ? <span className={r.cv > CV_TARGET ? "font-semibold text-red" : "text-ink"}>{r.cv}%</span> : "—"}</Td>
                <Td className="text-right tabular-nums">{r.uni ? <span className={r.uni < UNIFORMITY_TARGET ? "font-semibold text-red" : "text-ink"}>{r.uni}%</span> : "—"}</Td>
                <Td className="text-right whitespace-nowrap">
                  <Button size="sm" variant="secondary" className="mr-1.5" onClick={() => setWeigh(r.flock)}>Weigh</Button>
                  <Button size="sm" variant="ghost" onClick={() => setGrade(r.flock)}>Grade</Button>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      {/* Advice cards for flocks that need attention */}
      {rows.some((r) => r.bw > 0 && (r.assess.status !== "on" || (r.cv > CV_TARGET && r.cv > 0))) && (
        <Card>
          <CardHeader title="Recommended actions" />
          <div className="space-y-2.5">
            {rows.filter((r) => r.bw > 0 && (r.assess.status !== "on" || (r.cv > CV_TARGET && r.cv > 0))).map((r) => (
              <div key={r.flock.id} className="rounded-xl border border-line bg-paper p-3 text-sm shadow-card">
                <p className="font-semibold text-ink">{r.flock.code} <span className="font-normal text-muted">· {r.flock.sex} · wk {r.weeks ?? "—"}</span></p>
                {r.assess.status !== "on" && <p className="mt-1 text-ink">⚖ {feedAdvice(r.assess.status)} <span className="text-muted">({r.assess.deltaPct > 0 ? "+" : ""}{r.assess.deltaPct}% vs target)</span></p>}
                {r.cv > CV_TARGET && <p className="mt-1 text-ink">↔ {uniformityAdvice(r.cv, r.uni, r.weeks)}</p>}
              </div>
            ))}
          </div>
        </Card>
      )}

      {weigh && <WeighModal flock={weigh} today={today} onClose={() => setWeigh(null)} onSave={saveWeighing} />}
      {grade && <GradeModal flock={grade} today={today} onClose={() => setGrade(null)} onRecord={recordGrade} />}
    </div>
  );
}

function GradeModal({
  flock, today, onClose, onRecord,
}: {
  flock: BreederFlock;
  today: string;
  onClose: () => void;
  onRecord: (flock: BreederFlock, date: string, result: GradeResult) => void;
}) {
  const [date, setDate] = useState(today);
  const [raw, setRaw] = useState("");
  const weights = useMemo(() => raw.split(/[\s,;]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0), [raw]);
  const result = useMemo(() => gradeSample(weights, flock.currentPopulation), [weights, flock.currentPopulation]);
  const needed = sampleSize(flock.currentPopulation);

  const Row = ({ label, c, tone }: { label: string; c: GradeResult["light"]; tone: string }) => (
    <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm">
      <span className="flex items-center gap-2"><span className={`inline-block h-2.5 w-2.5 rounded-full ${tone}`} /> {label}</span>
      <span className="tabular-nums text-ink"><b>{c.pct}%</b> <span className="text-muted">· ~{c.count.toLocaleString()} birds · avg {c.avgG ? `${c.avgG} g` : "—"}</span></span>
    </div>
  );

  return (
    <Modal open onClose={onClose} title={`Grade — ${flock.code}`} className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!result} onClick={() => result && onRecord(flock, date, result)}>Record grading</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="flex flex-col justify-end text-sm text-muted">Population: <b className="text-ink">{flock.currentPopulation.toLocaleString()}</b> · sample ≥ {needed}</div>
        </div>
        <Field label="Individual weights (g) — paste, separated by space, comma or new line">
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={5}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none"
            placeholder="1520 1480 1610 1550 1495 …" />
        </Field>

        {result && (
          <>
            <div className="space-y-1.5">
              <Row label="Light (≤ −10%)" c={result.light} tone="bg-red" />
              <Row label="Normal (±10%)" c={result.normal} tone="bg-green" />
              <Row label="Heavy (≥ +10%)" c={result.heavy} tone="bg-gold" />
            </div>
            <div className={`rounded-xl border p-3 text-sm ${result.recommend === "none" ? "border-green/40 bg-green-bg/40" : "border-gold/40 bg-gold-bg/40"}`}>
              <p className="font-semibold text-ink">
                {result.recommend === "none" ? "No grading needed" : `Recommend: grade ${result.recommend}`}
                <span className="font-normal text-muted"> · mean {result.meanG} g</span>
              </p>
              <p className="mt-1 text-ink">{result.note}</p>
              {result.recommend !== "none" && (
                <p className="mt-1 text-xs text-muted">After grading: feed each pen to its own target — Light up toward target (by 21 weeks), Normal on the target line, Heavy held/redrawn.</p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

function WeighModal({
  flock, today, onClose, onSave,
}: {
  flock: BreederFlock;
  today: string;
  onClose: () => void;
  onSave: (flock: BreederFlock, date: string, stats: NonNullable<ReturnType<typeof sampleStats>>) => void;
}) {
  const [date, setDate] = useState(today);
  const [raw, setRaw] = useState("");

  const weights = useMemo(() => raw.split(/[\s,;]+/).map((s) => Number(s)).filter((n) => Number.isFinite(n) && n > 0), [raw]);
  const stats = useMemo(() => sampleStats(weights), [weights]);
  const needed = sampleSize(flock.currentPopulation);
  const weeks = ageWeeks(flock, date);
  const target = targetBodyWeightG(weeks, flock.sex);
  const assess = stats ? assessBodyWeight(stats.meanG, weeks, flock.sex) : null;

  return (
    <Modal open onClose={onClose} title={`Weigh sample — ${flock.code}`} className="max-w-lg"
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button disabled={!stats} onClick={() => stats && onSave(flock, date, stats)}>Save weighing</Button></>}>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <div className="flex flex-col justify-end text-sm text-muted">
            Sample needed: <b className="text-ink">{needed.toLocaleString()} birds</b> (2% or 50, whichever is greater)
          </div>
        </div>
        <Field label="Individual weights (g) — paste, separated by space, comma or new line">
          <textarea value={raw} onChange={(e) => setRaw(e.target.value)} rows={5}
            className="w-full rounded-lg border border-line bg-paper px-3 py-2 text-sm text-ink focus:border-gold focus:outline-none"
            placeholder="1520 1480 1610 1550 1495 …" />
        </Field>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <StatTile label="Weighed" value={stats ? `${stats.n}` : "0"} tone={stats && stats.n >= needed ? "green" : "gold"} />
          <StatTile label="Mean" value={stats ? `${stats.meanG} g` : "—"} />
          <StatTile label="CV%" value={stats ? `${stats.cvPct}%` : "—"} tone={stats && stats.cvPct > CV_TARGET ? "red" : "green"} />
          <StatTile label="Uniformity" value={stats ? `${stats.uniformityPct}%` : "—"} tone={stats && stats.uniformityPct < UNIFORMITY_TARGET ? "red" : "green"} />
        </div>

        {stats && (
          <div className="rounded-xl border border-line bg-cream/40 p-3 text-sm">
            <p>Target at wk {weeks ?? "—"}: <b>{target ? `${target.toLocaleString()} g` : "—"}</b>{assess && target > 0 && <> · <span className={assess.status === "on" ? "text-green" : assess.status === "under" ? "text-red" : "text-gold-dark"}>{assess.deltaPct > 0 ? "+" : ""}{assess.deltaPct}% ({assess.deltaG > 0 ? "+" : ""}{assess.deltaG} g)</span></>}</p>
            {assess && target > 0 && <p className="mt-1 text-ink">{feedAdvice(assess.status)}</p>}
            {stats.cvPct > CV_TARGET && <p className="mt-1 text-ink">{uniformityAdvice(stats.cvPct, stats.uniformityPct, weeks)}</p>}
            {stats.n < needed && <p className="mt-1 text-gold-dark">Weigh more birds — {needed - stats.n} short of the recommended sample.</p>}
          </div>
        )}
      </div>
    </Modal>
  );
}

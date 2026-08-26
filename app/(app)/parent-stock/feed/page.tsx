"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatRWF } from "@/lib/config";
import { formatDate, todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { listFlocks, type BreederFlock } from "@/lib/parentStock";
import { listDailyLogs, type DailyLog } from "@/lib/psDaily";
import { isLow, listItems, type InventoryItem } from "@/lib/psInventory";
import { feedByFlock, feedForecast, feedTrend, feedUnitCost } from "@/lib/psFeed";

const cn = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");
function addDaysISO(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export default function FeedPage() {
  const { user } = useAuth();
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const [logs, setLogs] = useState<DailyLog[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [period, setPeriod] = useState<"7" | "30" | "all">("30");

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";

  const load = useCallback(async () => {
    try {
      const [f, l, i] = await Promise.all([listFlocks(), listDailyLogs(), listItems()]);
      setFlocks(f); setLogs(l); setItems(i);
    } catch { /* keep */ }
  }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-feed-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (["ps_daily", "ps_flocks", "ps_inventory", "ps_stock_moves"].includes(p.table ?? "")) { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const today = todayISO();
  const from = period === "all" ? "" : addDaysISO(today, -(Number(period) - 1));

  const unitCost = useMemo(() => feedUnitCost(items), [items]);
  const byFlock = useMemo(() => feedByFlock(logs, flocks, today, from, today, unitCost), [logs, flocks, today, from, unitCost]);
  const trend = useMemo(() => feedTrend(logs, from, today), [logs, from, today]);
  const forecast = useMemo(() => feedForecast(items, logs, from, today), [items, logs, from, today]);

  const totalFeedKg = byFlock.reduce((s, f) => s + f.feedKg, 0);
  const totalBirds = byFlock.reduce((s, f) => s + f.birds, 0);
  const totalCost = byFlock.reduce((s, f) => s + f.cost, 0);
  // Herd-average intake (g/bird/day), population-weighted by the logged intake.
  const avgIntake = totalBirds > 0 ? Math.round(byFlock.reduce((s, f) => s + f.gPerBirdDay * f.birds, 0) / totalBirds) : 0;
  const maxWeek = Math.max(1, ...trend.map((w) => w.feedKg));
  const lowFeed = forecast.feedItems.filter(isLow);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  const varTone = (v: number) => (Math.abs(v) <= 8 ? "green" : v < 0 ? "red" : "gold");

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-extrabold tracking-tight text-ink">Feed consumption</h1>
          <p className="text-sm text-muted">Consumption, intake vs breeder standard, and days of stock left — from the daily logs & inventory.</p>
        </div>
        <div className="flex gap-1.5">
          {(["7", "30", "all"] as const).map((p) => (
            <button key={p} type="button" onClick={() => setPeriod(p)}
              className={cn("rounded-lg border px-3 py-1.5 text-sm font-semibold transition",
                period === p ? "border-gold bg-gold-bg text-gold-dark" : "border-line text-muted hover:border-ink")}>
              {p === "7" ? "7 days" : p === "30" ? "30 days" : "All time"}
            </button>
          ))}
        </div>
      </div>

      {forecast.daysRemaining !== null && forecast.daysRemaining < 7 && (
        <div className="flex items-center gap-3 rounded-xl border border-red/30 bg-red-bg/60 px-4 py-3">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-red-bg font-bold text-red">!</span>
          <p className="text-sm text-ink">
            Only <b className="text-red">{forecast.daysRemaining} day{forecast.daysRemaining === 1 ? "" : "s"}</b> of feed left
            ({forecast.stockKg.toLocaleString()} kg in stock at {forecast.dailyKg.toLocaleString()} kg/day) — reorder soon.
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        <StatTile label="Feed consumed" value={`${totalFeedKg.toLocaleString()} kg`} tone="gold" />
        <StatTile label="Avg intake" value={`${avgIntake} g/bird/day`} />
        <StatTile label="Feed cost" value={formatRWF(totalCost)} tone="gold" />
        <StatTile label="Stock on hand" value={`${forecast.stockKg.toLocaleString()} kg`} />
        <StatTile label="Days remaining" value={forecast.daysRemaining !== null ? `${forecast.daysRemaining}` : "—"} tone={forecast.daysRemaining !== null && forecast.daysRemaining < 7 ? "red" : "green"} />
      </div>

      <Card>
        <CardHeader title="Weekly consumption" />
        {trend.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted">No feed logged for this period.</p>
        ) : (
          <div className="space-y-2">
            {trend.map((w) => (
              <div key={w.week} className="flex items-center gap-3">
                <span className="w-24 shrink-0 text-xs text-muted">{formatDate(w.week)}</span>
                <div className="h-4 flex-1 overflow-hidden rounded bg-grey-bg">
                  <div className="h-full rounded bg-gold" style={{ width: `${(w.feedKg / maxWeek) * 100}%` }} />
                </div>
                <span className="w-24 shrink-0 text-right text-xs font-semibold tabular-nums text-ink">{w.feedKg.toLocaleString()} kg</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Intake by flock — actual vs standard" />
        <TableWrap>
          <thead>
            <tr>
              <Th>Flock</Th><Th>Sex</Th><Th className="text-right">Birds</Th><Th className="text-right">Feed (kg)</Th>
              <Th className="text-right">Intake g/bird/day</Th><Th className="text-right">Target</Th><Th>vs target</Th><Th className="text-right">Cost</Th>
            </tr>
          </thead>
          <tbody>
            {byFlock.length === 0 ? (
              <EmptyRow colSpan={8} text="No feed logged for this period." />
            ) : byFlock.map((f) => (
              <tr key={f.flock.id}>
                <Td className="font-medium">{f.flock.code}</Td>
                <Td>{f.flock.sex}</Td>
                <Td className="text-right tabular-nums">{f.birds.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{f.feedKg.toLocaleString()}</Td>
                <Td className="text-right tabular-nums">{f.gPerBirdDay || "—"}</Td>
                <Td className="text-right tabular-nums text-muted">{f.targetG || "—"}</Td>
                <Td>{f.targetG > 0 && f.gPerBirdDay > 0 ? <Pill tone={varTone(f.variancePct)}>{f.variancePct > 0 ? "+" : ""}{f.variancePct}%</Pill> : "—"}</Td>
                <Td className="text-right tabular-nums">{formatRWF(f.cost)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">Target is a broiler-breeder standard for the flock&apos;s age; ±8% reads as on-target, red = under-feeding, gold = over-feeding.</p>
      </Card>

      <Card>
        <CardHeader title="Feed stock" action={lowFeed.length > 0 ? <Pill tone="red">{lowFeed.length} low</Pill> : undefined} />
        <TableWrap>
          <thead>
            <tr><Th>Item</Th><Th className="text-right">In stock</Th><Th>Unit</Th><Th className="text-right">Unit cost</Th><Th>Status</Th></tr>
          </thead>
          <tbody>
            {forecast.feedItems.length === 0 ? (
              <EmptyRow colSpan={5} text="No feed items in inventory yet." />
            ) : forecast.feedItems.map((i) => (
              <tr key={i.id}>
                <Td className="font-medium">{i.name}</Td>
                <Td className="text-right tabular-nums">{i.currentStock.toLocaleString()}</Td>
                <Td>{i.unit}</Td>
                <Td className="text-right tabular-nums">{i.unitCost ? formatRWF(i.unitCost) : "—"}</Td>
                <Td>{isLow(i) ? <Pill tone="red">Low</Pill> : <Pill tone="green">OK</Pill>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import { ageWeeks, listFlocks, type BreederFlock } from "@/lib/parentStock";
import { EGG_STORE_MAX_DAYS, HOUSE_RH, houseTempTarget } from "@/lib/psStandards";

const EGG_CARE: string[] = [
  "Collect eggs frequently (at least 4–5×/day) to reduce contamination and floor eggs.",
  "Store hatching eggs below 18°C (ideal ~15°C) at 70–80% RH — a cool, stable egg room.",
  `Keep storage short: ≤ ${EGG_STORE_MAX_DAYS} days. Beyond that, hatchability falls fast.`,
  "Handle clean, blunt-end up; never fumigate or chill a sweating (condensating) egg.",
  "Pre-warm eggs before setting; wash water 7–10°C warmer than the egg to avoid sweating.",
  "Grade out floor, dirty, cracked and misshapen eggs — don't set them.",
];

const BIOSECURITY: string[] = [
  "Control all farm entry — visitors log, shower/change, dedicated farm clothing & boots.",
  "Foot dips / wheel dips with fresh approved disinfectant at every entrance.",
  "Clean & sanitize automatic egg belts weekly; remove and clean nest mats every ~6 weeks.",
  "Inspect and clean water storage tanks and lines regularly; sanitize per label.",
  "Rodent, wild-bird and insect control programs in place and monitored.",
  "Follow the flock vaccination program; record every treatment.",
  "One age/site where possible; all-in/all-out; clean-down between flocks.",
];

export default function StandardsPage() {
  const { user } = useAuth();
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);
  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";
  const today = todayISO();

  const load = useCallback(async () => { try { setFlocks(await listFlocks()); } catch { /* keep */ } }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-standards-live").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if ((p.table ?? "") === "ps_flocks") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const rows = useMemo(() => flocks.filter((f) => f.active && f.stage !== "Depleted")
    .map((f) => ({ f, weeks: ageWeeks(f, today), temp: houseTempTarget(ageWeeks(f, today)) }))
    .sort((a, b) => (a.weeks ?? 0) - (b.weeks ?? 0)), [flocks, today]);

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-extrabold tracking-tight text-ink">Standards &amp; checklists</h1>
        <p className="text-sm text-muted">Ross environment, egg-care and biosecurity standards — with the target house temperature for each flock&apos;s age.</p>
      </div>

      <Card>
        <CardHeader title="Environment — target house temperature by flock" />
        <TableWrap>
          <thead>
            <tr><Th>Flock</Th><Th>Sex</Th><Th className="text-right">Age (wk)</Th><Th className="text-right">Target temp</Th><Th>Target RH</Th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={5} text="No active flocks." />
            ) : rows.map((r) => (
              <tr key={r.f.id}>
                <Td className="font-medium">{r.f.code}</Td>
                <Td>{r.f.sex}</Td>
                <Td className="text-right tabular-nums">{r.weeks ?? "—"}</Td>
                <Td className="text-right tabular-nums font-semibold text-ink">{r.temp}°C</Td>
                <Td>{HOUSE_RH}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">Brooding starts at ~30°C (day-old, at chick level) and declines to a ~20°C house temperature; RH {HOUSE_RH}. Bird behaviour is the best guide — adjust to the flock.</p>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Care of hatching eggs" action={<Pill tone="gold">Egg quality</Pill>} />
          <ul className="space-y-2 text-sm text-ink">
            {EGG_CARE.map((x, i) => (
              <li key={i} className="flex gap-2"><span className="mt-0.5 text-gold-dark">✓</span><span>{x}</span></li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Biosecurity" action={<Pill tone="red">Critical</Pill>} />
          <ul className="space-y-2 text-sm text-ink">
            {BIOSECURITY.map((x, i) => (
              <li key={i} className="flex gap-2"><span className="mt-0.5 text-red">•</span><span>{x}</span></li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}

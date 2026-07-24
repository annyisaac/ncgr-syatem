"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { todayISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";
import {
  ageWeeks, avgBodyWeight, depletionPct, listFlocks, totalsForSex, type BreederFlock,
} from "@/lib/parentStock";

export default function ParentStockDashboard() {
  const { user } = useAuth();
  const [flocks, setFlocks] = useState<BreederFlock[]>([]);

  const canUse = user?.role === "Admin" || user?.role === "Parent Stock Manager";

  const load = useCallback(async () => { try { setFlocks(await listFlocks()); } catch { /* keep */ } }, []);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { if (canUse) void load(); }, [load, canUse]);
  useEffect(() => {
    if (!canUse) return;
    const sb = getSupabase();
    let t: ReturnType<typeof setTimeout> | null = null;
    const ch = sb.channel("ps-dash").on("postgres_changes", { event: "*", schema: "public" }, (p: { table?: string }) => {
      if (p.table === "ps_flocks") { if (t) clearTimeout(t); t = setTimeout(() => void load(), 400); }
    }).subscribe();
    return () => { if (t) clearTimeout(t); void sb.removeChannel(ch); };
  }, [canUse, load]);

  const today = todayISO();
  const males = totalsForSex(flocks, "Male");
  const females = totalsForSex(flocks, "Female");
  const active = useMemo(() => flocks.filter((f) => f.active && f.stage !== "Depleted"), [flocks]);
  const inLay = active.filter((f) => f.sex === "Female" && f.laying).length;
  const inProduction = active.filter((f) => f.stage === "Production").length;
  const mfRatio = females.birds > 0 ? (males.birds / females.birds) : 0;

  if (!user) return null;
  if (!canUse) return <Card><p className="text-sm text-muted">This page is for the Parent Stock Manager and Admin.</p></Card>;

  const firstName = user.name.split(" ")[0] || user.name;

  return (
    <div className="space-y-5">
      <h1 className="text-lg font-bold text-ink">Hey {firstName} — <span className="font-normal text-muted">breeder farm at a glance</span></h1>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Male birds" value={males.birds.toLocaleString()} />
        <StatTile label="Female birds" value={females.birds.toLocaleString()} />
        <StatTile label="Male flocks" value={String(males.flocks)} />
        <StatTile label="Female flocks" value={String(females.flocks)} />
        <StatTile label="M : F ratio" value={mfRatio ? `1 : ${(1 / mfRatio).toFixed(1)}` : "—"} tone="gold" />
        <StatTile label="In production" value={String(inProduction)} tone="green" />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader title="Male breeder summary" action={<Link href="/parent-stock/males" className="text-sm font-semibold text-gold-dark underline">Manage</Link>} />
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Birds" value={males.birds.toLocaleString()} />
            <StatTile label="Active flocks" value={String(males.flocks)} />
            <StatTile label="Avg body weight" value={(() => { const w = avgBodyWeight(active.filter((f) => f.sex === "Male")); return w ? `${w.toLocaleString()} g` : "—"; })()} />
            <StatTile label="Depleted flocks" value={String(flocks.filter((f) => f.sex === "Male" && f.stage === "Depleted").length)} />
          </div>
        </Card>
        <Card>
          <CardHeader title="Female breeder summary" action={<Link href="/parent-stock/females" className="text-sm font-semibold text-gold-dark underline">Manage</Link>} />
          <div className="grid grid-cols-2 gap-3">
            <StatTile label="Birds" value={females.birds.toLocaleString()} />
            <StatTile label="Active flocks" value={String(females.flocks)} />
            <StatTile label="In lay" value={String(inLay)} tone="green" />
            <StatTile label="Avg body weight" value={(() => { const w = avgBodyWeight(active.filter((f) => f.sex === "Female")); return w ? `${w.toLocaleString()} g` : "—"; })()} />
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader title={`Active flocks (${active.length})`} />
        <TableWrap>
          <thead><tr><Th>Flock</Th><Th>Sex</Th><Th>Breed</Th><Th>House</Th><Th className="text-right">Age</Th><Th className="text-right">Birds</Th><Th className="text-right">Depletion</Th><Th>Stage</Th></tr></thead>
          <tbody>
            {active.length === 0 ? <EmptyRow colSpan={8} text="No active flocks yet — add breeder flocks to begin." /> : active.map((f) => (
              <tr key={f.id}>
                <Td className="font-medium">{f.code}</Td>
                <Td>{f.sex}</Td>
                <Td>{f.breed}</Td>
                <Td>{f.house || "—"}</Td>
                <Td className="text-right">{(() => { const a = ageWeeks(f, today); return a === null ? "—" : `${a} wk`; })()}</Td>
                <Td className="text-right">{f.currentPopulation.toLocaleString()}</Td>
                <Td className="text-right">{depletionPct(f)}%</Td>
                <Td>{f.laying ? <Pill tone="green">In lay</Pill> : <Pill tone={f.stage === "Production" ? "green" : "info"}>{f.stage}</Pill>}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <p className="text-xs text-muted">Daily mortality, feed &amp; water, egg production, male transfers, production houses, health, costing and reports are coming to this workspace.</p>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { Card, CardHeader } from "@/components/ui/Card";
import { Pill } from "@/components/ui/Pill";
import { Kpi } from "@/components/dashboard/Kpi";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { formatDate, formatDateTime } from "@/lib/format";
import { computeKpis, stepLabel, isMachineOverTemp } from "@/lib/hatchery/lifecycle";

export default function HatcheryDashboard() {
  const { user } = useAuth();
  const { loading, batches, inventory, readings, maintenance, allocations } = useHatchery();

  const kpis = useMemo(() => computeKpis(batches, inventory), [batches, inventory]);
  const downtime = useMemo(
    () => maintenance.reduce((s, m) => s + (m.downtimeHours ?? 0), 0),
    [maintenance]
  );
  const pendingApprovals = allocations.filter(
    (a) => a.status === "proposed" || a.status === "finalized"
  ).length;

  const alerts = useMemo(
    () =>
      readings
        .filter((r) => isMachineOverTemp(r.dryF, r.wetF, r.digitalTempF))
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        .slice(0, 6),
    [readings]
  );

  const recentBatches = useMemo(
    () => batches.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 12),
    [batches]
  );

  if (!user) return null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Hatchery</h1>
        <Pill tone="gold">{user.role}</Pill>
      </div>

      {loading ? (
        <Card><p className="text-sm text-muted">Loading hatchery data…</p></Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-5">
            <Kpi label="Active batches" value={String(kpis.activeBatches)} />
            <Kpi label="Eggs set" value={kpis.eggsSet.toLocaleString()} />
            <Kpi label="Chicks hatched" value={kpis.chicksHatched.toLocaleString()} tone="green" />
            <Kpi label="Hatchability" value={`${kpis.hatchability.toFixed(0)}%`} tone="gold" />
            <Kpi label="Available chicks" value={kpis.saleableAvailable.toLocaleString()} tone="green" />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Equipment downtime (h)" value={downtime.toFixed(1)} tone={downtime > 0 ? "red" : "default"} />
            <Kpi label="Pending allocation approvals" value={String(pendingApprovals)} tone={pendingApprovals ? "gold" : "default"} />
            <Kpi label="Over-temp readings" value={String(alerts.length)} tone={alerts.length ? "red" : "default"} />
            <Kpi label="Batches (total)" value={String(batches.length)} />
          </div>

          {alerts.length > 0 && (
            <Card>
              <CardHeader title="Recent over-temperature readings" />
              <div className="space-y-1.5 text-sm">
                {alerts.map((r) => (
                  <div key={r.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-red/30 bg-red-bg px-3 py-2">
                    <span>{r.machineCode} · {r.operator}</span>
                    <span className="text-red">dry {r.dryF}°F · wet {r.wetF}°F · digital {r.digitalTempF}°F · {formatDateTime(r.timestamp)}</span>
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Batches" />
            <TableWrap>
              <thead>
                <tr>
                  <Th>Batch</Th>
                  <Th>Product</Th>
                  <Th>Farm / flock</Th>
                  <Th>Step</Th>
                  <Th className="text-right">Eggs set</Th>
                  <Th className="text-right">Hatched</Th>
                  <Th className="text-right">Saleable</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {recentBatches.length === 0 ? (
                  <EmptyRow colSpan={8} text="No batches yet." />
                ) : (
                  recentBatches.map((b) => (
                    <tr key={b.id}>
                      <Td>
                        <Link href={`/hatchery/batches/${b.id}`} className="text-gold-dark underline underline-offset-2">
                          {b.batchNo}
                        </Link>
                      </Td>
                      <Td>{b.productType}</Td>
                      <Td>{b.farm} · {b.flockId}</Td>
                      <Td>{stepLabel(b.currentStep)}</Td>
                      <Td className="text-right">{b.eggsSet.toLocaleString()}</Td>
                      <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
                      <Td className="text-right">{b.saleableCount.toLocaleString()}</Td>
                      <Td>
                        <Pill tone={b.status === "delivered" ? "fulfilled" : b.status === "dispatched" ? "gold" : "info"}>
                          {b.status}
                        </Pill>
                      </Td>
                    </tr>
                  ))
                )}
              </tbody>
            </TableWrap>
          </Card>
        </>
      )}
    </div>
  );
}

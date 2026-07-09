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
import { computeKpis, isOutOfRange, stepLabel } from "@/lib/hatchery/lifecycle";

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
        .filter((r) => {
          const f = isOutOfRange(r.machineId, r.temp, r.humidity);
          return f.temp || f.humidity;
        })
        .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        .slice(0, 6),
    [readings]
  );

  const batchNo = (id: string) => batches.find((b) => b.id === id)?.batchNo ?? id;

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
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Kpi label="Active batches" value={String(kpis.activeBatches)} />
            <Kpi label="Eggs set" value={kpis.eggsSet.toLocaleString()} />
            <Kpi label="Chicks hatched" value={kpis.chicksHatched.toLocaleString()} tone="green" />
            <Kpi label="Hatchability" value={`${kpis.hatchability.toFixed(0)}%`} tone="gold" />
            <Kpi label="Grade A" value={`${kpis.gradeA.toFixed(0)}%`} tone="gold" />
            <Kpi label="Available chicks" value={kpis.sellableAvailable.toLocaleString()} tone="green" />
          </div>

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <Kpi label="Equipment downtime (h)" value={downtime.toFixed(1)} tone={downtime > 0 ? "red" : "default"} />
            <Kpi label="Pending allocation approvals" value={String(pendingApprovals)} tone={pendingApprovals ? "gold" : "default"} />
            <Kpi label="Out-of-range alerts" value={String(alerts.length)} tone={alerts.length ? "red" : "default"} />
            <Kpi label="Batches (total)" value={String(batches.length)} />
          </div>

          {alerts.length > 0 && (
            <Card>
              <CardHeader title="Recent out-of-range readings" />
              <div className="space-y-1.5 text-sm">
                {alerts.map((r) => (
                  <div key={r.id} className="flex flex-wrap justify-between gap-2 rounded-md border border-red/30 bg-red-bg px-3 py-2">
                    <span>{batchNo(r.batchId)} · {r.machineId}</span>
                    <span className="text-red">{r.temp}°C · {r.humidity}% · {formatDateTime(r.timestamp)}</span>
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
                  <Th>Set</Th>
                  <Th>Step</Th>
                  <Th className="text-right">Eggs</Th>
                  <Th className="text-right">Hatched</Th>
                  <Th className="text-right">Sellable</Th>
                  <Th>Status</Th>
                </tr>
              </thead>
              <tbody>
                {batches.length === 0 ? (
                  <EmptyRow colSpan={8} text="No batches yet." />
                ) : (
                  batches
                    .slice()
                    .sort((a, b) => (a.setDate < b.setDate ? 1 : -1))
                    .slice(0, 12)
                    .map((b) => (
                      <tr key={b.id}>
                        <Td>
                          <Link href={`/hatchery/batches/${b.id}`} className="text-gold-dark underline underline-offset-2">
                            {b.batchNo}
                          </Link>
                        </Td>
                        <Td>{b.productType}</Td>
                        <Td>{formatDate(b.setDate)}</Td>
                        <Td>{stepLabel(b.currentStep)}</Td>
                        <Td className="text-right">{b.eggCount.toLocaleString()}</Td>
                        <Td className="text-right">{b.hatchedCount.toLocaleString()}</Td>
                        <Td className="text-right">{b.sellableCount.toLocaleString()}</Td>
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

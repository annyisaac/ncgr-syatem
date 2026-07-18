"use client";

import { useMemo } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card } from "@/components/ui/Card";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { GreetingHeader, StatTile } from "@/components/dashboard/DashKit";
import { formatDate } from "@/lib/format";

export default function FarmVisitsPage() {
  const { user } = useAuth();
  const { dsrVisits, dsrs } = useData();

  // A Tetra Zone Manager (or the checker acting as one) sees only their zone's
  // DSR visits; Admin sees all.
  const rows = useMemo(() => {
    if (!user) return [];
    const zoneOf = new Map(dsrs.map((d) => [d.id, d.zone]));
    const nameOf = new Map(dsrs.map((d) => [d.id, d.name]));
    const scoped = user.role === "Admin"
      ? dsrVisits
      : dsrVisits.filter((v) => zoneOf.get(v.dsrId) === user.zone);
    return scoped
      .slice()
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .map((v) => ({ ...v, dsrName: nameOf.get(v.dsrId) ?? v.by }));
  }, [dsrVisits, dsrs, user]);

  if (!user) return null;

  const uniqueFarms = new Set(rows.map((v) => v.farm.trim().toLowerCase())).size;

  return (
    <div className="space-y-5">
      <GreetingHeader name={user.name} subtitle="farm visit reports" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Visits logged" value={String(rows.length)} />
        <StatTile label="Farms visited" value={String(uniqueFarms)} />
        <StatTile label="DSRs reporting" value={String(new Set(rows.map((v) => v.dsrId)).size)} />
      </div>

      <Card>
        <TableWrap>
          <thead>
            <tr>
              <Th>Date</Th><Th>DSR</Th><Th>Farm / client</Th>
              <Th>Phone</Th><Th>Purpose</Th><Th>Notes</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={6} text="No farm visits logged yet." />
            ) : rows.map((v) => (
              <tr key={v.id}>
                <Td className="whitespace-nowrap text-muted">{formatDate(v.date)}</Td>
                <Td className="font-medium">{v.dsrName}</Td>
                <Td>{v.farm}</Td>
                <Td className="text-muted">{v.phone || "—"}</Td>
                <Td>{v.purpose}</Td>
                <Td className="max-w-[18rem] text-sm text-muted">{v.notes}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import { availableFor, type Availability } from "@/lib/types";

const CAN_MANAGE = ["Admin"];

export default function AvailabilityPage() {
  const { user } = useAuth();
  const { availability, orders, upsertAvailability } = useData();
  const { toast } = useToast();

  const [date, setDate] = useState(todayISO());
  const [ross, setRoss] = useState("");
  const [tetra, setTetra] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const rows = useMemo(() => availability.slice().sort((a, b) => (a.date < b.date ? 1 : -1)), [availability]);

  if (!user) return null;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!date) return setErr("Choose a date.");
    const r = Number(ross) || 0;
    const t = Number(tetra) || 0;
    if (r <= 0 && t <= 0) return setErr("Enter available chicks for at least one product.");
    const existing = availability.find((a) => a.id === date);
    const rec: Availability = { id: date, date, ross: r, tetra: t, by: user!.email, on: nowISO() };
    upsertAvailability(rec);
    toast(`${existing ? "Updated" : "Opened"} ${formatDate(date)} — Ross ${r.toLocaleString()}, Tetra ${t.toLocaleString()}.`);
    setRoss(""); setTetra("");
  }

  function editRow(a: Availability) {
    setDate(a.date); setRoss(String(a.ross)); setTetra(String(a.tetra));
  }

  return (
    <div className="space-y-5">
      <p className="-mt-2 text-sm text-muted">
        Open the delivery dates on which orders can be placed and set how many chicks are available per product.
        Zone managers see the remaining numbers; DSRs only see that a date is open.
      </p>

      {canManage && (
        <Card>
          <CardHeader title="Open / update a date" />
          <form onSubmit={save} className="flex flex-wrap items-end gap-3">
            <Field label="Delivery date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
            <Field label="Ross 308 chicks"><Input type="number" min={0} value={ross} onChange={(e) => setRoss(e.target.value)} /></Field>
            <Field label="Tetra Super Harco chicks"><Input type="number" min={0} value={tetra} onChange={(e) => setTetra(e.target.value)} /></Field>
            <Button type="submit">Save availability</Button>
            {err && <p className="w-full text-sm text-status-refunded">{err}</p>}
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length} open date(s)`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Date</Th>
              <Th className="text-right">Ross available</Th><Th className="text-right">Ross left</Th>
              <Th className="text-right">Tetra available</Th><Th className="text-right">Tetra left</Th>
              {canManage && <Th></Th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <EmptyRow colSpan={canManage ? 6 : 5} text="No ordering dates opened yet." />
            ) : rows.map((a) => {
              const rossLeft = availableFor(a, "Ross 308", orders);
              const tetraLeft = availableFor(a, "Tetra Super Harco", orders);
              return (
                <tr key={a.id}>
                  <Td className="font-medium">{formatDate(a.date)}</Td>
                  <Td className="text-right">{a.ross.toLocaleString()}</Td>
                  <Td className="text-right">{a.ross > 0 ? <Pill tone={rossLeft > 0 ? "green" : "red"}>{rossLeft.toLocaleString()}</Pill> : <span className="text-muted">—</span>}</Td>
                  <Td className="text-right">{a.tetra.toLocaleString()}</Td>
                  <Td className="text-right">{a.tetra > 0 ? <Pill tone={tetraLeft > 0 ? "green" : "red"}>{tetraLeft.toLocaleString()}</Pill> : <span className="text-muted">—</span>}</Td>
                  {canManage && <Td><Button size="sm" variant="ghost" onClick={() => editRow(a)}>Edit</Button></Td>}
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, formatDate } from "@/lib/format";
import type { Operator } from "@/lib/hatchery/types";

const CAN_MANAGE = ["Admin", "Hatchery Manager"];

function genOperatorCode(existing: Operator[]): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "OP-" + Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
  } while (existing.some((o) => o.code === code));
  return code;
}

export default function OperatorsPage() {
  const { user } = useAuth();
  const { operators, upsertOperator, newId } = useHatchery();
  const { toast } = useToast();

  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const rows = useMemo(
    () => operators.slice().sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1)),
    [operators]
  );

  if (!user) return null;

  if (!canManage) {
    return (
      <Card>
        <p className="text-sm text-muted">Only the Admin and Hatchery Manager can manage hatchery attendants.</p>
      </Card>
    );
  }

  function register(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr("Enter the attendant's name.");
    if (operators.some((o) => o.name.toLowerCase() === name.trim().toLowerCase() && o.active)) return setErr("That attendant already exists.");
    const op: Operator = { id: newId("op"), name: name.trim(), code: genOperatorCode(operators), active: true, by: user!.email, on: nowISO() };
    upsertOperator(op);
    toast(`${op.name} registered — code ${op.code}.`);
    setName("");
  }

  const activeCount = operators.filter((o) => o.active).length;

  return (
    <div className="space-y-5">
      <div>
        <p className="mt-1 text-sm text-muted">
          Attendants share one tablet login. Register each person here; they enter their code on the tablet to prove who they are, and everything they record is logged under their name.
        </p>
      </div>

      <Card>
        <CardHeader title="Register an attendant" />
        <form onSubmit={register} className="flex flex-wrap items-end gap-3">
          <Field label="Attendant name"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. John Uwera" /></Field>
          <Button type="submit">Register &amp; generate code</Button>
          {err && <p className="w-full text-sm text-status-refunded">{err}</p>}
        </form>
      </Card>

      <Card>
        <CardHeader title={`${activeCount} active attendant(s)`} />
        <TableWrap>
          <thead><tr><Th>Name</Th><Th>Code</Th><Th>Registered</Th><Th>Status</Th><Th>Action</Th></tr></thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={5} text="No attendants registered yet." /> : rows.map((o) => (
              <tr key={o.id}>
                <Td className="font-medium">{o.name}</Td>
                <Td><span className="rounded bg-cream px-2 py-0.5 font-mono text-sm">{o.code}</span></Td>
                <Td>{formatDate(o.on)}</Td>
                <Td>{o.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Inactive</Pill>}</Td>
                <Td>
                  {o.active
                    ? <Button size="sm" variant="ghost" onClick={() => upsertOperator({ ...o, active: false })}>Deactivate</Button>
                    : <Button size="sm" variant="ghost" onClick={() => upsertOperator({ ...o, active: true })}>Reactivate</Button>}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

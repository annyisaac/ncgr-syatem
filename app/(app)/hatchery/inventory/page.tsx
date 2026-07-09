"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO, formatDateTime } from "@/lib/format";
import type { Supply, SupplyKind } from "@/lib/hatchery/types";

const CAN_MANAGE = ["Admin", "Hatchery Manager", "Operations Manager", "Hatchery Operations Manager", "Production Technician"];

export default function InventoryPage() {
  const { user } = useAuth();
  const { supplies, upsertSupply, newId } = useHatchery();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [f, setF] = useState({ kind: "box" as SupplyKind, name: "", unit: "boxes", quantity: "" });
  const [adjust, setAdjust] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const boxes = useMemo(() => supplies.filter((s) => s.kind === "box"), [supplies]);
  const vaccines = useMemo(() => supplies.filter((s) => s.kind === "vaccine"), [supplies]);

  if (!user) return null;

  function addSupply(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.name.trim()) return setErr("Enter a name.");
    const qty = Number(f.quantity) || 0;
    const on = nowISO();
    const s: Supply = {
      id: newId("sup"), kind: f.kind, name: f.name.trim(),
      unit: f.unit.trim() || (f.kind === "box" ? "boxes" : "doses"),
      quantity: qty, history: [`${on} — created with ${qty} by ${user!.name}`], by: user!.email, on,
    };
    upsertSupply(s);
    toast(`${s.name} added.`);
    setShowAdd(false); setF({ kind: "box", name: "", unit: "boxes", quantity: "" });
  }

  function restock(s: Supply) {
    const delta = Number(adjust[s.id]) || 0;
    if (delta === 0) return;
    const on = nowISO();
    const next: Supply = {
      ...s, quantity: Math.max(0, s.quantity + delta),
      history: [...s.history, `${on} — ${delta > 0 ? "+" : ""}${delta} by ${user!.name}`], on,
    };
    upsertSupply(next);
    toast(`${s.name} updated (${delta > 0 ? "+" : ""}${delta}).`);
    setAdjust({ ...adjust, [s.id]: "" });
  }

  const renderTable = (title: string, list: Supply[]) => (
    <Card>
      <CardHeader title={title} />
      <TableWrap>
        <thead><tr><Th>Name</Th><Th className="text-right">In stock</Th><Th>Unit</Th>{canManage && <Th>Adjust (+/−)</Th>}<Th>Updated</Th></tr></thead>
        <tbody>
          {list.length === 0 ? <EmptyRow colSpan={canManage ? 5 : 4} text="Nothing in stock." /> : list.map((s) => (
            <tr key={s.id}>
              <Td className="font-medium">{s.name}</Td>
              <Td className="text-right">{s.quantity.toLocaleString()} {s.quantity < 50 && <Pill tone="gold">low</Pill>}</Td>
              <Td>{s.unit}</Td>
              {canManage && (
                <Td>
                  <div className="flex items-center gap-2">
                    <input type="number" value={adjust[s.id] ?? ""} onChange={(e) => setAdjust({ ...adjust, [s.id]: e.target.value })}
                      className="w-20 rounded-md border border-line bg-transparent px-2 py-1 text-sm" placeholder="±" />
                    <Button variant="secondary" onClick={() => restock(s)}>Apply</Button>
                  </div>
                </Td>
              )}
              <Td className="text-xs text-muted">{formatDateTime(s.on)}</Td>
            </tr>
          ))}
        </tbody>
      </TableWrap>
    </Card>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Inventory</h1>
        {canManage && <Button onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Hide" : "Add supply"}</Button>}
      </div>

      {showAdd && canManage && (
        <Card>
          <CardHeader title="Add supply" />
          <form onSubmit={addSupply} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <Field label="Kind"><Select value={f.kind} onChange={(e) => { const kind = e.target.value as SupplyKind; setF({ ...f, kind, unit: kind === "box" ? "boxes" : "doses" }); }} options={[{ value: "box", label: "Unassembled boxes" }, { value: "vaccine", label: "Vaccine" }]} /></Field>
            <Field label="Name"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder={f.kind === "box" ? "Chick box" : "e.g. Marek's"} /></Field>
            <Field label="Unit"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
            <Field label="Quantity"><Input type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
            {err && <p className="sm:col-span-4 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-4 flex justify-end"><Button type="submit">Save</Button></div>
          </form>
        </Card>
      )}

      {renderTable("Boxes (unassembled)", boxes)}
      {renderTable("Vaccines", vaccines)}
    </div>
  );
}

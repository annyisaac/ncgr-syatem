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
import { PRODUCTS, type Product } from "@/lib/types";
import { nowISO, todayISO, formatDate } from "@/lib/format";
import type { FarmVisit } from "@/lib/hatchery/types";

const CAN_ADD = ["Admin", "Hatchery Veterinary"];
const CAN_FORWARD = ["Admin", "Hatchery Veterinary"];

const num = (v: string) => Number(v) || 0;

export default function FarmVisitsPage() {
  const { user } = useAuth();
  const { farmVisits, upsertFarmVisit, newId } = useHatchery();
  const { toast } = useToast();

  const [show, setShow] = useState(false);
  const [f, setF] = useState({
    date: todayISO(), customerName: "", product: "Tetra Super Harco" as Product,
    chicksBought: "", mortality7Day: "", mortalityAfter7Day: "",
    cause: "", problem: "", solution: "", hatcheryCaused: "no",
  });
  const [err, setErr] = useState<string | null>(null);

  const canAdd = !!user && CAN_ADD.includes(user.role);
  const canForward = !!user && CAN_FORWARD.includes(user.role);
  const rows = useMemo(() => farmVisits.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [farmVisits]);

  if (!user) return null;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.customerName.trim()) return setErr("Enter the customer name.");
    if (num(f.chicksBought) <= 0) return setErr("Enter the number of chicks bought.");
    const on = nowISO();
    const rec: FarmVisit = {
      id: newId("visit"), date: f.date, customerName: f.customerName.trim(), product: f.product,
      chicksBought: num(f.chicksBought), mortality7Day: num(f.mortality7Day), mortalityAfter7Day: num(f.mortalityAfter7Day),
      cause: f.cause.trim(), problem: f.problem.trim(), solution: f.solution.trim(),
      hatcheryCaused: f.hatcheryCaused === "yes", sentToSales: false,
      by: user!.email, on, history: [`${on} — Visit recorded (by ${user!.name})`],
    };
    upsertFarmVisit(rec);
    toast(`Farm visit for ${rec.customerName} recorded.`);
    setShow(false);
    setF({ ...f, customerName: "", chicksBought: "", mortality7Day: "", mortalityAfter7Day: "", cause: "", problem: "", solution: "", hatcheryCaused: "no" });
  }

  function sendToSales(v: FarmVisit) {
    upsertFarmVisit({ ...v, sentToSales: true, history: [...v.history, `${nowISO()} — Report sent to sales for ${v.product} compensation (by ${user!.name})`] });
    toast(`Report sent to sales for ${v.product} compensation.`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Farm Visits</h1>
        {canAdd && <Button onClick={() => setShow((v) => !v)}>{show ? "Hide form" : "Record visit"}</Button>}
      </div>

      {show && canAdd && (
        <Card>
          <CardHeader title="Record a farm visit" />
          <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Customer name"><Input value={f.customerName} onChange={(e) => setF({ ...f, customerName: e.target.value })} /></Field>
            <Field label="Product"><Select value={f.product} onChange={(e) => setF({ ...f, product: e.target.value as Product })} options={PRODUCTS.map((p) => ({ value: p, label: p }))} /></Field>
            <Field label="Chicks bought"><Input type="number" value={f.chicksBought} onChange={(e) => setF({ ...f, chicksBought: e.target.value })} /></Field>
            <Field label="Date of visit"><Input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            <Field label="Mortality — within 7 days"><Input type="number" value={f.mortality7Day} onChange={(e) => setF({ ...f, mortality7Day: e.target.value })} /></Field>
            <Field label="Mortality — after 7 days"><Input type="number" value={f.mortalityAfter7Day} onChange={(e) => setF({ ...f, mortalityAfter7Day: e.target.value })} /></Field>
            <div className="sm:col-span-2"><Field label="Investigated cause of death"><Input value={f.cause} onChange={(e) => setF({ ...f, cause: e.target.value })} placeholder="What caused the deaths?" /></Field></div>
            <div className="sm:col-span-2"><Field label="Problem"><Input value={f.problem} onChange={(e) => setF({ ...f, problem: e.target.value })} /></Field></div>
            <div className="sm:col-span-2"><Field label="Suggested solution"><Input value={f.solution} onChange={(e) => setF({ ...f, solution: e.target.value })} /></Field></div>
            <Field label="Caused by a hatchery problem?" hint="If yes, the report can be sent to sales for compensation.">
              <Select value={f.hatcheryCaused} onChange={(e) => setF({ ...f, hatcheryCaused: e.target.value })} options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes — hatchery problem" }]} />
            </Field>
            {err && <p className="sm:col-span-2 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShow(false)}>Cancel</Button>
              <Button type="submit">Save visit</Button>
            </div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length} visit(s)`} />
        <TableWrap>
          <thead>
            <tr>
              <Th>Date</Th><Th>Customer</Th><Th>Product</Th><Th className="text-right">Chicks</Th>
              <Th className="text-right">≤7d deaths</Th><Th className="text-right">&gt;7d deaths</Th>
              <Th>Cause / problem</Th><Th>Hatchery?</Th><Th>Compensation</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={9} text="No farm visits recorded yet." /> : rows.map((v) => (
              <tr key={v.id}>
                <Td>{formatDate(v.date)}</Td>
                <Td className="font-medium">{v.customerName}</Td>
                <Td><Pill tone={v.product === "Ross 308" ? "ross" : "tetra"}>{v.product}</Pill></Td>
                <Td className="text-right">{v.chicksBought.toLocaleString()}</Td>
                <Td className="text-right">{v.mortality7Day.toLocaleString()}</Td>
                <Td className="text-right">{v.mortalityAfter7Day.toLocaleString()}</Td>
                <Td className="max-w-[240px]">
                  <div className="text-sm">{v.cause || "—"}</div>
                  {v.problem && <div className="text-xs text-muted">Problem: {v.problem}</div>}
                  {v.solution && <div className="text-xs text-muted">Solution: {v.solution}</div>}
                </Td>
                <Td>{v.hatcheryCaused ? <Pill tone="red">Hatchery</Pill> : <Pill tone="neutral">No</Pill>}</Td>
                <Td>
                  {!v.hatcheryCaused ? (
                    <span className="text-xs text-muted">—</span>
                  ) : v.sentToSales ? (
                    <Pill tone="green">Sent to sales</Pill>
                  ) : canForward ? (
                    <Button size="sm" onClick={() => sendToSales(v)}>Send to sales</Button>
                  ) : (
                    <Pill tone="gold">Pending</Pill>
                  )}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
        <p className="mt-2 text-xs text-muted">
          Hatchery-caused deaths are sent to sales so the Ross or Tetra salesperson can arrange the customer&apos;s compensation.
        </p>
      </Card>
    </div>
  );
}

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
import { nowISO, todayISO, formatDate } from "@/lib/format";
import type { Supply, VaccineRequest, VaccineRequestStatus } from "@/lib/hatchery/types";

const CAN_REQUEST = ["Admin", "Hatchery Veterinary"];
const CAN_CONFIRM = ["Admin", "Operations Manager"];
const CAN_FULFILL = ["Admin", "Hatchery Manager"];

const statusTone: Record<VaccineRequestStatus, "gold" | "info" | "green" | "red"> = {
  requested: "gold", confirmed: "info", sent: "green", declined: "red",
};

export default function VaccineRequestsPage() {
  const { user } = useAuth();
  const { vaccineRequests, supplies, upsertVaccineRequest, upsertSupply, newId } = useHatchery();
  const { toast } = useToast();

  const [f, setF] = useState({ vaccine: "", quantity: "", unit: "doses", reason: "", date: todayISO() });
  const [err, setErr] = useState<string | null>(null);

  const role = user?.role;
  const canRequest = !!role && CAN_REQUEST.includes(role);
  const canConfirm = !!role && CAN_CONFIRM.includes(role);
  const canFulfill = !!role && CAN_FULFILL.includes(role);

  const rows = useMemo(() => vaccineRequests.slice().sort((a, b) => (a.on < b.on ? 1 : -1)), [vaccineRequests]);

  if (!user) return null;

  function request(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!f.vaccine.trim()) return setErr("Enter the vaccine name.");
    if (Number(f.quantity) <= 0) return setErr("Enter the quantity needed.");
    const on = nowISO();
    const rec: VaccineRequest = {
      id: newId("vreq"), date: f.date, vaccine: f.vaccine.trim(), quantity: Number(f.quantity),
      unit: f.unit.trim() || "doses", reason: f.reason.trim() || undefined, status: "requested",
      requestedBy: user!.email, by: user!.email, on,
      history: [`${on} — Requested ${f.quantity} ${f.unit} of ${f.vaccine.trim()} (by ${user!.name})`],
    };
    upsertVaccineRequest(rec);
    toast(`Requested ${rec.quantity} ${rec.unit} of ${rec.vaccine}.`);
    setF({ ...f, vaccine: "", quantity: "", reason: "" });
  }

  function setStatus(r: VaccineRequest, status: VaccineRequestStatus, note: string, extra: Partial<VaccineRequest> = {}) {
    upsertVaccineRequest({ ...r, status, ...extra, history: [...r.history, `${nowISO()} — ${note} (by ${user!.name})`] });
    toast(note + ".");
  }

  function fulfill(r: VaccineRequest) {
    // Add the received vaccine to inventory (increment existing or create).
    const on = nowISO();
    const existing = supplies.find((s) => s.kind === "vaccine" && s.name.toLowerCase() === r.vaccine.toLowerCase());
    if (existing) {
      upsertSupply({ ...existing, quantity: existing.quantity + r.quantity, history: [...existing.history, `${on} — +${r.quantity} received from request by ${user!.name}`], on });
    } else {
      const s: Supply = { id: newId("sup"), kind: "vaccine", name: r.vaccine, unit: r.unit, quantity: r.quantity, history: [`${on} — created with ${r.quantity} from request by ${user!.name}`], by: user!.email, on };
      upsertSupply(s);
    }
    setStatus(r, "sent", `Received & added ${r.quantity} ${r.unit} to inventory`, { sentBy: user!.email });
  }

  return (
    <div className="space-y-5">
      <h1 className="section-heading text-lg">Vaccine Requests</h1>
      <p className="-mt-2 text-sm text-muted">
        The vet requests a vaccine → the Operations Manager confirms → the Hatchery Manager receives it and adds it to inventory.
      </p>

      {canRequest && (
        <Card>
          <CardHeader title="Request a vaccine to be bought" />
          <form onSubmit={request} className="grid grid-cols-1 gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2"><Field label="Vaccine"><Input value={f.vaccine} onChange={(e) => setF({ ...f, vaccine: e.target.value })} placeholder="e.g. Marek's" /></Field></div>
            <Field label="Quantity"><Input type="number" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /></Field>
            <Field label="Unit"><Input value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} /></Field>
            <div className="sm:col-span-4"><Field label="Reason (optional)"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field></div>
            {err && <p className="sm:col-span-4 text-sm text-status-refunded">{err}</p>}
            <div className="sm:col-span-4 flex justify-end"><Button type="submit">Send request</Button></div>
          </form>
        </Card>
      )}

      <Card>
        <CardHeader title={`${rows.length} request(s)`} />
        <TableWrap>
          <thead>
            <tr><Th>Date</Th><Th>Vaccine</Th><Th className="text-right">Qty</Th><Th>Requested by</Th><Th>Status</Th><Th>Action</Th></tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <EmptyRow colSpan={6} text="No vaccine requests yet." /> : rows.map((r) => (
              <tr key={r.id}>
                <Td>{formatDate(r.date)}</Td>
                <Td className="font-medium">{r.vaccine}{r.reason && <span className="block text-xs text-muted">{r.reason}</span>}</Td>
                <Td className="text-right">{r.quantity.toLocaleString()} {r.unit}</Td>
                <Td>{r.requestedBy}</Td>
                <Td><Pill tone={statusTone[r.status]}>{r.status}</Pill></Td>
                <Td>
                  <div className="flex flex-wrap gap-1">
                    {r.status === "requested" && canConfirm && (
                      <>
                        <Button size="sm" onClick={() => setStatus(r, "confirmed", "Confirmed — sent to Hatchery Manager", { confirmedBy: user!.email })}>Confirm</Button>
                        <Button size="sm" variant="ghost" onClick={() => setStatus(r, "declined", "Declined request")}>Decline</Button>
                      </>
                    )}
                    {r.status === "confirmed" && canFulfill && (
                      <Button size="sm" onClick={() => fulfill(r)}>Mark received</Button>
                    )}
                    {(r.status === "sent" || r.status === "declined") && <span className="text-xs text-muted">—</span>}
                    {r.status === "requested" && !canConfirm && <span className="text-xs text-muted">Awaiting Operations Manager</span>}
                    {r.status === "confirmed" && !canFulfill && <span className="text-xs text-muted">Awaiting Hatchery Manager</span>}
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

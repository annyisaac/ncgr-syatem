"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { todayISO, nowISO, formatDate } from "@/lib/format";
import type { DsrVisit } from "@/lib/types";

const PURPOSES = [
  "Delivery follow-up",
  "New customer",
  "Payment collection",
  "Complaint / issue",
  "Routine check",
  "Other",
];

export default function DsrVisitsPage() {
  const { user } = useAuth();
  const { dsrs, dsrVisits, orders, upsertDsrVisit, newId } = useData();
  const { toast } = useToast();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);
  const myVisits = useMemo(
    () =>
      dsrVisits
        .filter((v) => v.by?.toLowerCase() === user?.email.toLowerCase())
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [dsrVisits, user]
  );

  // Customers already known in this zone — so the farm name can be picked
  // instead of retyped, and the phone fills itself in.
  const zoneClients = useMemo(() => {
    const map = new Map<string, string>();
    if (!myDsr) return map;
    for (const o of orders) {
      if (o.zone !== myDsr.zone) continue;
      if (!map.has(o.name)) map.set(o.name, o.phone);
    }
    return map;
  }, [orders, myDsr]);

  const [farm, setFarm] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(todayISO());
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [q, setQ] = useState("");

  const month = todayISO().slice(0, 7);
  const monthCount = myVisits.filter((v) => v.date.slice(0, 7) === month).length;

  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return myVisits;
    return myVisits.filter(
      (v) =>
        v.farm.toLowerCase().includes(s) ||
        v.purpose.toLowerCase().includes(s) ||
        (v.notes ?? "").toLowerCase().includes(s)
    );
  }, [myVisits, q]);

  if (!user) return null;
  if (!myDsr) return <Card><p className="text-sm text-muted">Your DSR profile could not be found.</p></Card>;

  /** Picking a known customer fills their phone in (only while it's empty). */
  function onFarmChange(value: string) {
    setFarm(value);
    const known = zoneClients.get(value);
    if (known && !phone.trim()) setPhone(known);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!farm.trim()) return setErr("Enter the farm / customer name.");
    if (!date) return setErr("Choose the visit date.");
    if (date > todayISO()) return setErr("A visit can't be logged for a future date.");
    setSaving(true);
    const visit: DsrVisit = {
      id: newId("visit"),
      dsrId: myDsr!.id,
      by: user!.email,
      farm: farm.trim(),
      phone: phone.trim() || undefined,
      date,
      purpose,
      notes: notes.trim(),
      createdAt: nowISO(),
    };
    try {
      await upsertDsrVisit(visit);
      setFarm(""); setPhone(""); setNotes(""); setDate(todayISO()); setPurpose(PURPOSES[0]);
      toast("Farm visit logged.");
    } catch {
      setErr("Could not save the visit. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <p className="-mt-2 text-sm text-muted">
        Log the farms you visit so your work is tracked — <strong className="text-ink">{monthCount}</strong> visit(s) this month.
      </p>

      <Card>
        <CardHeader title="Log a visit" />
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Farm / customer" hint="Pick a known customer or type a new one">
            <Input list="dsr-visit-clients" value={farm} onChange={(e) => onFarmChange(e.target.value)} />
          </Field>
          <datalist id="dsr-visit-clients">
            {Array.from(zoneClients.keys()).map((n) => <option key={n} value={n} />)}
          </datalist>
          <Field label="Phone (optional)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" /></Field>
          <Field label="Date"><Input type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Purpose">
            <Select value={purpose} options={PURPOSES.map((p) => ({ value: p, label: p }))} onChange={(e) => setPurpose(e.target.value)} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes / observations">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                placeholder="What did you find? Chick health, customer feedback, next steps…"
                className="w-full rounded-[9px] border border-line bg-field px-3.5 py-2.5 text-[0.9rem] text-ink focus:outline-none focus-visible:border-gold"
              />
            </Field>
          </div>
          <div className="sm:col-span-2 flex items-center gap-3">
            <Button type="submit" disabled={saving}>{saving ? "Saving…" : "Log visit"}</Button>
            {err && <p className="text-sm text-status-refunded">{err}</p>}
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader title={`${shown.length} visit(s)`} />
        {myVisits.length > 0 && (
          <div className="mb-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search a farm, purpose or note…"
              className="w-full rounded-[9px] border border-line bg-field px-3.5 py-2.5 text-[0.9rem] text-ink focus:outline-none focus-visible:border-gold"
            />
          </div>
        )}
        <TableWrap>
          <thead>
            <tr><Th>Date</Th><Th>Farm / customer</Th><Th>Phone</Th><Th>Purpose</Th><Th>Notes</Th></tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <EmptyRow colSpan={5} text={myVisits.length === 0 ? "No visits logged yet." : "No visits match."} />
            ) : shown.map((v) => (
              <tr key={v.id}>
                <Td>{formatDate(v.date)}</Td>
                <Td className="font-medium">{v.farm}</Td>
                <Td>{v.phone || "—"}</Td>
                <Td>{v.purpose}</Td>
                <Td className="max-w-[24rem] text-muted">{v.notes || "—"}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

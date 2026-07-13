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
  const { dsrs, dsrVisits, upsertDsrVisit, newId } = useData();
  const { toast } = useToast();

  const myDsr = useMemo(() => dsrs.find((d) => d.authEmail === user?.email), [dsrs, user]);
  const myVisits = useMemo(
    () =>
      dsrVisits
        .filter((v) => v.by?.toLowerCase() === user?.email.toLowerCase())
        .sort((a, b) => (a.date < b.date ? 1 : -1)),
    [dsrVisits, user]
  );

  const [farm, setFarm] = useState("");
  const [phone, setPhone] = useState("");
  const [date, setDate] = useState(todayISO());
  const [purpose, setPurpose] = useState(PURPOSES[0]);
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  if (!user) return null;
  if (!myDsr) return <Card><p className="text-sm text-muted">Your DSR profile could not be found.</p></Card>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!farm.trim()) return setErr("Enter the farm / customer name.");
    if (!date) return setErr("Choose the visit date.");
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
      <h1 className="section-heading text-lg">Farm visits</h1>
      <p className="-mt-2 text-sm text-muted">Log the farms you visit so your work is tracked.</p>

      <Card>
        <CardHeader title="Log a visit" />
        <form onSubmit={submit} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Farm / customer"><Input value={farm} onChange={(e) => setFarm(e.target.value)} /></Field>
          <Field label="Phone (optional)"><Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" /></Field>
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
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
        <CardHeader title={`${myVisits.length} visit(s)`} />
        <TableWrap>
          <thead>
            <tr><Th>Date</Th><Th>Farm / customer</Th><Th>Phone</Th><Th>Purpose</Th><Th>Notes</Th></tr>
          </thead>
          <tbody>
            {myVisits.length === 0 ? (
              <EmptyRow colSpan={5} text="No visits logged yet." />
            ) : myVisits.map((v) => (
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

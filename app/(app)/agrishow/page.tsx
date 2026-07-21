"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { StatTile } from "@/components/dashboard/DashKit";
import { formatDateTime } from "@/lib/format";
import {
  createEventLink,
  listEventLinks,
  listEventRegistrations,
  setEventLinkActive,
  type EventLink,
  type EventRegistration,
} from "@/lib/events";

/** "2026-08" → "Aug 2026". Empty/invalid → "". */
function monthLabel(m?: string): string {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return "";
  const [y, mo] = m.split("-");
  const d = new Date(Number(y), Number(mo) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export default function AgrishowPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [links, setLinks] = useState<EventLink[]>([]);
  const [regs, setRegs] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventName, setEventName] = useState("Agrishow 2026");
  const [creating, setCreating] = useState(false);
  const [eventFilter, setEventFilter] = useState("all");

  const isAdmin = user?.role === "Admin";

  const load = useCallback(async () => {
    try {
      const [l, r] = await Promise.all([listEventLinks(), listEventRegistrations()]);
      setLinks(l);
      setRegs(r);
    } catch {
      /* keep whatever we have */
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch — setState lands after the awaited load, off the render path.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const linkUrl = (t: string) => `${origin}/visit/${t}`;

  const eventOptions = useMemo(() => {
    const names = Array.from(new Set(links.map((l) => l.event))).sort();
    return [{ value: "all", label: "All events" }, ...names.map((n) => ({ value: n, label: n }))];
  }, [links]);

  const shownRegs = useMemo(
    () => (eventFilter === "all" ? regs : regs.filter((r) => r.event === eventFilter)),
    [regs, eventFilter]
  );

  if (!user) return null;
  if (!isAdmin) {
    return <Card><p className="text-sm text-muted">Only the Admin can manage event registration.</p></Card>;
  }

  async function create() {
    if (!eventName.trim()) return toast("Enter an event name.", "info");
    setCreating(true);
    try {
      await createEventLink(eventName, user!.email);
      toast("Registration link created.");
      await load();
    } catch {
      toast("Could not create the link.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function toggle(link: EventLink) {
    try {
      await setEventLinkActive(link, !link.active);
      toast(link.active ? "Link closed." : "Link reopened.");
      await load();
    } catch {
      toast("Could not update the link.", "error");
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      toast("Link copied.");
    } catch {
      toast("Copy failed — select and copy manually.", "info");
    }
  }

  function downloadCsv() {
    const rows = shownRegs;
    if (rows.length === 0) return toast("No registrations to download.", "info");
    const head = [
      "Full Name", "Phone Number", "District", "Customer Category", "Products Interested In",
      "Planned Number of Chicks", "Expected Purchase Month", "Preferred Contact Method",
      "Consent to Receive Updates", "Event", "Registered at",
    ];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const r of rows) {
      lines.push([
        r.name, r.phone, r.district ?? "", r.category ?? "", r.products ?? "",
        r.plannedChicks ? String(r.plannedChicks) : "", monthLabel(r.purchaseMonth), r.contactMethod ?? "",
        r.consent ? "Yes" : "No", r.event, formatDateTime(r.on),
      ].map((v) => esc(String(v))).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `visitors-${eventFilter === "all" ? "all" : eventFilter.replace(/\s+/g, "-")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Customers who visited us" value={shownRegs.length.toLocaleString()} tone="green" />
        <StatTile label="Active links" value={String(links.filter((l) => l.active).length)} />
        <StatTile label="Events" value={String(new Set(links.map((l) => l.event)).size)} />
      </div>

      <Card>
        <CardHeader title="Create a registration link" />
        <p className="-mt-1 mb-3 text-xs text-muted">Make a link and send it to your team — anyone who opens it can register to visit us. No login needed.</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Event name"><Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Agrishow 2026" /></Field>
          <div className="flex items-end"><Button onClick={create} disabled={creating}>{creating ? "Creating…" : "Create link"}</Button></div>
        </div>
      </Card>

      <Card>
        <CardHeader title={`Registration links (${links.length})`} />
        <TableWrap>
          <thead><tr><Th>Event</Th><Th>Link</Th><Th>Status</Th><Th className="text-right">Registered</Th><Th></Th></tr></thead>
          <tbody>
            {links.length === 0 ? (
              <EmptyRow colSpan={5} text={loading ? "" : "No links yet — create one above."} />
            ) : links.map((l) => {
              const count = regs.filter((r) => r.token === l.token).length;
              return (
                <tr key={l.id}>
                  <Td className="font-medium">{l.event}</Td>
                  <Td>
                    <div className="flex items-center gap-2">
                      <code className="max-w-[280px] truncate rounded bg-ink/5 px-2 py-1 text-xs">{linkUrl(l.token)}</code>
                      <Button size="sm" variant="ghost" onClick={() => copy(linkUrl(l.token))}>Copy</Button>
                    </div>
                  </Td>
                  <Td>{l.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Closed</Pill>}</Td>
                  <Td className="text-right font-medium">{count.toLocaleString()}</Td>
                  <Td><Button size="sm" variant="ghost" onClick={() => toggle(l)}>{l.active ? "Close" : "Reopen"}</Button></Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHeader title={`Visitors (${shownRegs.length})`} />
          <div className="flex items-center gap-2">
            <div className="w-48"><Select value={eventFilter} onChange={(e) => setEventFilter(e.target.value)} options={eventOptions} /></div>
            <Button variant="secondary" onClick={downloadCsv}>Download list (CSV)</Button>
          </div>
        </div>
        <TableWrap>
          <thead><tr>
            <Th>Name</Th><Th>Phone</Th><Th>District</Th><Th>Category</Th><Th>Products</Th>
            <Th className="text-right">Chicks</Th><Th>Buy month</Th><Th>Contact</Th><Th>Consent</Th><Th>Registered</Th>
          </tr></thead>
          <tbody>
            {shownRegs.length === 0 ? (
              <EmptyRow colSpan={10} text={loading ? "" : "No visitors registered yet."} />
            ) : shownRegs.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.name}</Td>
                <Td>{r.phone}</Td>
                <Td>{r.district || "—"}</Td>
                <Td>{r.category || "—"}</Td>
                <Td>{r.products || "—"}</Td>
                <Td className="text-right">{r.plannedChicks ? r.plannedChicks.toLocaleString() : "—"}</Td>
                <Td>{monthLabel(r.purchaseMonth) || "—"}</Td>
                <Td>{r.contactMethod || "—"}</Td>
                <Td>{r.consent ? <Pill tone="green">Yes</Pill> : <Pill tone="neutral">No</Pill>}</Td>
                <Td>{formatDateTime(r.on)}</Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

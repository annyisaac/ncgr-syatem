"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { Modal } from "@/components/ui/Modal";
import { StatTile } from "@/components/dashboard/DashKit";
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { getSupabase } from "@/lib/supabase";
import { formatDate, formatDateTime, todayISO } from "@/lib/format";
import { PERIODS, presetToRange, type PeriodPreset } from "@/lib/period";
import { visitorsPDF } from "@/lib/reports";
import {
  createEventLink,
  listEventLinks,
  listEventRegistrations,
  setEventLinkActive,
  type EventLink,
  type EventRegistration,
} from "@/lib/events";
import {
  createTeamLink,
  deleteTeamDetail,
  listTeamDetails,
  listTeamLinks,
  setTeamLinkActive,
  type TeamDetail,
  type TeamDetailLink,
} from "@/lib/team";

/** "2026-08" → "Aug 2026". Empty/invalid → "". */
function monthLabel(m?: string): string {
  if (!m || !/^\d{4}-\d{2}$/.test(m)) return "";
  const [y, mo] = m.split("-");
  const d = new Date(Number(y), Number(mo) - 1, 1);
  return d.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

const IcoTicket = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H6a2 2 0 0 1-2-2 2 2 0 0 0 0-4Z" /><path d="M14 6v12" /></svg>);
const IcoPeople = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3" /><path d="M15 11a3 3 0 1 0-2-5.2" /><path d="M3 20c0-3 2.7-5 6-5s6 2 6 5" /><path d="M17 15c2.5.5 4 2.3 4 5" /></svg>);

export default function AgrishowPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [links, setLinks] = useState<EventLink[]>([]);
  const [regs, setRegs] = useState<EventRegistration[]>([]);
  const [loading, setLoading] = useState(true);
  const [eventName, setEventName] = useState("Agrishow 2026");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [eventFilter, setEventFilter] = useState("all");
  const [productFilter, setProductFilter] = useState("all");
  const [preset, setPreset] = useState<PeriodPreset>("all");

  // Team member self-service details
  const [teamLinks, setTeamLinks] = useState<TeamDetailLink[]>([]);
  const [teamDetails, setTeamDetails] = useState<TeamDetail[]>([]);
  const [teamTitle, setTeamTitle] = useState("Team details 2026");
  const [showCreateTeam, setShowCreateTeam] = useState(false);
  const [creatingTeam, setCreatingTeam] = useState(false);
  const [teamSearch, setTeamSearch] = useState("");
  const [viewRec, setViewRec] = useState<TeamDetail | null>(null);
  // Which card is open: null = the card grid, else an event or the team form.
  const [view, setView] = useState<{ kind: "event"; event: string } | { kind: "team" } | null>(null);

  const isAdmin = user?.role === "Admin" || user?.role === "Ross Payment Checker";
  // Only a true Admin manages existing links (copy / close / reopen).
  const canManageLinks = user?.role === "Admin";

  const load = useCallback(async () => {
    try {
      const [l, r, tl, td] = await Promise.all([
        listEventLinks(), listEventRegistrations(), listTeamLinks(), listTeamDetails(),
      ]);
      setLinks(l);
      setRegs(r);
      setTeamLinks(tl);
      setTeamDetails(td);
    } catch {
      /* keep whatever we have */
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch — setState lands after the awaited load, off the render path.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // Live: new registrations and link changes appear without a refresh.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 350);
    };
    const sb = getSupabase();
    const channel = sb
      .channel("agrishow-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: { table?: string }) => {
        if (["event_registrations", "event_links", "team_details", "team_detail_links"].includes(payload.table ?? "")) bump();
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [load]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const linkUrl = (t: string) => `${origin}/visit/${t}`;

  const eventNames = useMemo(() => Array.from(new Set(links.map((l) => l.event))).sort(), [links]);

  const shownRegs = useMemo(() => {
    const range: DateRangeValue = presetToRange(preset, ALL_TIME, todayISO());
    return regs.filter((r) => {
      if (eventFilter !== "all" && r.event !== eventFilter) return false;
      if (productFilter !== "all" && !(r.products ?? "").includes(productFilter)) return false;
      if ((range.from || range.to) && !inRange(r.on.slice(0, 10), range)) return false;
      return true;
    });
  }, [regs, eventFilter, productFilter, preset]);

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
      setShowCreate(false);
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
      "Full Name", "Phone Number", "Province", "District", "Sector", "Customer Category",
      "Products Interested In", "Planned Number of Chicks", "Expected Purchase Month",
      "Preferred Contact Method", "Consent to Receive Updates", "Event", "Registered at",
    ];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const r of rows) {
      lines.push([
        r.name, r.phone, r.province ?? "", r.district ?? "", r.sector ?? "", r.category ?? "", r.products ?? "",
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

  function downloadPdf() {
    if (shownRegs.length === 0) return toast("No registrations to download.", "info");
    const label = eventFilter === "all" ? "All events" : eventFilter;
    void visitorsPDF(shownRegs, label);
  }

  const activeTeamLinks = teamLinks.filter((l) => l.active);
  const shownTeam = teamDetails.filter((r) => {
    const q = teamSearch.trim().toLowerCase();
    if (!q) return true;
    return [r.fullName, r.nationalId, r.phone, r.position, r.spouseName, ...r.children.map((c) => c.name)]
      .some((v) => (v ?? "").toLowerCase().includes(q));
  });

  async function createTeam() {
    if (!teamTitle.trim()) return toast("Enter a title.", "info");
    setCreatingTeam(true);
    try {
      await createTeamLink(teamTitle, user!.email);
      toast("Team details link created.");
      setShowCreateTeam(false);
      await load();
    } catch {
      toast("Could not create the link.", "error");
    } finally {
      setCreatingTeam(false);
    }
  }

  async function toggleTeam(link: TeamDetailLink) {
    try {
      await setTeamLinkActive(link, !link.active);
      toast(link.active ? "Link closed." : "Link reopened.");
      await load();
    } catch {
      toast("Could not update the link.", "error");
    }
  }

  async function removeRecord(rec: TeamDetail) {
    if (!confirm(`Delete ${rec.fullName}'s record? This cannot be undone.`)) return;
    setTeamDetails((p) => p.filter((x) => x.id !== rec.id));
    try { await deleteTeamDetail(rec.id); toast("Record deleted."); }
    catch { toast("Could not delete.", "error"); void load(); }
  }

  function downloadTeamCsv() {
    if (shownTeam.length === 0) return toast("No team records to download.", "info");
    const head = ["Full Name", "National ID", "Phone", "Position", "Marital Status", "Spouse", "Spouse ID", "Children", "Submitted"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const kids = (r: TeamDetail) => r.children.map((c) => `${c.name}${c.nationalId ? ` (ID ${c.nationalId})` : ""}${c.birthDate ? ` — ${c.birthDate}` : ""}`).join("; ");
    const lines = [head.map(esc).join(",")];
    for (const r of shownTeam) {
      lines.push([
        r.fullName, r.nationalId ?? "", r.phone ?? "", r.position ?? "", r.maritalStatus ?? "",
        r.spouseName ?? "", r.spouseId ?? "", kids(r), formatDateTime(r.on),
      ].map((v) => esc(String(v))).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "team-details.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------------------- Landing: pick a card */}
      {view === null && (<>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-bold text-ink">Events &amp; forms</h1>
          <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Cancel" : "＋ New event"}</Button>
        </div>
        {showCreate && (
          <Card>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Event name"><Input value={eventName} onChange={(e) => setEventName(e.target.value)} placeholder="e.g. Agrishow 2026" /></Field>
              <div className="flex items-end"><Button onClick={create} disabled={creating}>{creating ? "Creating…" : "Create event"}</Button></div>
            </div>
          </Card>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {eventNames.length === 0 && !loading && (
            <Card><p className="py-6 text-center text-sm text-muted">No events yet — create one to get a shareable registration form.</p></Card>
          )}
          {eventNames.map((ev) => {
            const evLinks = links.filter((l) => l.event === ev);
            const active = evLinks.some((l) => l.active);
            const count = regs.filter((r) => r.event === ev).length;
            const created = evLinks.map((l) => l.createdAt).sort()[0];
            return (
              <button key={ev} type="button" onClick={() => { setView({ kind: "event", event: ev }); setEventFilter(ev); }}
                className="flex flex-col rounded-2xl border border-line bg-paper p-4 text-left shadow-card transition hover:border-gold">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-2.5">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-gold-bg text-gold-dark"><IcoTicket /></span>
                    <p className="truncate font-bold text-ink">{ev}</p>
                  </div>
                  <Pill tone={active ? "green" : "neutral"}>{active ? "Active" : "Closed"}</Pill>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
                  <Info label="Registered" value={count.toLocaleString()} />
                  <Info label="Created" value={created ? formatDate(created.slice(0, 10)) : "—"} />
                </div>
                <span className="mt-3 text-xs font-semibold text-gold-dark">Open →</span>
              </button>
            );
          })}
          {canManageLinks && (
            <button type="button" onClick={() => setView({ kind: "team" })}
              className="flex flex-col rounded-2xl border border-line bg-paper p-4 text-left shadow-card transition hover:border-gold">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2.5">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-green-bg text-green"><IcoPeople /></span>
                  <p className="truncate font-bold text-ink">Team member details</p>
                </div>
                <Pill tone="gold">HR</Pill>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 border-t border-line pt-3">
                <Info label="Records" value={teamDetails.length.toLocaleString()} />
                <Info label="Active links" value={String(activeTeamLinks.length)} />
              </div>
              <span className="mt-3 text-xs font-semibold text-gold-dark">Open →</span>
            </button>
          )}
        </div>
      </>)}

      {/* ---------------------------------------------------------------- Event detail */}
      {view?.kind === "event" && (<>
      <button type="button" onClick={() => { setView(null); setEventFilter("all"); }} className="text-sm font-medium text-gold-dark hover:underline">← Back to events</button>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold text-ink">{view.event}</h1>
        <Pill tone={links.some((l) => l.event === view.event && l.active) ? "green" : "neutral"}>{links.some((l) => l.event === view.event && l.active) ? "Active" : "Closed"}</Pill>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatTile label="Registered" value={shownRegs.length.toLocaleString()} tone="green" />
        <StatTile label="Active links" value={String(links.filter((l) => l.event === view.event && l.active).length)} />
        <StatTile label="Total links" value={String(links.filter((l) => l.event === view.event).length)} />
      </div>

      <Card>
        <CardHeader title="Registration form link" />
        <p className="-mt-1 mb-3 text-xs text-muted">Share this link — visitors open it to register. Manage or close it below.</p>
        <div className="flex flex-wrap items-center gap-2">
          {links.filter((l) => l.event === view.event && l.active).map((l) => (
            <Button key={l.id} variant="secondary" onClick={() => window.open(linkUrl(l.token), "_blank", "noopener,noreferrer")}>Open form</Button>
          ))}
          {links.filter((l) => l.event === view.event && l.active).length === 0 && <span className="text-sm text-muted">No active link — reopen one below.</span>}
        </div>
      </Card>

      {canManageLinks && (
      <Card>
        <CardHeader title={`Manage links (${links.filter((l) => l.event === view.event).length})`} />
        <TableWrap>
          <thead><tr><Th>Event</Th><Th>Link</Th><Th>Status</Th><Th className="text-right">Registered</Th><Th></Th></tr></thead>
          <tbody>
            {links.filter((l) => l.event === view.event).length === 0 ? (
              <EmptyRow colSpan={5} text="No links for this event." />
            ) : links.filter((l) => l.event === view.event).map((l) => {
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
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHeader title={`Visitors (${shownRegs.length})`} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44"><Select value={productFilter} onChange={(e) => setProductFilter(e.target.value)} options={[
              { value: "all", label: "All products" },
              { value: "Ross 308", label: "Ross 308" },
              { value: "Tetra Super Harco", label: "Tetra Super Harco" },
            ]} /></div>
            <div className="w-36"><Select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} options={PERIODS.filter((p) => p.value !== "custom")} /></div>
            <Button variant="secondary" onClick={downloadCsv}>CSV</Button>
            <Button variant="secondary" onClick={downloadPdf}>PDF</Button>
          </div>
        </div>
        <TableWrap>
          <thead><tr>
            <Th>Name</Th><Th>Phone</Th><Th>Province</Th><Th>District</Th><Th>Sector</Th><Th>Category</Th><Th>Products</Th>
            <Th className="text-right">Chicks</Th><Th>Buy month</Th><Th>Contact</Th><Th>Consent</Th><Th>Registered</Th>
          </tr></thead>
          <tbody>
            {shownRegs.length === 0 ? (
              <EmptyRow colSpan={12} text={loading ? "" : "No visitors registered yet."} />
            ) : shownRegs.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.name}</Td>
                <Td>{r.phone}</Td>
                <Td>{r.province || "—"}</Td>
                <Td>{r.district || "—"}</Td>
                <Td>{r.sector || "—"}</Td>
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
      </>)}

      {/* ---------------------------------------------------------------- Team member details (Admin only — sensitive HR data) */}
      {view?.kind === "team" && (<>
      <button type="button" onClick={() => setView(null)} className="text-sm font-medium text-gold-dark hover:underline">← Back to events</button>
      <div>
        <h1 className="text-lg font-bold text-ink">Team member details</h1>
        <p className="text-xs text-muted">Personal &amp; family details, corrected by each team member. Sensitive — Admin only.</p>
      </div>

      <Card>
        <CardHeader title="Team details link" />
        <p className="-mt-1 mb-3 text-xs text-muted">Create a link and share it with your team. Each member opens it to submit and correct their own details — name, marital status, spouse and children (with IDs and birth dates). Re-opening the link updates their record.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => setShowCreateTeam((v) => !v)}>{showCreateTeam ? "Cancel" : "＋ Create link"}</Button>
          {activeTeamLinks.map((l) => (
            <Button key={l.id} variant="secondary" onClick={() => window.open(`${origin}/team/${l.token}`, "_blank", "noopener,noreferrer")}>
              {l.title} · open form
            </Button>
          ))}
          {!loading && activeTeamLinks.length === 0 && <span className="text-sm text-muted">No active links yet — create one.</span>}
        </div>
        {showCreateTeam && (
          <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-line p-3 sm:grid-cols-3">
            <Field label="Title"><Input value={teamTitle} onChange={(e) => setTeamTitle(e.target.value)} placeholder="e.g. Team details 2026" /></Field>
            <div className="flex items-end"><Button onClick={createTeam} disabled={creatingTeam}>{creatingTeam ? "Creating…" : "Create link"}</Button></div>
          </div>
        )}
      </Card>

      {canManageLinks && teamLinks.length > 0 && (
        <Card>
          <CardHeader title={`Manage team links (${teamLinks.length})`} />
          <TableWrap>
            <thead><tr><Th>Title</Th><Th>Link</Th><Th>Status</Th><Th className="text-right">Submitted</Th><Th></Th></tr></thead>
            <tbody>
              {teamLinks.map((l) => {
                const count = teamDetails.filter((r) => r.token === l.token).length;
                return (
                  <tr key={l.id}>
                    <Td className="font-medium">{l.title}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <code className="max-w-[280px] truncate rounded bg-ink/5 px-2 py-1 text-xs">{`${origin}/team/${l.token}`}</code>
                        <Button size="sm" variant="ghost" onClick={() => copy(`${origin}/team/${l.token}`)}>Copy</Button>
                      </div>
                    </Td>
                    <Td>{l.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Closed</Pill>}</Td>
                    <Td className="text-right font-medium">{count.toLocaleString()}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => toggleTeam(l)}>{l.active ? "Close" : "Reopen"}</Button></Td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        </Card>
      )}

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHeader title={`Team records (${shownTeam.length})`} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-56"><Input value={teamSearch} onChange={(e) => setTeamSearch(e.target.value)} placeholder="Search name, ID, child…" /></div>
            <Button variant="secondary" onClick={downloadTeamCsv}>CSV</Button>
          </div>
        </div>
        <TableWrap>
          <thead><tr>
            <Th>Name</Th><Th>National ID</Th><Th>Phone</Th><Th>Position</Th><Th>Marital status</Th><Th>Spouse</Th><Th className="text-right">Children</Th><Th>Submitted</Th><Th></Th>
          </tr></thead>
          <tbody>
            {shownTeam.length === 0 ? (
              <EmptyRow colSpan={9} text={loading ? "" : "No team records yet — share the link with your team."} />
            ) : shownTeam.map((r) => (
              <tr key={r.id}>
                <Td className="font-medium">{r.fullName}</Td>
                <Td>{r.nationalId || "—"}</Td>
                <Td>{r.phone || "—"}</Td>
                <Td>{r.position || "—"}</Td>
                <Td>{r.maritalStatus || "—"}</Td>
                <Td>{r.spouseName || "—"}</Td>
                <Td className="text-right">{r.children.length || "—"}</Td>
                <Td>{formatDateTime(r.on)}</Td>
                <Td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setViewRec(r)}>View</Button>
                    <Button size="sm" variant="ghost" onClick={() => removeRecord(r)}>Delete</Button>
                  </div>
                </Td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>

      <Modal open={!!viewRec} onClose={() => setViewRec(null)} title={viewRec ? viewRec.fullName : ""} className="max-w-lg">
        {viewRec && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <Info label="National ID" value={viewRec.nationalId || "—"} />
              <Info label="Phone" value={viewRec.phone || "—"} />
              <Info label="Position / department" value={viewRec.position || "—"} />
              <Info label="Marital status" value={viewRec.maritalStatus || "—"} />
              {viewRec.maritalStatus === "Married" && <>
                <Info label="Spouse" value={viewRec.spouseName || "—"} />
                <Info label="Spouse National ID" value={viewRec.spouseId || "—"} />
              </>}
              <Info label="Submitted" value={formatDateTime(viewRec.on)} />
            </div>
            <div>
              <p className="mb-2 text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Children ({viewRec.children.length})</p>
              {viewRec.children.length === 0 ? (
                <p className="text-sm text-muted">No children recorded.</p>
              ) : (
                <div className="space-y-2">
                  {viewRec.children.map((c, i) => (
                    <div key={i} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                      <span className="font-medium text-ink">{c.name}</span>
                      <span className="flex flex-wrap gap-x-3 text-xs text-muted">
                        <span>ID: {c.nationalId || "—"}</span>
                        <span>Born: {c.birthDate ? formatDate(c.birthDate) : "—"}</span>
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </Modal>
      </>)}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.62rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}

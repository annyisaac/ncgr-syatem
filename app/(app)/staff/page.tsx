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
import { ALL_TIME, inRange, type DateRangeValue } from "@/components/ui/DateRange";
import { getSupabase } from "@/lib/supabase";
import { cn } from "@/lib/cn";
import { formatDate, nowISO, todayISO } from "@/lib/format";
import { PERIODS, presetToRange, type PeriodPreset } from "@/lib/period";
import {
  ATTENDANCE_STATUSES,
  DEPARTMENTS,
  createStaffLink,
  listAttendance,
  listStaffLinks,
  listStaffMembers,
  removeStaffMember,
  setStaffLinkActive,
  upsertAttendance,
  type AttendanceRecord,
  type AttendanceStatus,
  type StaffLink,
  type StaffMember,
} from "@/lib/staff";

const CAN_MANAGE = ["Admin", "Operations Manager", "Hatchery Manager", "Hatchery Operations Manager"];

const STATUS_TONE: Record<AttendanceStatus, "green" | "amber" | "red" | "info"> = {
  present: "green",
  late: "amber",
  absent: "red",
  leave: "info",
};

export default function StaffPage() {
  const { user } = useAuth();
  const { toast } = useToast();

  const [links, setLinks] = useState<StaffLink[]>([]);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [label, setLabel] = useState("Staff registration 2026");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const [markDate, setMarkDate] = useState(todayISO());
  const [draft, setDraft] = useState<Record<string, AttendanceStatus>>({});
  const [saving, setSaving] = useState(false);

  const [deptFilter, setDeptFilter] = useState("all");
  const [preset, setPreset] = useState<PeriodPreset>("month");

  const isAdmin = user?.role === "Admin";
  const canManage = !!user && CAN_MANAGE.includes(user.role);

  const load = useCallback(async () => {
    try {
      const [l, s, a] = await Promise.all([listStaffLinks(), listStaffMembers(), listAttendance()]);
      setLinks(l);
      setStaff(s);
      setAttendance(a);
    } catch {
      /* keep whatever we have */
    } finally {
      setLoading(false);
    }
  }, []);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);

  // Live: new profiles and attendance edits appear without a refresh.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void load(), 350);
    };
    const sb = getSupabase();
    const channel = sb
      .channel("staff-live")
      .on("postgres_changes", { event: "*", schema: "public" }, (payload: { table?: string }) => {
        if (payload.table === "staff_members" || payload.table === "attendance_records" || payload.table === "staff_links") bump();
      })
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void sb.removeChannel(channel);
    };
  }, [load]);

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const linkUrl = (t: string) => `${origin}/join/${t}`;

  const attByKey = useMemo(() => new Map(attendance.map((a) => [a.id, a])), [attendance]);
  const range: DateRangeValue = useMemo(() => presetToRange(preset, ALL_TIME, todayISO()), [preset]);

  const sortedStaff = useMemo(
    () => staff.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [staff]
  );
  const markStaff = useMemo(
    () => (deptFilter === "all" ? sortedStaff : sortedStaff.filter((s) => s.department === deptFilter)),
    [sortedStaff, deptFilter]
  );

  const statusFor = (s: StaffMember): AttendanceStatus | undefined =>
    draft[s.id] ?? attByKey.get(`${s.id}:${markDate}`)?.status;

  // Per-worker attendance stats over the selected period.
  const stats = useMemo(() => {
    return markStaff.map((s) => {
      const recs = attendance.filter((a) => a.staffId === s.id && inRange(a.date, range));
      const present = recs.filter((a) => a.status === "present" || a.status === "late").length;
      const late = recs.filter((a) => a.status === "late").length;
      const absent = recs.filter((a) => a.status === "absent").length;
      const leave = recs.filter((a) => a.status === "leave").length;
      const marked = recs.length;
      const rate = marked ? Math.round((present / marked) * 100) : null;
      const last = recs.filter((a) => a.status === "present" || a.status === "late").map((a) => a.date).sort().pop();
      return { s, present, late, absent, leave, marked, rate, last };
    });
  }, [markStaff, attendance, range]);

  const kpi = useMemo(() => {
    const today = todayISO();
    const todays = attendance.filter((a) => a.date === today);
    const presentToday = todays.filter((a) => a.status === "present" || a.status === "late").length;
    const absentToday = todays.filter((a) => a.status === "absent").length;
    const inPeriod = attendance.filter((a) => inRange(a.date, range));
    const present = inPeriod.filter((a) => a.status === "present" || a.status === "late").length;
    const rate = inPeriod.length ? `${Math.round((present / inPeriod.length) * 100)}%` : "—";
    return { presentToday, absentToday, rate };
  }, [attendance, range]);

  if (!user) return null;
  if (!canManage) {
    return <Card><p className="text-sm text-muted">Only managers can view staff and attendance.</p></Card>;
  }

  async function create() {
    if (!label.trim()) return toast("Enter a label for the link.", "info");
    setCreating(true);
    try {
      await createStaffLink(label, user!.email);
      toast("Staff link created.");
      setShowCreate(false);
      await load();
    } catch {
      toast("Could not create the link.", "error");
    } finally {
      setCreating(false);
    }
  }

  async function toggle(link: StaffLink) {
    try {
      await setStaffLinkActive(link, !link.active);
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

  function setStatus(s: StaffMember, st: AttendanceStatus) {
    setDraft((prev) => ({ ...prev, [s.id]: prev[s.id] === st ? (attByKey.get(`${s.id}:${markDate}`)?.status ?? st) : st }));
  }

  async function saveMarks() {
    const changed = Object.entries(draft).filter(([id, st]) => attByKey.get(`${id}:${markDate}`)?.status !== st);
    if (changed.length === 0) return toast("No attendance changes to save.", "info");
    setSaving(true);
    try {
      for (const [staffId, status] of changed) {
        const rec: AttendanceRecord = {
          id: `${staffId}:${markDate}`,
          staffId,
          date: markDate,
          status,
          by: user!.email,
          on: nowISO(),
        };
        await upsertAttendance(rec);
      }
      toast(`Attendance saved for ${formatDate(markDate)} — ${changed.length} worker(s).`);
      setDraft({});
      await load();
    } catch {
      toast("Could not save attendance — check your connection.", "error");
    } finally {
      setSaving(false);
    }
  }

  async function removeStaff(s: StaffMember) {
    if (!confirm(`Remove ${s.name} from the staff list? Their attendance history stays but they leave the roster. This cannot be undone.`)) return;
    try {
      await removeStaffMember(s.id);
      toast(`${s.name} removed.`);
      await load();
    } catch {
      toast("Could not remove the staff member.", "error");
    }
  }

  function downloadCsv() {
    if (stats.length === 0) return toast("No staff to download.", "info");
    const head = ["Name", "Phone", "Department", "Position", "Days present", "Late", "Absent", "Leave", "Days marked", "Attendance %", "Last present"];
    const esc = (v: string) => `"${(v ?? "").replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(",")];
    for (const x of stats) {
      lines.push([
        x.s.name, x.s.phone, x.s.department || "", x.s.position || "",
        String(x.present), String(x.late), String(x.absent), String(x.leave), String(x.marked),
        x.rate == null ? "" : `${x.rate}%`, x.last ? formatDate(x.last) : "",
      ].map((v) => esc(String(v))).join(","));
    }
    const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `staff-attendance-${preset}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Staff registered" value={staff.length.toLocaleString()} />
        <StatTile label="Present today" value={kpi.presentToday.toLocaleString()} tone="green" />
        <StatTile label="Absent today" value={kpi.absentToday.toLocaleString()} tone="red" />
        <StatTile label="Attendance rate (period)" value={kpi.rate} tone="gold" />
      </div>

      {/* Registration links */}
      <Card>
        <CardHeader title="Registration link" />
        <p className="-mt-1 mb-3 text-xs text-muted">Create a link and share it with your workers. Each worker opens it once and submits their details — no login needed.</p>
        <div className="flex flex-wrap items-center gap-2">
          {isAdmin && <Button onClick={() => setShowCreate((v) => !v)}>{showCreate ? "Cancel" : "＋ Create link"}</Button>}
          {links.filter((l) => l.active).map((l) => (
            <Button key={l.id} variant="secondary" onClick={() => window.open(linkUrl(l.token), "_blank", "noopener,noreferrer")}>
              {l.label} · open form
            </Button>
          ))}
          {!loading && links.filter((l) => l.active).length === 0 && (
            <span className="text-sm text-muted">No active links yet{isAdmin ? " — create one." : "."}</span>
          )}
        </div>

        {showCreate && isAdmin && (
          <div className="mt-4 grid grid-cols-1 gap-4 rounded-lg border border-line p-3 sm:grid-cols-3">
            <Field label="Link label"><Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Staff registration 2026" /></Field>
            <div className="flex items-end"><Button onClick={create} disabled={creating}>{creating ? "Creating…" : "Create link"}</Button></div>
          </div>
        )}

        {isAdmin && links.length > 0 && (
          <div className="mt-4">
            <TableWrap>
              <thead><tr><Th>Label</Th><Th>Link</Th><Th>Status</Th><Th className="text-right">Joined</Th><Th></Th></tr></thead>
              <tbody>
                {links.map((l) => (
                  <tr key={l.id}>
                    <Td className="font-medium">{l.label}</Td>
                    <Td>
                      <div className="flex items-center gap-2">
                        <code className="max-w-[260px] truncate rounded bg-ink/5 px-2 py-1 text-xs">{linkUrl(l.token)}</code>
                        <Button size="sm" variant="ghost" onClick={() => copy(linkUrl(l.token))}>Copy</Button>
                      </div>
                    </Td>
                    <Td>{l.active ? <Pill tone="green">Active</Pill> : <Pill tone="neutral">Closed</Pill>}</Td>
                    <Td className="text-right font-medium">{staff.filter((s) => s.token === l.token).length.toLocaleString()}</Td>
                    <Td><Button size="sm" variant="ghost" onClick={() => toggle(l)}>{l.active ? "Close" : "Reopen"}</Button></Td>
                  </tr>
                ))}
              </tbody>
            </TableWrap>
          </div>
        )}
      </Card>

      {/* Mark attendance */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHeader title="Mark attendance" />
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-44"><Field label="Date"><Input type="date" value={markDate} onChange={(e) => { setMarkDate(e.target.value); setDraft({}); }} /></Field></div>
            <div className="w-48"><Field label="Department"><Select value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)} options={[{ value: "all", label: "All departments" }, ...DEPARTMENTS.map((d) => ({ value: d, label: d }))]} /></Field></div>
            <Button onClick={saveMarks} disabled={saving}>{saving ? "Saving…" : "Save attendance"}</Button>
          </div>
        </div>
        <TableWrap>
          <thead><tr><Th>Worker</Th><Th>Department</Th><Th>Position</Th><Th>Attendance for {formatDate(markDate)}</Th></tr></thead>
          <tbody>
            {markStaff.length === 0 ? (
              <EmptyRow colSpan={4} text={loading ? "" : "No staff registered yet — share the link above."} />
            ) : markStaff.map((s) => {
              const cur = statusFor(s);
              return (
                <tr key={s.id}>
                  <Td className="font-medium">{s.name}<div className="text-xs text-muted">{s.phone}</div></Td>
                  <Td>{s.department || "—"}</Td>
                  <Td>{s.position || "—"}</Td>
                  <Td>
                    <div className="flex flex-wrap gap-1.5">
                      {ATTENDANCE_STATUSES.map((st) => (
                        <button
                          key={st.value}
                          type="button"
                          onClick={() => setStatus(s, st.value)}
                          className={cn(
                            "rounded-lg border px-2.5 py-1 text-xs font-semibold transition",
                            cur === st.value
                              ? st.value === "present" ? "border-green bg-green-bg text-green"
                                : st.value === "late" ? "border-amber bg-amber-bg text-amber"
                                : st.value === "absent" ? "border-red bg-red-bg text-red"
                                : "border-blue bg-blue-bg text-blue"
                              : "border-line text-muted hover:border-ink"
                          )}
                        >
                          {st.label}
                        </button>
                      ))}
                    </div>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      </Card>

      {/* Monitoring */}
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHeader title={`Attendance performance (${stats.length})`} />
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-36"><Select value={preset} onChange={(e) => setPreset(e.target.value as PeriodPreset)} options={PERIODS.filter((p) => p.value !== "custom")} /></div>
            <Button variant="secondary" onClick={downloadCsv}>CSV</Button>
          </div>
        </div>
        <TableWrap>
          <thead><tr>
            <Th>Worker</Th><Th>Department</Th><Th>Position</Th>
            <Th className="text-right">Present</Th><Th className="text-right">Late</Th><Th className="text-right">Absent</Th><Th className="text-right">Leave</Th>
            <Th className="text-right">Attendance</Th><Th>Last present</Th>{isAdmin && <Th></Th>}
          </tr></thead>
          <tbody>
            {stats.length === 0 ? (
              <EmptyRow colSpan={isAdmin ? 10 : 9} text={loading ? "" : "No staff to show."} />
            ) : stats.map((x) => (
              <tr key={x.s.id}>
                <Td className="font-medium">{x.s.name}<div className="text-xs text-muted">{x.s.phone}</div></Td>
                <Td>{x.s.department || "—"}</Td>
                <Td>{x.s.position || "—"}</Td>
                <Td className="text-right">{x.present}</Td>
                <Td className="text-right">{x.late}</Td>
                <Td className="text-right">{x.absent}</Td>
                <Td className="text-right">{x.leave}</Td>
                <Td className="text-right">
                  {x.rate == null ? <span className="text-muted">—</span> : (
                    <Pill tone={x.rate >= 90 ? "green" : x.rate >= 70 ? "amber" : "red"}>{x.rate}%</Pill>
                  )}
                </Td>
                <Td>{x.last ? formatDate(x.last) : "—"}</Td>
                {isAdmin && <Td><Button size="sm" variant="ghost" className="text-red hover:border-red" onClick={() => removeStaff(x.s)}>Remove</Button></Td>}
              </tr>
            ))}
          </tbody>
        </TableWrap>
      </Card>
    </div>
  );
}

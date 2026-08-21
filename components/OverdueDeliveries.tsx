"use client";

import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";

import { useAuth } from "./AuthProvider";
import { useData } from "./DataProvider";
import { useToast } from "./ui/Toast";
import { Modal } from "./ui/Modal";
import { Button } from "./ui/Button";
import { Pill } from "./ui/Pill";
import { Select } from "./ui/Select";
import { visibleOrders } from "@/lib/permissions";
import { canFulfill, fulfillOrder, isClosed, rescheduleOrder } from "@/lib/orders";
import { balance, type Order, type Product } from "@/lib/types";
import { formatMoney } from "@/lib/config";
import { formatDate, todayISO } from "@/lib/format";

// Roles that manage deliveries — the same set the orders page lets act.
const ACTOR_ROLES = new Set([
  "Admin", "Tetra Zone Manager", "Ross Order Receiver", "Tetra Payment Checker", "Ross Payment Checker",
]);

const daysAgo = (date: string) => {
  const ms = Date.parse(todayISO()) - Date.parse(date);
  return Math.max(0, Math.round(ms / 86_400_000));
};

/**
 * A reminder popup listing orders whose delivery date has passed but that
 * aren't marked delivered, letting the viewer confirm the delivery or reschedule
 * it. It opens every time the Orders page is opened (re-opens on each navigation
 * there), and can be closed for the current view. Mounted once in AppShell.
 */
const ORDERS_PATH = "/orders";

export function OverdueDeliveries() {
  const { user } = useAuth();
  const { orders, availability, upsertOrder } = useData();
  const { toast } = useToast();
  const pathname = usePathname();
  const [prevPath, setPrevPath] = useState(pathname);
  const [open, setOpen] = useState(pathname === ORDERS_PATH);
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [newDate, setNewDate] = useState("");

  // Re-open every time the user lands on the Orders page (adjust-state-during-
  // render, like AppShell's drawer) — close it when they navigate elsewhere.
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpen(pathname === ORDERS_PATH);
  }

  const today = todayISO();
  const overdue = useMemo(() => {
    if (!user) return [];
    return visibleOrders(orders, user)
      .filter((o) => !o.deliverOk && !isClosed(o) && !!o.date && o.date < today)
      .sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [orders, user, today]);

  if (!user || !ACTOR_ROLES.has(user.role)) return null;
  if (!open || overdue.length === 0) return null;

  const isAdmin = user.role === "Admin";

  function saveOptimistic(next: Order, message: string) {
    upsertOrder(next)
      .then(() => toast(message))
      .catch(() => toast("Could not save — please try again.", "error"));
  }

  function confirmDelivery(o: Order) {
    const why = canFulfill(o);
    if (why) return toast(why, "info");
    saveOptimistic(fulfillOrder(o, user!), `${o.name} marked delivered.`);
  }

  function openDatesFor(product: string) {
    const key: Product = product === "Ross 308" ? "Ross 308" : "Tetra Super Harco";
    return availability
      .filter((a) => !a.closed && a.date >= today && (key === "Ross 308" ? a.ross > 0 : a.tetra > 0))
      .sort((a, b) => (a.date < b.date ? -1 : 1))
      .map((a) => ({ value: a.date, label: formatDate(a.date) }));
  }

  function saveReschedule(o: Order) {
    if (!newDate) return toast("Pick a new delivery date.", "info");
    saveOptimistic(rescheduleOrder(o, newDate, user!, orders), `${o.name} rescheduled to ${formatDate(newDate)}.`);
    setRescheduleId(null);
    setNewDate("");
  }

  return (
    <Modal
      open
      onClose={() => setOpen(false)}
      title={`Overdue deliveries (${overdue.length})`}
      className="max-w-2xl"
      footer={<Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>}
    >
      <p className="-mt-1 mb-4 text-sm text-muted">
        These orders&apos; delivery dates have passed but they aren&apos;t marked delivered. Confirm the delivery, or reschedule to a new date.
      </p>

      <div className="space-y-3">
        {overdue.map((o) => {
          const why = canFulfill(o);
          const canReschedule = isAdmin || o.by === user.email;
          const editing = rescheduleId === o.id;
          return (
            <div key={o.id} className="rounded-2xl border border-line bg-paper p-3.5 shadow-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{o.name}</p>
                  <p className="text-xs text-muted">{o.product} · {o.chicks.toLocaleString()} chicks · balance {formatMoney(balance(o), o.currency ?? "RWF")}</p>
                </div>
                <Pill tone="red">{formatDate(o.date)} · {daysAgo(o.date)}d ago</Pill>
              </div>

              {editing ? (
                <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
                  <div className="w-56">
                    <p className="mb-1 text-[0.62rem] font-semibold uppercase tracking-wide text-muted">New delivery date</p>
                    <Select value={newDate} placeholder="Select an open date" options={openDatesFor(o.product)} onChange={(e) => setNewDate(e.target.value)} />
                  </div>
                  <Button size="sm" onClick={() => saveReschedule(o)}>Save</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setRescheduleId(null); setNewDate(""); }}>Cancel</Button>
                </div>
              ) : (
                <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
                  {why ? (
                    <span className="text-xs text-muted">Can&apos;t confirm yet — {why.toLowerCase()}</span>
                  ) : (
                    <Button size="sm" onClick={() => confirmDelivery(o)}>Confirm delivered</Button>
                  )}
                  {canReschedule && (
                    <Button size="sm" variant="ghost" onClick={() => { setRescheduleId(o.id); setNewDate(""); }}>Reschedule</Button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </Modal>
  );
}

"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { visibleOrders } from "@/lib/permissions";
import { isoDate, monthLabel, todayISO } from "@/lib/format";
import { cn } from "@/lib/cn";
import { toDeliver, type Order } from "@/lib/types";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CAN_EDIT = ["Admin", "Tetra Zone Manager", "Ross Order Receiver"];
const isActive = (o: Order) => o.status !== "refunded" && o.status !== "rejected";
const deliverChicks = (o: Order) => o.deliveryChicks ?? toDeliver(o);

export default function DeliveryPlanningCalendar() {
  const { user } = useAuth();
  const { orders } = useData();
  const router = useRouter();
  const [cursor, setCursor] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });

  const scoped = useMemo(() => (user ? visibleOrders(orders, user) : []), [orders, user]);
  const today = todayISO();

  const countsByDate = useMemo(() => {
    const m = new Map<string, { orders: number; chicks: number; routed: number; delivered: number }>();
    for (const o of scoped) {
      // Include delivered orders so a completed day stays visible on the calendar
      // (you can still open it to reprint the manifest).
      if (!(o.confirmedOk && isActive(o))) continue;
      const g = m.get(o.date) ?? { orders: 0, chicks: 0, routed: 0, delivered: 0 };
      g.orders += 1;
      g.chicks += deliverChicks(o);
      if (o.routeId) g.routed += 1;
      if (o.deliverOk) g.delivered += 1;
      m.set(o.date, g);
    }
    return m;
  }, [scoped]);

  if (!user) return null;

  const canEdit = CAN_EDIT.includes(user.role);

  const first = new Date(cursor.year, cursor.month, 1);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(isoDate(new Date(cursor.year, cursor.month, d)));
  const prevMonth = () => setCursor((c) => { const m = c.month - 1; return m < 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: m }; });
  const nextMonth = () => setCursor((c) => { const m = c.month + 1; return m > 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: m }; });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Pill tone={canEdit ? "gold" : "neutral"}>{canEdit ? "Full access" : "View only"}</Pill>
      </div>

      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="card-title">Pick a delivery day</h3>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={prevMonth}>Previous</Button>
            <span className="min-w-40 text-center text-sm font-semibold">{monthLabel(cursor.year, cursor.month)}</span>
            <Button variant="ghost" size="sm" onClick={nextMonth}>Next</Button>
          </div>
        </div>
        <p className="mt-1 text-xs text-muted">Click any date to open its delivery plan.</p>

        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
              {WEEKDAYS.map((w) => <div key={w} className="py-1">{w}</div>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((iso, i) => {
                if (!iso) return <div key={i} className="h-24 rounded bg-transparent" />;
                const g = countsByDate.get(iso);
                const has = !!g;
                const allRouted = has && g!.routed === g!.orders;
                const allDelivered = has && g!.delivered === g!.orders;
                const someDelivered = has && g!.delivered > 0;
                const isToday = iso === today;
                const status = !has
                  ? ""
                  : allDelivered
                    ? "all delivered ✓"
                    : someDelivered
                      ? `${g!.delivered}/${g!.orders} delivered`
                      : allRouted
                        ? "planned"
                        : `${g!.orders - g!.routed} to plan`;
                return (
                  <button
                    key={i}
                    type="button"
                    onClick={() => router.push(`/planning/${iso}`)}
                    className={cn(
                      "h-24 cursor-pointer rounded-[10px] border p-1.5 text-left transition hover:border-gold hover:shadow-[0_3px_12px_rgba(150,115,20,.22)]",
                      !has && "border-line bg-paper",
                      has && allDelivered && "border-green bg-green-bg",
                      has && !allDelivered && "border-gold bg-gold-bg",
                      isToday && "outline outline-2 outline-ink"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn("text-[0.85rem] font-bold", !has && "text-muted")}>{Number(iso.slice(8, 10))}</span>
                      {has && <span className={cn("rounded-full px-1.5 text-[10px] font-bold", allDelivered ? "bg-green text-white" : "bg-onyx text-[#f3e9c9]")}>{g!.orders}</span>}
                    </div>
                    {has && (
                      <div className="mt-1 space-y-0.5">
                        <div className="text-[10px] font-semibold leading-tight text-gold-dark">{g!.chicks.toLocaleString()} chicks</div>
                        <div className={cn("text-[9px] font-semibold leading-tight", allDelivered ? "text-green" : "text-muted")}>{status}</div>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

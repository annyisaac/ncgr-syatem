"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { cn } from "@/lib/cn";

import type { Order } from "@/lib/types";
import { balance, paidAmount, toDeliver } from "@/lib/types";
import { formatRWF } from "@/lib/config";
import { formatDate, isoDate, monthLabel, todayISO } from "@/lib/format";
import { visibleOrders } from "@/lib/permissions";
import { deliveryPaymentPDF } from "@/lib/reports";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function DeliveriesPage() {
  const { user } = useAuth();
  const { orders } = useData();
  const { toast } = useToast();
  const router = useRouter();

  const today = todayISO();
  const [cursor, setCursor] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [query, setQuery] = useState("");

  const myOrders = useMemo(
    () => (user ? visibleOrders(orders, user).filter((o) => o.status !== "refunded") : []),
    [orders, user]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return myOrders;
    return myOrders.filter(
      (o) =>
        o.name.toLowerCase().includes(q) ||
        o.phone.toLowerCase().includes(q) ||
        o.payments.some((p) => p.ref.toLowerCase().includes(q))
    );
  }, [myOrders, query]);

  const byDate = useMemo(() => {
    const map = new Map<string, Order[]>();
    for (const o of filtered) {
      const key = o.date.slice(0, 10);
      const list = map.get(key) ?? [];
      list.push(o);
      map.set(key, list);
    }
    return map;
  }, [filtered]);

  if (!user) return null;

  /** Open a delivery date in the Orders page (plan management happens there). */
  function openDate(iso: string) {
    router.push(`/orders?date=${iso}`);
  }

  // Build calendar cells (Monday-first).
  const first = new Date(cursor.year, cursor.month, 1);
  const startWeekday = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(cursor.year, cursor.month + 1, 0).getDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push(isoDate(new Date(cursor.year, cursor.month, d)));
  }

  function prevMonth() {
    setCursor((c) => {
      const m = c.month - 1;
      return m < 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: m };
    });
  }
  function nextMonth() {
    setCursor((c) => {
      const m = c.month + 1;
      return m > 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: m };
    });
  }

  // Which dates to summarise: matches while searching, else the visible month.
  const summaryDates = Array.from(byDate.keys())
    .filter((dt) => {
      if (query.trim()) return true;
      const d = new Date(dt + "T00:00:00");
      return d.getFullYear() === cursor.year && d.getMonth() === cursor.month;
    })
    .sort();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Deliveries</h1>
        <Button
          variant="secondary"
          size="sm"
          onClick={() =>
            filtered.length
              ? deliveryPaymentPDF(
                  filtered.slice().sort((a, b) => (a.date < b.date ? -1 : 1)),
                  "ALL dates"
                )
              : toast("No deliveries to export.", "info")
          }
        >
          Download PDF (all dates)
        </Button>
      </div>

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="w-full sm:w-80">
            <Field label="Search (client, phone, or transaction ID)">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type to search deliveries…"
              />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={prevMonth}>Previous</Button>
            <span className="min-w-40 text-center text-sm font-semibold">
              {monthLabel(cursor.year, cursor.month)}
            </span>
            <Button variant="ghost" size="sm" onClick={nextMonth}>Next</Button>
          </div>
        </div>

        <p className="mt-3 text-xs text-muted">
          Click a highlighted date to open its orders and manage the delivery
          plan.
        </p>

        {/* Calendar */}
        <div className="mt-3 overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="grid grid-cols-7 gap-1 text-center text-xs font-medium text-muted">
              {WEEKDAYS.map((w) => (
                <div key={w} className="py-1">{w}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {cells.map((iso, i) => {
                if (!iso) return <div key={i} className="h-20 rounded bg-transparent" />;
                const dayOrders = byDate.get(iso) ?? [];
                const has = dayOrders.length > 0;
                const chicks = dayOrders
                  .filter((o) => o.status === "pending")
                  .reduce((s, o) => s + toDeliver(o), 0);
                const isToday = iso === today;
                return (
                  <button
                    key={i}
                    type="button"
                    disabled={!has}
                    onClick={() => openDate(iso)}
                    className={cn(
                      "h-20 rounded-[10px] border p-1.5 text-left transition",
                      has
                        ? "cursor-pointer border-gold bg-gold-bg hover:shadow-[0_3px_12px_rgba(150,115,20,.25)]"
                        : "border-line bg-grey-bg text-muted/60 opacity-60",
                      isToday && "outline outline-2 outline-ink"
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-[0.85rem] font-bold">
                        {Number(iso.slice(8, 10))}
                      </span>
                      {has && (
                        <span className="rounded-full bg-onyx px-1.5 text-[10px] font-bold text-[#f3e9c9]">
                          {dayOrders.length}
                        </span>
                      )}
                    </div>
                    {has && chicks > 0 && (
                      <div className="mt-1 text-[10px] font-semibold leading-tight text-gold-dark">
                        {chicks.toLocaleString()} chicks
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </Card>

      {/* Date summary cards — click to open in Orders */}
      <Card>
        <CardHeader title={query.trim() ? "Matching delivery dates" : "Delivery dates this month"} />
        {summaryDates.length === 0 ? (
          <p className="text-sm text-muted">No deliveries to show.</p>
        ) : (
          <div className="space-y-3">
            {summaryDates.map((dt) => {
              const list = byDate.get(dt)!;
              const pending = list.filter((o) => o.status === "pending");
              const chicks = pending.reduce((s, o) => s + toDeliver(o), 0);
              const advance = list.reduce((s, o) => s + paidAmount(o), 0);
              const bal = pending.reduce((s, o) => s + Math.max(0, balance(o)), 0);
              return (
                <button
                  key={dt}
                  type="button"
                  onClick={() => openDate(dt)}
                  className={cn(
                    "flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-left transition hover:shadow-pop",
                    dt === today ? "border-l-4 border-gold" : "border-line"
                  )}
                >
                  <div>
                    <p className="font-bold">
                      {formatDate(dt)}
                      {dt === today && (
                        <span className="ml-2 text-gold-dark">· TODAY</span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {list.length} order(s) · click to open in Orders
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="rounded-full bg-grey-bg px-3 py-1 font-semibold">
                      {chicks.toLocaleString()} chicks to deliver
                    </span>
                    <span className="rounded-full bg-green-bg px-3 py-1 font-semibold text-green">
                      Advance: {formatRWF(advance)}
                    </span>
                    <span className="rounded-full bg-red-bg px-3 py-1 font-semibold text-red">
                      Balance: {formatRWF(bal)}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

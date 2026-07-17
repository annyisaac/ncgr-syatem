"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "./AuthProvider";
import { useData } from "./DataProvider";
import { cn } from "@/lib/cn";
import { notificationHref } from "@/lib/notifications";
import type { AppNotification, NotificationType } from "@/lib/types";

const TONE: Record<NotificationType, string> = {
  new_order: "bg-gold-bg text-gold-dark",
  payment: "bg-green-bg text-green",
  confirmed: "bg-blue-bg text-blue",
  reschedule: "bg-blue-bg text-blue",
  fulfilled: "bg-green-bg text-green",
  rejected: "bg-red-bg text-red",
  refunded: "bg-red-bg text-red",
  deleted: "bg-red-bg text-red",
};

const LABEL: Record<NotificationType, string> = {
  new_order: "NEW",
  payment: "PAY",
  confirmed: "OK",
  reschedule: "RSC",
  fulfilled: "DLV",
  rejected: "REJ",
  refunded: "RFD",
  deleted: "DEL",
};

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return `${d}d ago`;
}

export function NotificationBell() {
  const { user } = useAuth();
  const { notifications, markNotifications } = useData();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // The bell is an inbox: once read, a notification leaves the list.
  const items = notifications.filter((n) => !n.read);
  const unread = items.length;

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  // Reading it removes it from the list, then we go where it points.
  function openNotification(n: AppNotification) {
    void markNotifications([n.id]);
    setOpen(false);
    if (user) router.push(notificationHref(n, user.role));
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={`Notifications${unread ? ` (${unread} unread)` : ""}`}
        className="relative flex h-10 w-10 items-center justify-center rounded-full border border-line text-ink transition hover:border-ink"
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10 3a4.5 4.5 0 0 0-4.5 4.5c0 3-1 4.5-1.5 5.2a.4.4 0 0 0 .32.63h11.36a.4.4 0 0 0 .32-.63c-.5-.7-1.5-2.2-1.5-5.2A4.5 4.5 0 0 0 10 3Z" />
          <path d="M8.3 16.2a1.9 1.9 0 0 0 3.4 0" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-[1.05rem] items-center justify-center rounded-full bg-red px-1 text-[0.6rem] font-bold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-[320px] max-w-[86vw] overflow-hidden rounded-2xl border border-line bg-paper shadow-pop">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <span className="text-[0.82rem] font-bold text-ink">Notifications</span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => void markNotifications()}
                className="text-[0.72rem] font-semibold text-gold-dark hover:underline"
              >
                Mark all read
              </button>
            )}
          </div>
          <div className="max-h-[60vh] overflow-y-auto">
            {items.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">You&apos;re all caught up.</p>
            ) : (
              items.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => openNotification(n)}
                  className="flex w-full items-start gap-3 border-b border-line bg-gold-bg/30 px-4 py-3 text-left transition hover:bg-grey-bg"
                >
                  <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[0.6rem] font-bold uppercase", TONE[n.type] ?? "bg-grey-bg text-ink")}>
                    {LABEL[n.type] ?? "•"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-[0.82rem] font-semibold text-ink">{n.title}</span>
                      <span className="shrink-0 text-[0.66rem] text-muted">{timeAgo(n.createdAt)}</span>
                    </span>
                    <span className="mt-0.5 block text-[0.76rem] text-muted">{n.body}</span>
                  </span>
                  {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" />}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

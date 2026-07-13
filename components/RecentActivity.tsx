"use client";

import { useData } from "./DataProvider";
import { Card, CardHeader } from "./ui/Card";
import { cn } from "@/lib/cn";
import type { NotificationType } from "@/lib/types";

const CHIP: Record<NotificationType, { label: string; cls: string }> = {
  new_order: { label: "NEW", cls: "bg-gold-bg text-gold-dark" },
  payment: { label: "PAY", cls: "bg-green-bg text-green" },
  reschedule: { label: "RSC", cls: "bg-blue-bg text-blue" },
  rejected: { label: "REJ", cls: "bg-red-bg text-red" },
};

function timeAgo(iso: string): string {
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/** Latest notifications for the signed-in user, shown on their dashboard. */
export function RecentActivity({ limit = 6 }: { limit?: number }) {
  const { notifications } = useData();
  const items = notifications.slice(0, limit);

  return (
    <Card>
      <CardHeader title="Recent activity" />
      {items.length === 0 ? (
        <p className="text-sm text-muted">Nothing yet — new orders, payments and changes will show up here.</p>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => {
            const c = CHIP[n.type] ?? { label: "•", cls: "bg-grey-bg text-ink" };
            return (
              <li
                key={n.id}
                className={cn(
                  "flex items-start gap-3 rounded-xl border border-line p-3",
                  !n.read && "bg-gold-bg/25"
                )}
              >
                <span className={cn("mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[0.6rem] font-bold", c.cls)}>
                  {c.label}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[0.86rem] font-semibold text-ink">{n.title}</span>
                    <span className="shrink-0 text-[0.68rem] text-muted">{timeAgo(n.createdAt)}</span>
                  </div>
                  <p className="text-[0.8rem] text-muted">{n.body}</p>
                </div>
                {!n.read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-gold" />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

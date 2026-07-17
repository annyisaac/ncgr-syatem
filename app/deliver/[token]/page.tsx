"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";

import { getDriverManifest, driverDeliver, type DriverStop } from "@/lib/db";
import { formatDate } from "@/lib/format";

export default function DriverDeliveryPage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [driver, setDriver] = useState<string>("");
  const [stops, setStops] = useState<DriverStop[]>([]);
  const [invalid, setInvalid] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getDriverManifest(token);
    if (!res.ok) {
      setInvalid(true);
    } else {
      setDriver(res.driver ?? "");
      setStops(res.stops ?? []);
    }
    setLoading(false);
  }, [token]);

  useEffect(() => { load(); }, [load]);

  // Group outstanding stops by delivery date.
  const groups = useMemo(() => {
    const m = new Map<string, DriverStop[]>();
    for (const s of stops) {
      const arr = m.get(s.date) ?? [];
      arr.push(s);
      m.set(s.date, arr);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [stops]);

  const totalChicks = stops.reduce((s, o) => s + (o.chicks || 0), 0);

  async function mark(stop: DriverStop, delivered: boolean, why = "") {
    setBusyId(stop.id);
    const res = await driverDeliver(token, stop.id, delivered, why);
    setBusyId(null);
    if (!res.ok) {
      setFlash(res.error === "ALREADY_DELIVERED" ? "That stop was already delivered." : "Could not save — try again.");
      setTimeout(() => setFlash(null), 3000);
      return;
    }
    setReasonFor(null);
    setReason("");
    setFlash(delivered ? `✓ ${stop.name} marked delivered` : `${stop.name} marked not delivered`);
    setTimeout(() => setFlash(null), 2500);
    await load();
  }

  if (loading) {
    return <Screen><p className="text-center text-muted">Loading your deliveries…</p></Screen>;
  }

  if (invalid) {
    return (
      <Screen>
        <div className="rounded-2xl border border-line bg-paper p-6 text-center">
          <p className="text-lg font-semibold text-ink">This delivery link isn&apos;t valid</p>
          <p className="mt-1 text-sm text-muted">Ask the sales team to send you a new link.</p>
        </div>
      </Screen>
    );
  }

  return (
    <Screen>
      <header className="mb-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-gold-dark">NCGR LTD · Delivery</p>
        <h1 className="text-xl font-bold text-ink">{driver || "Driver"}</h1>
        <p className="text-sm text-muted">
          {stops.length === 0
            ? "No deliveries waiting. You're all caught up. 🎉"
            : `${stops.length} stop(s) · ${totalChicks.toLocaleString()} chicks to deliver`}
        </p>
      </header>

      {flash && (
        <div className="sticky top-2 z-10 mb-3 rounded-xl bg-ink px-4 py-2.5 text-center text-sm font-medium text-white shadow-lg">
          {flash}
        </div>
      )}

      {groups.map(([date, list]) => (
        <section key={date} className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-ink">{formatDate(date)}</h2>
          <div className="space-y-3">
            {list.map((s) => (
              <div key={s.id} className="rounded-2xl border border-line bg-paper p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-base font-semibold text-ink">{s.name}</p>
                    <p className="text-sm text-muted">
                      {[s.sector, s.district].filter(Boolean).join(", ") || "—"}
                    </p>
                    {s.routeName && <p className="text-xs text-muted">Route: {s.routeName}{s.pickup ? ` · pickup ${s.pickup}` : ""}</p>}
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-lg font-bold text-ink">{(s.chicks || 0).toLocaleString()}</p>
                    <p className="text-[11px] text-muted">chicks</p>
                  </div>
                </div>

                {s.phone && (
                  <a href={`tel:${s.phone}`} className="mt-2 inline-block text-sm font-medium text-gold-dark underline">
                    📞 {s.phone}
                  </a>
                )}

                {s.failReason && (
                  <p className="mt-2 rounded-lg bg-gold-bg px-2.5 py-1.5 text-xs text-ink">
                    Marked not delivered — {s.failReason}. You can update it below.
                  </p>
                )}

                {reasonFor === s.id ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="Why couldn't it be delivered? (customer absent, wrong number, refused…)"
                      className="w-full rounded-xl border border-line bg-field px-3 py-2 text-sm text-ink focus:outline-none focus-visible:border-gold"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => mark(s, false, reason)}
                        disabled={busyId === s.id}
                        className="flex-1 rounded-xl bg-status-refunded px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                      >
                        {busyId === s.id ? "Saving…" : "Confirm not delivered"}
                      </button>
                      <button
                        onClick={() => { setReasonFor(null); setReason(""); }}
                        className="rounded-xl border border-line px-3 py-2.5 text-sm font-medium text-ink"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => mark(s, true)}
                      disabled={busyId === s.id}
                      className="flex-1 rounded-xl bg-green px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                    >
                      {busyId === s.id ? "Saving…" : "✓ Delivered"}
                    </button>
                    <button
                      onClick={() => { setReasonFor(s.id); setReason(""); }}
                      disabled={busyId === s.id}
                      className="flex-1 rounded-xl border border-line px-3 py-2.5 text-sm font-semibold text-ink disabled:opacity-60"
                    >
                      Not delivered
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      <p className="mt-6 text-center text-xs text-muted">
        Tap “Delivered” once a customer receives their chicks. If you couldn&apos;t deliver, tap “Not delivered”
        and say why — the sales team will follow up.
      </p>
    </Screen>
  );
}

function Screen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-cream px-4 py-6">
      <div className="mx-auto w-full max-w-md">{children}</div>
    </div>
  );
}

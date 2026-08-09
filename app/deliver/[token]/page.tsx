"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";

import { getDriverManifest, driverDeliver, driverConfirmPickup, type DriverStop, type DeliveryProof } from "@/lib/db";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/cn";

// Quick-pick reasons a stop couldn't be delivered (structured, for follow-up).
const FAIL_REASONS = ["Customer absent", "Wrong address", "Customer refused", "Wrong / unreachable number", "Couldn't collect payment", "Other"];

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

  // Pickup confirmation — the driver signs for the whole chick load first.
  const [pickupRequired, setPickupRequired] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pickupSig, setPickupSig] = useState("");
  const [confirming, setConfirming] = useState(false);

  // Proof-of-delivery capture (per stop).
  const [proofFor, setProofFor] = useState<string | null>(null);
  const [gps, setGps] = useState<{ lat: number; lng: number; accuracy?: number } | null>(null);
  const [gpsState, setGpsState] = useState<"idle" | "getting" | "ok" | "error">("idle");
  const [sig, setSig] = useState("");
  const [photo, setPhoto] = useState("");

  function openProof(stopId: string) {
    setProofFor(stopId);
    setGps(null); setSig(""); setPhoto("");
    captureGps();
  }
  function closeProof() {
    setProofFor(null);
    setGps(null); setGpsState("idle"); setSig(""); setPhoto("");
  }
  function captureGps() {
    if (typeof navigator === "undefined" || !navigator.geolocation) { setGpsState("error"); return; }
    setGpsState("getting");
    navigator.geolocation.getCurrentPosition(
      (pos) => { setGps({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }); setGpsState("ok"); },
      () => setGpsState("error"),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }
  async function onPhoto(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    try { setPhoto(await compressImage(file)); } catch { /* ignore */ }
  }

  const load = useCallback(async () => {
    const res = await getDriverManifest(token);
    if (!res.ok) {
      setInvalid(true);
    } else {
      setDriver(res.driver ?? "");
      setStops(res.stops ?? []);
      setPickupRequired(!!res.pickupRequired);
      setConfirmed(!!res.confirmed);
    }
    setLoading(false);
  }, [token]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  const [q, setQ] = useState("");

  // Stops matching the search (customer name / phone / location).
  const shownStops = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return stops;
    return stops.filter((s) =>
      [s.name, s.phone, s.sector, s.district].some((v) => (v ?? "").toLowerCase().includes(term))
    );
  }, [stops, q]);

  // Group the shown stops by delivery date.
  const groups = useMemo(() => {
    const m = new Map<string, DriverStop[]>();
    for (const s of shownStops) {
      const arr = m.get(s.date) ?? [];
      arr.push(s);
      m.set(s.date, arr);
    }
    return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  }, [shownStops]);

  const pendingStops = stops.filter((s) => !s.delivered);
  const deliveredCount = stops.length - pendingStops.length;
  const totalChicks = pendingStops.reduce((s, o) => s + (o.chicks || 0), 0);
  const rossChicks = pendingStops.filter((s) => s.product === "Ross 308").reduce((n, s) => n + (s.chicks || 0), 0);
  const tetraChicks = pendingStops.filter((s) => s.product === "Tetra Super Harco").reduce((n, s) => n + (s.chicks || 0), 0);
  const needsPickup = pickupRequired && !confirmed && pendingStops.length > 0;

  async function confirmPickup() {
    if (!pickupSig) { setFlash("Please sign to confirm the load."); setTimeout(() => setFlash(null), 2500); return; }
    setConfirming(true);
    const res = await driverConfirmPickup(token, totalChicks, pickupSig);
    setConfirming(false);
    if (!res.ok) { setFlash("Could not save — try again."); setTimeout(() => setFlash(null), 3000); return; }
    setPickupSig("");
    setFlash("✓ Load confirmed");
    setTimeout(() => setFlash(null), 2500);
    await load();
  }

  async function mark(stop: DriverStop, delivered: boolean, why = "", proof: DeliveryProof = {}) {
    setBusyId(stop.id);
    const res = await driverDeliver(token, stop.id, delivered, why, proof);
    setBusyId(null);
    if (!res.ok) {
      setFlash(
        res.error === "ALREADY_DELIVERED" ? "That stop was already delivered."
          : res.error === "NOT_ALLOCATED" ? "Not ready — the hatchery hasn't allocated this order yet."
          : "Could not save — try again."
      );
      setTimeout(() => setFlash(null), 3500);
      return;
    }
    setReasonFor(null);
    setReason("");
    closeProof();
    setFlash(delivered ? `✓ ${stop.name} marked delivered` : `${stop.name} marked not delivered`);
    setTimeout(() => setFlash(null), 2500);
    await load();
  }

  function confirmDelivered(stop: DriverStop) {
    const proof: DeliveryProof = {};
    if (gps) proof.gps = gps;
    if (sig) proof.signature = sig;
    if (photo) proof.photo = photo;
    void mark(stop, true, "", proof);
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
      <header className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-gold-dark">NCGR LTD · Delivery</p>
          <h1 className="text-xl font-bold text-ink">{driver || "Driver"}</h1>
          <p className="text-sm text-muted">
            {stops.length === 0
              ? "No deliveries waiting. You're all caught up. 🎉"
              : pendingStops.length === 0
              ? `All delivered 🎉 · ${deliveredCount} today`
              : `${pendingStops.length} stop(s) · ${totalChicks.toLocaleString()} chicks${deliveredCount > 0 ? ` · ${deliveredCount} delivered` : ""}`}
          </p>
        </div>
        {pendingStops.length > 0 && (
          <div className="shrink-0 space-y-1 text-right">
            <div className="rounded-lg bg-blue-bg px-2.5 py-1">
              <span className="text-[10px] font-bold uppercase text-blue">Ross</span>{" "}
              <span className="text-sm font-bold tabular-nums text-ink">{rossChicks.toLocaleString()}</span>
            </div>
            <div className="rounded-lg bg-gold-bg px-2.5 py-1">
              <span className="text-[10px] font-bold uppercase text-gold-dark">Tetra</span>{" "}
              <span className="text-sm font-bold tabular-nums text-ink">{tetraChicks.toLocaleString()}</span>
            </div>
          </div>
        )}
      </header>

      {stops.length > 0 && (
        <div className="sticky top-0 z-20 mb-3 bg-cream pb-2 pt-1">
          <div className="relative">
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden><circle cx="9" cy="9" r="5.5" /><path d="m13.5 13.5 3.5 3.5" /></svg>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search customer, phone, location…" className="h-11 w-full rounded-xl border border-line bg-paper pl-10 pr-14 text-sm text-ink outline-none focus:border-gold" />
            {q && <button type="button" onClick={() => setQ("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-gold-dark">Clear</button>}
          </div>
        </div>
      )}

      {flash && (
        <div className="sticky top-14 z-10 mb-3 rounded-xl bg-ink px-4 py-2.5 text-center text-sm font-medium text-white shadow-lg">
          {flash}
        </div>
      )}

      {needsPickup && (
        <div className="mb-4 rounded-2xl border-2 border-gold bg-gold-bg/40 p-4">
          <p className="text-base font-bold text-ink">Confirm the chicks you&apos;re taking</p>
          <p className="mt-0.5 text-sm text-muted">You&apos;re carrying <strong className="text-ink">{totalChicks.toLocaleString()} chicks</strong> across {stops.length} stop(s). Sign below to confirm you&apos;ve received them, then start your deliveries.</p>
          <div className="mt-3">
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-semibold text-ink">Your signature</span>
              {pickupSig && <button type="button" onClick={() => setPickupSig("")} className="text-xs text-gold-dark underline">Clear</button>}
            </div>
            <SignaturePad onChange={setPickupSig} cleared={!pickupSig} />
          </div>
          <button onClick={confirmPickup} disabled={confirming || !pickupSig} className="mt-3 w-full rounded-xl bg-green px-3 py-3 text-sm font-bold text-white disabled:opacity-60">
            {confirming ? "Saving…" : "✓ Confirm & start deliveries"}
          </button>
        </div>
      )}

      {pickupRequired && confirmed && stops.length > 0 && (
        <div className="mb-3 rounded-xl bg-green-bg px-3 py-2 text-center text-xs font-semibold text-green">✓ Load confirmed — you can deliver.</div>
      )}

      {groups.map(([date, list]) => (
        <section key={date} className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-ink">{formatDate(date)}</h2>
          <div className="space-y-3">
            {list.map((s) => (
              <div key={s.id} className={cn("rounded-2xl border p-4 shadow-sm", s.delivered ? "border-green/40 bg-green-bg/30" : "border-line bg-paper")}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-base font-semibold text-ink">{s.name}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${s.product === "Ross 308" ? "bg-blue-bg text-blue" : "bg-gold-bg text-gold-dark"}`}>
                        {s.product === "Ross 308" ? "Ross" : "Tetra"}
                      </span>
                    </div>
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

                <p className="mt-2 rounded-lg bg-cream px-2.5 py-1.5 text-xs text-ink">
                  <span className="font-semibold">{s.ordered.toLocaleString()}</span> ordered
                  {" · +"}<span className="font-semibold">{s.extra.toLocaleString()}</span> (2% extra)
                  {s.comp > 0 && <> · +<span className="font-semibold">{s.comp.toLocaleString()}</span> comp</>}
                  {" = "}<span className="font-semibold">{(s.chicks || 0).toLocaleString()}</span> to deliver
                </p>

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

                {s.delivered ? (
                  <div className="mt-3 rounded-lg bg-green px-3 py-2 text-center text-sm font-bold text-white">✓ Delivered</div>
                ) : reasonFor === s.id ? (
                  <div className="mt-3 space-y-2">
                    <div className="flex flex-wrap gap-1.5">
                      {FAIL_REASONS.map((r) => {
                        const on = r === "Other" ? !FAIL_REASONS.slice(0, -1).includes(reason) : reason === r;
                        return (
                          <button
                            key={r}
                            type="button"
                            onClick={() => setReason(r === "Other" ? "" : r)}
                            className={cn(
                              "rounded-full border px-3 py-1.5 text-xs font-semibold transition",
                              on ? "border-gold bg-gold text-[#231b04]" : "border-line bg-field text-ink"
                            )}
                          >
                            {r}
                          </button>
                        );
                      })}
                    </div>
                    <textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      rows={2}
                      placeholder="Add any detail (optional)…"
                      className="w-full rounded-xl border border-line bg-field px-3 py-2 text-sm text-ink focus:outline-none focus-visible:border-gold"
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => mark(s, false, reason)}
                        disabled={busyId === s.id || !reason.trim()}
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
                ) : proofFor === s.id ? (
                  <div className="mt-3 space-y-3">
                    <p className="text-xs font-semibold text-ink">Proof of delivery (optional)</p>
                    {/* GPS */}
                    <div className="flex items-center justify-between rounded-xl border border-line bg-field px-3 py-2 text-sm">
                      <span className="text-ink">
                        📍 Location{" "}
                        {gpsState === "getting" && <span className="text-muted">— getting…</span>}
                        {gpsState === "ok" && gps && <span className="text-green">captured ✓</span>}
                        {gpsState === "error" && <span className="text-status-refunded">unavailable</span>}
                      </span>
                      <button type="button" onClick={captureGps} className="text-xs font-semibold text-gold-dark underline">{gps ? "Recapture" : "Capture"}</button>
                    </div>
                    {/* Signature */}
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold text-ink">Customer signature</span>
                        {sig && <button type="button" onClick={() => setSig("")} className="text-xs text-gold-dark underline">Clear</button>}
                      </div>
                      <SignaturePad onChange={setSig} cleared={!sig} />
                    </div>
                    {/* Photo */}
                    <div>
                      <div className="mb-1 flex items-center justify-between">
                        <span className="text-xs font-semibold text-ink">Delivery photo</span>
                        {photo && <button type="button" onClick={() => setPhoto("")} className="text-xs text-gold-dark underline">Remove</button>}
                      </div>
                      {photo ? (
                        // eslint-disable-next-line @next/next/no-img-element -- runtime data URL, not a static asset
                        <img src={photo} alt="delivery" className="h-28 w-full rounded-xl border border-line object-cover" />
                      ) : (
                        <label className="flex h-12 cursor-pointer items-center justify-center rounded-xl border border-dashed border-line text-sm text-muted">
                          📷 Take / choose photo
                          <input type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
                        </label>
                      )}
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => confirmDelivered(s)}
                        disabled={busyId === s.id}
                        className="flex-1 rounded-xl bg-green px-3 py-2.5 text-sm font-bold text-white disabled:opacity-60"
                      >
                        {busyId === s.id ? "Saving…" : "✓ Confirm delivery"}
                      </button>
                      <button onClick={closeProof} className="rounded-xl border border-line px-3 py-2.5 text-sm font-medium text-ink">Cancel</button>
                    </div>
                  </div>
                ) : needsPickup ? (
                  <p className="mt-3 rounded-lg bg-gold-bg px-2.5 py-1.5 text-xs font-medium text-gold-dark">Confirm your chick load at the top before delivering.</p>
                ) : (
                  <div className="mt-3">
                    {!s.allocated && (
                      <p className="mb-2 rounded-lg bg-gold-bg px-2.5 py-1.5 text-xs font-medium text-gold-dark">
                        ⏳ Waiting for the hatchery to allocate these chicks — you can deliver once it&apos;s marked ready.
                      </p>
                    )}
                    <div className="flex gap-2">
                      <button
                        onClick={() => openProof(s.id)}
                        disabled={busyId === s.id || !s.allocated}
                        title={s.allocated ? undefined : "Waiting for hatchery allocation"}
                        className="flex-1 rounded-xl bg-green px-3 py-2.5 text-sm font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
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
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}

      {stops.length > 0 && groups.length === 0 && (
        <p className="rounded-2xl border border-line bg-paper p-6 text-center text-sm text-muted">No stops match &ldquo;{q}&rdquo;.</p>
      )}

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

/** A finger/stylus signature pad. Emits a PNG data URL when a stroke ends. */
function SignaturePad({ onChange, cleared }: { onChange: (dataUrl: string) => void; cleared: boolean }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const rect = c.getBoundingClientRect();
    c.width = rect.width * 2;
    c.height = rect.height * 2;
    const ctx = c.getContext("2d");
    if (ctx) { ctx.scale(2, 2); ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 2; ctx.lineCap = "round"; ctx.lineJoin = "round"; }
  }, []);

  useEffect(() => {
    if (!cleared) return;
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) ctx.clearRect(0, 0, c.width, c.height);
  }, [cleared]);

  const at = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  function down(e: React.PointerEvent) { e.preventDefault(); drawing.current = true; last.current = at(e); ref.current?.setPointerCapture(e.pointerId); }
  function move(e: React.PointerEvent) {
    if (!drawing.current) return;
    const ctx = ref.current?.getContext("2d");
    const p = at(e);
    if (ctx && last.current) { ctx.beginPath(); ctx.moveTo(last.current.x, last.current.y); ctx.lineTo(p.x, p.y); ctx.stroke(); }
    last.current = p;
  }
  function up() {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const d = ref.current?.toDataURL("image/png");
    if (d) onChange(d);
  }

  return (
    <canvas
      ref={ref}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerLeave={up}
      className="h-28 w-full touch-none rounded-xl border border-line bg-white"
    />
  );
}

/** Downscale + JPEG-compress a photo to a small data URL (no storage bucket). */
function compressImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const max = 900;
      const scale = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) return reject(new Error("no-canvas"));
      ctx.drawImage(img, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad-image")); };
    img.src = url;
  });
}

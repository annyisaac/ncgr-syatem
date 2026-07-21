"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

import { COMPANY, ALL_DISTRICTS } from "@/lib/config";
import { eventPublicInfo, registerVisitor } from "@/lib/events";

const CATEGORIES = ["Farmer", "Agrovet / Retailer", "Cooperative", "Wholesaler / Trader", "Individual", "Other"];
const PRODUCTS = ["Ross 308", "Tetra Super Harco"];
const CONTACT_METHODS = ["Phone call", "SMS", "WhatsApp", "Email"];
const INPUT = "h-12 w-full rounded-lg border border-line bg-field px-4 text-[0.9rem] text-ink outline-none transition focus:border-gold";

export default function VisitRegisterPage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [event, setEvent] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [district, setDistrict] = useState("");
  const [category, setCategory] = useState("");
  const [products, setProducts] = useState<string[]>([]);
  const [plannedChicks, setPlannedChicks] = useState("");
  const [purchaseMonth, setPurchaseMonth] = useState("");
  const [contactMethod, setContactMethod] = useState("");
  const [consent, setConsent] = useState(false);

  const toggleProduct = (p: string) =>
    setProducts((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const load = useCallback(async () => {
    const res = await eventPublicInfo(token);
    if (!res.ok) setInvalid(true);
    else setEvent(res.event ?? "");
    setLoading(false);
  }, [token]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!name.trim()) return setErr("Please enter your full name.");
    if (phone.replace(/\D/g, "").length < 6) return setErr("Please enter a valid phone number.");
    setBusy(true);
    const res = await registerVisitor(token, {
      name: name.trim(),
      phone: phone.trim(),
      district,
      category,
      products: products.join(", "),
      plannedChicks: Number(plannedChicks) || 0,
      purchaseMonth,
      contactMethod,
      consent,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "Could not submit.");
    setDone(true);
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[linear-gradient(135deg,#f6e4b4_0%,#f1dfa6_38%,#e7e6c4_68%,#dde7cf_100%)] p-4">
      <div className="w-full max-w-[460px] rounded-[28px] bg-paper px-6 py-6 shadow-pop sm:px-8">
        <Image
          src={COMPANY.logoPath}
          alt={`${COMPANY.name} logo`}
          width={240}
          height={80}
          className="mx-auto h-20 w-auto object-contain"
          priority
          unoptimized
        />

        {loading ? (
          <p className="mt-6 text-center text-sm text-muted">Loading…</p>
        ) : invalid ? (
          <div className="mt-6 text-center">
            <p className="text-lg font-bold text-ink">Registration closed</p>
            <p className="mt-1 text-sm text-muted">This link is not active. Please ask our team for a current one.</p>
          </div>
        ) : done ? (
          <div className="mt-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-bg text-green">
              <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5 8 14l8-8" /></svg>
            </div>
            <p className="mt-3 text-lg font-bold text-ink">Thank you, {name.trim().split(" ")[0]}!</p>
            <p className="mt-1 text-sm text-muted">You&apos;re registered for {event || "our event"}. We look forward to meeting you.</p>
          </div>
        ) : (
          <>
            <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-ink">{event || "Visitor registration"}</h1>
            <p className="mt-1 text-center text-sm text-muted">Register to visit us — it only takes a moment.</p>
            <div className="mx-auto mt-3 h-[3px] w-14 rounded-full bg-gold" />

            <form onSubmit={submit} className="mt-5 space-y-3.5">
              <Field label="Full name">
                <input value={name} onChange={(e) => setName(e.target.value)} required
                  className={INPUT} />
              </Field>
              <Field label="Phone number">
                <input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="07xxxxxxxx"
                  className={INPUT} />
              </Field>
              <Field label="District">
                <select value={district} onChange={(e) => setDistrict(e.target.value)} className={INPUT}>
                  <option value="">Select district</option>
                  {ALL_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Customer category">
                <select value={category} onChange={(e) => setCategory(e.target.value)} className={INPUT}>
                  <option value="">Select category</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Products interested in">
                <div className="flex flex-wrap gap-2">
                  {PRODUCTS.map((p) => {
                    const on = products.includes(p);
                    return (
                      <button key={p} type="button" onClick={() => toggleProduct(p)}
                        className={`rounded-lg border px-3.5 py-2 text-[0.85rem] font-semibold transition ${on ? "border-gold bg-gold text-[#231b04]" : "border-line bg-field text-ink hover:border-gold"}`}>
                        {on ? "✓ " : ""}{p}
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Planned number of chicks">
                <input type="number" min={0} inputMode="numeric" value={plannedChicks} onChange={(e) => setPlannedChicks(e.target.value)} placeholder="e.g. 500"
                  className={INPUT} />
              </Field>
              <Field label="Expected purchase month">
                <input type="month" value={purchaseMonth} onChange={(e) => setPurchaseMonth(e.target.value)} className={INPUT} />
              </Field>
              <Field label="Preferred contact method">
                <select value={contactMethod} onChange={(e) => setContactMethod(e.target.value)} className={INPUT}>
                  <option value="">Select method</option>
                  {CONTACT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>

              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line bg-field px-3.5 py-3">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)}
                  className="mt-0.5 h-5 w-5 shrink-0 accent-gold" />
                <span className="text-[0.85rem] leading-snug text-ink">
                  I consent to receive updates and offers from {COMPANY.name} about chicks and events.
                </span>
              </label>

              {err && <p className="rounded-xl border border-red/20 bg-red-bg px-4 py-3 text-sm font-semibold text-red">{err}</p>}

              <button type="submit" disabled={busy}
                className="flex h-12 w-full items-center justify-center rounded-lg bg-gold text-[0.95rem] font-bold text-ink transition hover:bg-gold-dark hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? "Submitting…" : "Register"}
              </button>
            </form>
          </>
        )}

        <p className="mt-5 text-center text-[0.7rem] text-muted">© {new Date().getFullYear()} {COMPANY.name}</p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-muted">{label}</label>
      {children}
    </div>
  );
}

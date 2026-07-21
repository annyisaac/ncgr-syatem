"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

import { COMPANY, ALL_DISTRICTS } from "@/lib/config";
import { eventPublicInfo, registerVisitor } from "@/lib/events";

const INTERESTS = ["Ross 308", "Tetra Super Harco", "Both", "Just visiting"];

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
  const [interest, setInterest] = useState("");
  const [note, setNote] = useState("");

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
    if (!name.trim()) return setErr("Please enter your name.");
    if (phone.replace(/\D/g, "").length < 6) return setErr("Please enter a valid phone number.");
    setBusy(true);
    const res = await registerVisitor(token, {
      name: name.trim(), phone: phone.trim(), district, interest, note: note.trim(),
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
              <Field label="Your name">
                <input value={name} onChange={(e) => setName(e.target.value)} required
                  className="h-12 w-full rounded-lg border border-line bg-field px-4 text-[0.9rem] text-ink outline-none transition focus:border-gold" />
              </Field>
              <Field label="Phone">
                <input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} required placeholder="07xxxxxxxx"
                  className="h-12 w-full rounded-lg border border-line bg-field px-4 text-[0.9rem] text-ink outline-none transition focus:border-gold" />
              </Field>
              <Field label="District (optional)">
                <select value={district} onChange={(e) => setDistrict(e.target.value)}
                  className="h-12 w-full rounded-lg border border-line bg-field px-3 text-[0.9rem] text-ink outline-none transition focus:border-gold">
                  <option value="">Select district</option>
                  {ALL_DISTRICTS.map((d) => <option key={d} value={d}>{d}</option>)}
                </select>
              </Field>
              <Field label="Interested in (optional)">
                <select value={interest} onChange={(e) => setInterest(e.target.value)}
                  className="h-12 w-full rounded-lg border border-line bg-field px-3 text-[0.9rem] text-ink outline-none transition focus:border-gold">
                  <option value="">Select</option>
                  {INTERESTS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>
              <Field label="Note (optional)">
                <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything you'd like us to know"
                  className="h-12 w-full rounded-lg border border-line bg-field px-4 text-[0.9rem] text-ink outline-none transition focus:border-gold" />
              </Field>

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

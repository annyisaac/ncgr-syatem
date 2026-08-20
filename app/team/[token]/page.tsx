"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Image from "next/image";

import { COMPANY } from "@/lib/config";
import { teamLinkInfo, submitTeamDetail, type Child } from "@/lib/team";

const MARITAL = ["Single", "Married", "Divorced", "Widowed"];
const INPUT = "h-12 w-full rounded-lg border border-line bg-field px-4 text-[0.9rem] text-ink outline-none transition focus:border-gold";

const digits = (s: string) => (s ?? "").replace(/\D/g, "");
const is16 = (s: string) => /^\d{16}$/.test((s ?? "").trim());

export default function TeamDetailPage() {
  const { token } = useParams<{ token: string }>();

  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [invalid, setInvalid] = useState(false);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const [fullName, setFullName] = useState("");
  const [nationalId, setNationalId] = useState("");
  const [phone, setPhone] = useState("");
  const [position, setPosition] = useState("");
  const [maritalStatus, setMaritalStatus] = useState("");
  const [spouseName, setSpouseName] = useState("");
  const [spouseId, setSpouseId] = useState("");
  const [children, setChildren] = useState<Child[]>([]);

  const married = maritalStatus === "Married";
  // A single person doesn't record children/spouse — children only apply to a
  // current or former marriage (Married / Divorced / Widowed).
  const canHaveChildren = maritalStatus !== "" && maritalStatus !== "Single";

  const addChild = () => setChildren((c) => [...c, { name: "", nationalId: "", birthDate: "" }]);
  const removeChild = (i: number) => setChildren((c) => c.filter((_, idx) => idx !== i));
  const setChild = (i: number, patch: Partial<Child>) =>
    setChildren((c) => c.map((ch, idx) => (idx === i ? { ...ch, ...patch } : ch)));

  const load = useCallback(async () => {
    const res = await teamLinkInfo(token);
    if (!res.ok) setInvalid(true);
    else setTitle(res.title ?? "");
    setLoading(false);
  }, [token]);

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!fullName.trim()) return setErr("Please enter your full name.");
    if (!is16(nationalId)) return setErr("National ID must be exactly 16 digits.");
    if (digits(phone).length < 10) return setErr("Enter a valid phone number (at least 10 digits).");
    if (!position.trim()) return setErr("Please enter your position / department.");
    if (!maritalStatus) return setErr("Please select your marital status.");
    if (married) {
      if (!spouseName.trim()) return setErr("Please enter your spouse's name.");
      if (!is16(spouseId)) return setErr("Spouse National ID must be exactly 16 digits.");
    }
    // Drop accidental fully-blank child rows; every remaining child must be complete.
    const rows = children.filter((c) => c.name.trim() || (c.nationalId ?? "").trim() || (c.birthDate ?? ""));
    for (let i = 0; i < rows.length; i++) {
      const c = rows[i];
      if (!c.name.trim()) return setErr(`Enter child ${i + 1}'s full name.`);
      if (!is16(c.nationalId ?? "")) return setErr(`Child ${i + 1}'s ID must be exactly 16 digits.`);
      if (!(c.birthDate ?? "")) return setErr(`Enter child ${i + 1}'s date of birth.`);
    }
    const cleanKids = rows.map((c) => ({ name: c.name.trim(), nationalId: (c.nationalId ?? "").trim(), birthDate: c.birthDate ?? "" }));
    setBusy(true);
    const res = await submitTeamDetail(token, {
      fullName: fullName.trim(),
      nationalId: nationalId.trim(),
      phone: phone.trim(),
      position: position.trim(),
      maritalStatus,
      spouseName: married ? spouseName.trim() : "",
      spouseId: married ? spouseId.trim() : "",
      children: cleanKids,
    });
    setBusy(false);
    if (!res.ok) return setErr(res.error ?? "Could not submit.");
    setDone(true);
  }

  return (
    <div className="grid min-h-screen place-items-center bg-[linear-gradient(135deg,#f6e4b4_0%,#f1dfa6_38%,#e7e6c4_68%,#dde7cf_100%)] p-4">
      <div className="w-full max-w-[520px] rounded-[28px] bg-paper px-6 py-6 shadow-pop sm:px-8">
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
            <p className="text-lg font-bold text-ink">Form closed</p>
            <p className="mt-1 text-sm text-muted">This link is not active. Please ask HR / your manager for a current one.</p>
          </div>
        ) : done ? (
          <div className="mt-6 text-center">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-bg text-green">
              <svg width="26" height="26" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 10.5 8 14l8-8" /></svg>
            </div>
            <p className="mt-3 text-lg font-bold text-ink">Thank you, {fullName.trim().split(" ")[0]}!</p>
            <p className="mt-1 text-sm text-muted">Your details have been submitted to {COMPANY.name}. If anything changes, open this link again to update them.</p>
          </div>
        ) : (
          <>
            <h1 className="mt-4 text-center text-2xl font-bold tracking-tight text-ink">{title || "Team member details"}</h1>
            <p className="mt-1 text-center text-sm text-muted">Please confirm and correct your details below. Your information is kept confidential.</p>
            <div className="mx-auto mt-3 h-[3px] w-14 rounded-full bg-gold" />

            <form onSubmit={submit} className="mt-5 space-y-3.5">
              <Section>Your details</Section>
              <Field label="Full name" required>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className={INPUT} />
              </Field>
              <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
                <Field label="National ID" required>
                  <input value={nationalId} onChange={(e) => setNationalId(digits(e.target.value).slice(0, 16))} inputMode="numeric" maxLength={16} placeholder="16 digits" className={INPUT} />
                </Field>
                <Field label="Phone number" required>
                  <input type="tel" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="07xxxxxxxx" className={INPUT} />
                </Field>
              </div>
              <Field label="Position / department" required>
                <input value={position} onChange={(e) => setPosition(e.target.value)} placeholder="e.g. Sales, Hatchery attendant" className={INPUT} />
              </Field>

              <Section>Family</Section>
              <Field label="Marital status" required>
                <select value={maritalStatus} onChange={(e) => {
                  const v = e.target.value;
                  setMaritalStatus(v);
                  if (v === "Single") setChildren([]);       // single → no children
                  if (v !== "Married") { setSpouseName(""); setSpouseId(""); }
                }} className={INPUT}>
                  <option value="">Select status</option>
                  {MARITAL.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </Field>

              {married && (
                <div className="grid grid-cols-1 gap-3.5 rounded-xl border border-line bg-field/60 p-3.5 sm:grid-cols-2">
                  <Field label="Spouse name (wife / husband)" required>
                    <input value={spouseName} onChange={(e) => setSpouseName(e.target.value)} className={INPUT} />
                  </Field>
                  <Field label="Spouse National ID" required>
                    <input value={spouseId} onChange={(e) => setSpouseId(digits(e.target.value).slice(0, 16))} inputMode="numeric" maxLength={16} placeholder="16 digits" className={INPUT} />
                  </Field>
                </div>
              )}

              {canHaveChildren && (
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-muted">Children</label>
                  <button type="button" onClick={addChild} className="rounded-lg border border-gold px-3 py-1.5 text-xs font-semibold text-gold-dark transition hover:bg-gold hover:text-[#231b04]">＋ Add child</button>
                </div>
                {children.length === 0 ? (
                  <p className="rounded-xl border border-dashed border-line px-3.5 py-3 text-sm text-muted">No children added. Tap “Add child” for each child — name, 16-digit ID and date of birth are all required per child.</p>
                ) : (
                  <div className="space-y-3">
                    {children.map((c, i) => (
                      <div key={i} className="rounded-xl border border-line bg-field/60 p-3.5">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-bold uppercase tracking-wide text-muted">Child {i + 1}</span>
                          <button type="button" onClick={() => removeChild(i)} className="text-xs font-semibold text-red hover:underline">Remove</button>
                        </div>
                        <div className="space-y-3">
                          <input value={c.name} onChange={(e) => setChild(i, { name: e.target.value })} placeholder="Child's full name" className={INPUT} />
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <input value={c.nationalId ?? ""} onChange={(e) => setChild(i, { nationalId: digits(e.target.value).slice(0, 16) })} inputMode="numeric" maxLength={16} placeholder="16-digit ID" className={INPUT} />
                            <input type="date" value={c.birthDate ?? ""} onChange={(e) => setChild(i, { birthDate: e.target.value })} className={INPUT} />
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              )}

              {err && <p className="rounded-xl border border-red/20 bg-red-bg px-4 py-3 text-sm font-semibold text-red">{err}</p>}

              <button type="submit" disabled={busy}
                className="flex h-12 w-full items-center justify-center rounded-lg bg-gold text-[0.95rem] font-bold text-ink transition hover:bg-gold-dark hover:text-white disabled:cursor-not-allowed disabled:opacity-60">
                {busy ? "Submitting…" : "Submit my details"}
              </button>
            </form>
          </>
        )}

        <p className="mt-5 text-center text-[0.7rem] text-muted">© {new Date().getFullYear()} {COMPANY.name} · Confidential</p>
      </div>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[0.7rem] font-bold uppercase tracking-wider text-muted">{label}{required && <span className="text-red"> *</span>}</label>
      {children}
    </div>
  );
}

function Section({ children }: { children: React.ReactNode }) {
  return <p className="pt-1 text-[0.72rem] font-bold uppercase tracking-wide text-gold-dark">{children}</p>;
}

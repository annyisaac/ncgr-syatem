"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { COMPANY } from "@/lib/config";
import { homeForRole } from "@/lib/permissions";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already logged in → go to the role's home.
  useEffect(() => {
    if (!loading && user) router.replace(homeForRole(user.role));
  }, [loading, user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setSubmitting(true);
    const res = await login(email.trim(), password);
    setSubmitting(false);
    if (!res.ok) setError(res.error ?? "Login failed.");
    // On success the effect above redirects to the role's home.
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-[1.05fr_1fr]">
      {/* Brand panel — hidden on small screens */}
      <div className="relative hidden overflow-hidden bg-onyx p-12 text-white lg:flex lg:flex-col lg:justify-between">
        {/* Decorative gold glows */}
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-96 w-96 rounded-full bg-gold/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-gold/10 blur-3xl" />

        <div className="relative z-10 inline-flex w-fit items-center rounded-2xl bg-white px-4 py-3 shadow-pop">
          <Image
            src={COMPANY.logoPath}
            alt={`${COMPANY.name} logo`}
            width={190}
            height={64}
            className="h-14 w-auto object-contain"
            priority
            unoptimized
          />
        </div>

        <div className="relative z-10 max-w-md">
          <h2 className="text-[2.1rem] font-bold leading-tight tracking-tight">
            Run your hatchery &amp; sales from one place.
          </h2>
          <p className="mt-4 text-[1rem] leading-relaxed text-white/70">
            Orders, deliveries, DSRs, incubation and inventory — every part of
            {" "}{COMPANY.name} in a single, secure dashboard.
          </p>
          <ul className="mt-7 space-y-3 text-[0.92rem] text-white/85">
            {["Real-time orders & delivery planning", "Hatchery incubation & inventory tracking", "Role-based access for every team"].map((t) => (
              <li key={t} className="flex items-center gap-3">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-gold/20 text-gold">
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 10l3.5 3.5L15 7" /></svg>
                </span>
                {t}
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 text-[0.75rem] text-white/45">
          {COMPANY.name} · {COMPANY.address}
        </p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-cream px-4 py-10 sm:px-8">
        <div className="w-full max-w-[400px]">
          {/* Logo (shown when the brand panel is hidden) */}
          <div className="mb-8 flex justify-center lg:hidden">
            <Image
              src={COMPANY.logoPath}
              alt={`${COMPANY.name} logo`}
              width={180}
              height={60}
              className="brand-logo h-14 w-auto object-contain"
              priority
              unoptimized
            />
          </div>

          <div className="mb-7">
            <h1 className="text-[1.6rem] font-bold tracking-tight text-ink">Welcome back</h1>
            <p className="mt-1 text-[0.92rem] text-muted">Sign in to continue to your dashboard.</p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4">
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@ncgrltd.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                className="py-3 text-[1rem]"
              />
            </Field>

            <Field label="Password" htmlFor="password">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                className="py-3 text-[1rem]"
              />
            </Field>

            {error && (
              <p className="rounded-lg border border-red/20 bg-red-bg px-3 py-2.5 text-sm font-semibold text-red">
                {error}
              </p>
            )}

            <Button
              type="submit"
              className="w-full py-3 text-[1rem]"
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 rounded-xl border border-line bg-paper px-4 py-3 text-[0.8rem] leading-relaxed text-muted">
            <span className="font-semibold text-ink">DSRs:</span> sign in here with
            your own email and password, then confirm your zone-manager code on a
            new device.
          </p>

          <p className="mt-6 text-center text-[0.72rem] text-muted">
            {COMPANY.name} — {COMPANY.tagline}
          </p>
        </div>
      </div>
    </div>
  );
}

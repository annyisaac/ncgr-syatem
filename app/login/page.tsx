"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/components/AuthProvider";
import { COMPANY } from "@/lib/config";
import { homeForRole } from "@/lib/permissions";

/** Left-panel selling points. */
const POINTS: { icon: keyof typeof ICONS; label: string }[] = [
  { icon: "shield", label: "Enterprise-grade security" },
  { icon: "people", label: "Access for authorized personnel only" },
  { icon: "cloud", label: "Secure cloud platform" },
  { icon: "bolt", label: "Fast and reliable performance" },
];

const ICONS = {
  shield: "M10 2.5 4 5v4.6c0 3.6 2.5 6.9 6 7.9 3.5-1 6-4.3 6-7.9V5l-6-2.5Zm2.7 5.6-3.3 3.4-1.9-1.9",
  people:
    "M13.5 16v-1.3a2.7 2.7 0 0 0-2.7-2.7H5.9a2.7 2.7 0 0 0-2.7 2.7V16M8.3 9.3a2.7 2.7 0 1 0 0-5.3 2.7 2.7 0 0 0 0 5.3ZM17 16v-1.3a2.7 2.7 0 0 0-2-2.6M13.7 4.1a2.7 2.7 0 0 1 0 5.2",
  cloud: "M14.5 14a3 3 0 0 0 .4-6 4.5 4.5 0 0 0-8.7-1.1A3.5 3.5 0 0 0 6.5 14h8Z",
  bolt: "M11.5 2.5 4 11.5h5l-.5 6 7.5-9h-5l.5-6Z",
  mail: "M3.5 5.5h13v9h-13v-9Zm0 .5 6.5 5 6.5-5",
  lock: "M6 9V6.8a4 4 0 1 1 8 0V9M5 9h10v7.5H5V9Z",
  pin: "M10 17.5s5.5-4.7 5.5-8.5a5.5 5.5 0 1 0-11 0c0 3.8 5.5 8.5 5.5 8.5Zm0-6.8a1.8 1.8 0 1 0 0-3.5 1.8 1.8 0 0 0 0 3.5Z",
} as const;

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [remember, setRemember] = useState(true);
  const [forgot, setForgot] = useState(false);
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
    const res = await login(email.trim(), password, remember);
    setSubmitting(false);
    if (!res.ok) setError(res.error ?? "Login failed.");
    // On success the effect above redirects to the role's home.
  }

  return (
    <div className="grid min-h-screen bg-[linear-gradient(135deg,#f6dc9f_0%,#f0c66f_55%,#ecbb5a_100%)] lg:h-screen lg:grid-cols-[52fr_48fr] lg:overflow-hidden">
      {/* Brand panel — hidden on small screens */}
      <div className="relative hidden flex-col justify-between overflow-hidden p-10 lg:flex lg:p-12">
        <Image
          src="/tetra-chicks.jpeg"
          alt=""
          fill
          sizes="52vw"
          className="object-cover object-center"
          priority
          aria-hidden
        />
        {/* Light warm wash only — the photo's own blurred field is what carries
            this panel, so the scrim lifts contrast for the copy without
            bleaching the picture out. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 bg-[linear-gradient(100deg,rgba(255,248,230,0.78)_0%,rgba(255,248,230,0.52)_30%,rgba(255,251,238,0.22)_58%,rgba(255,255,255,0)_82%)]"
        />

        <Image
          src={COMPANY.logoPath}
          alt={`${COMPANY.name} logo`}
          width={420}
          height={140}
          className="relative z-10 h-28 w-auto object-contain"
          priority
          unoptimized
        />

        <div className="relative z-10 max-w-md">
          <h2 className="text-[2.9rem] font-bold leading-[1.12] tracking-tight text-ink">
            Empowering
            <br />
            Better Business
            <br />
            <span className="text-gold-dark">Decisions.</span>
          </h2>
          <p className="mt-6 max-w-[19rem] text-[1.05rem] leading-relaxed text-ink/80">
            A secure digital platform built to help our team work smarter, faster
            and more efficiently.
          </p>

          <ul className="mt-9 space-y-4">
            {POINTS.map((p) => (
              <li key={p.label} className="flex items-center gap-4">
                <span className="flex h-[52px] w-[52px] shrink-0 items-center justify-center rounded-2xl bg-white text-gold-dark shadow-card">
                  <Icon d={ICONS[p.icon]} size={22} />
                </span>
                <span className="max-w-[12rem] text-[1rem] font-medium leading-snug text-ink">
                  {p.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <p className="relative z-10 inline-flex w-fit items-center gap-2.5 rounded-full bg-white/85 px-5 py-3 text-[0.85rem] font-medium text-ink shadow-card backdrop-blur">
          <span className="text-gold-dark">
            <Icon d={ICONS.pin} size={17} />
          </span>
          {COMPANY.name} <span className="text-muted">•</span> {COMPANY.address}
        </p>
      </div>

      {/* Form panel — a tall card inset over the warm page background */}
      <div className="flex p-3 sm:p-5 lg:min-h-0">
        <div className="flex flex-1 flex-col justify-center overflow-y-auto rounded-[28px] bg-paper px-6 py-6 shadow-pop sm:px-10 lg:px-14">
          <div className="mx-auto w-full max-w-[520px]">
          <Image
            src="/logo-running.jpg"
            alt={`${COMPANY.name} logo`}
            width={520}
            height={302}
            className="mx-auto h-auto w-full max-w-[260px] object-contain"
            priority
            unoptimized
          />

          <h1 className="mt-3 text-center text-[2.2rem] font-bold tracking-tight text-ink">
            Welcome back
          </h1>
          <p className="mt-1.5 text-center text-[1rem] text-muted">
            Sign in to access your secure workspace.
          </p>
          <div className="mx-auto mt-4 h-1 w-16 rounded-full bg-gold" />

          <form onSubmit={onSubmit} className="mt-6 space-y-4">
            <div className="space-y-2">
              <label htmlFor="email" className="block text-[0.75rem] font-bold uppercase tracking-[0.09em] text-muted">
                Email
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted">
                  <Icon d={ICONS.mail} size={20} />
                </span>
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  placeholder="name@ncgrltd.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="h-14 w-full rounded-xl border border-line bg-field pl-14 pr-4 text-[1.05rem] text-ink outline-none transition focus:border-gold"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label htmlFor="password" className="block text-[0.75rem] font-bold uppercase tracking-[0.09em] text-muted">
                Password
              </label>
              <div className="relative">
                <span className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-muted">
                  <Icon d={ICONS.lock} size={20} />
                </span>
                <input
                  id="password"
                  type={show ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  className="h-14 w-full rounded-xl border border-line bg-field pl-14 pr-14 text-[1.05rem] text-ink outline-none transition focus:border-gold"
                />
                <button
                  type="button"
                  onClick={() => setShow((v) => !v)}
                  aria-label={show ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-muted transition hover:bg-grey-bg hover:text-ink"
                >
                  {show ? (
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M3 3l14 14M8.2 8.3a2.5 2.5 0 0 0 3.5 3.5M6.1 6.2C4.3 7.3 2.9 9 2.5 10c.8 2 3.8 5 7.5 5 1.4 0 2.7-.4 3.8-1.1M11.5 5.2A7.6 7.6 0 0 0 10 5c-.5 0-1 .05-1.4.14M17.5 10c-.5-1.2-1.6-2.7-3.1-3.8" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <path d="M2.5 10S5.5 5 10 5s7.5 5 7.5 5-3 5-7.5 5-7.5-5-7.5-5Z" />
                      <circle cx="10" cy="10" r="2.5" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex cursor-pointer select-none items-center gap-3 text-[0.95rem] text-ink">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(e) => setRemember(e.target.checked)}
                  className="peer sr-only"
                />
                {/* The tick lives inside this span, so it is not a sibling of the
                    peer — reach it with a descendant variant, not peer-checked. */}
                <span className="flex h-5 w-5 items-center justify-center rounded-md border border-line bg-field text-white transition peer-checked:border-gold peer-checked:bg-gold peer-checked:[&>svg]:opacity-100 peer-focus-visible:ring-2 peer-focus-visible:ring-gold/40">
                  <svg width="12" height="12" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="opacity-0 transition" aria-hidden>
                    <path d="M5 10l3.5 3.5L15 7" />
                  </svg>
                </span>
                Remember me
              </label>

              <button
                type="button"
                onClick={() => setForgot((v) => !v)}
                className="text-[0.95rem] font-semibold text-gold-dark hover:underline"
              >
                Forgot password?
              </button>
            </div>

            {forgot && (
              <p className="rounded-xl border border-line bg-grey-bg px-4 py-3 text-[0.82rem] leading-relaxed text-muted">
                Password resets are approved by an administrator. Contact your
                admin at{" "}
                <a href={`mailto:${COMPANY.email}`} className="font-semibold text-gold-dark hover:underline">
                  {COMPANY.email}
                </a>{" "}
                and they will set a new password for you.
              </p>
            )}

            {error && (
              <p className="rounded-xl border border-red/20 bg-red-bg px-4 py-3 text-sm font-semibold text-red">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="flex h-14 w-full items-center justify-center gap-3 rounded-xl bg-gold-dark text-[1.1rem] font-bold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <Icon d={ICONS.lock} size={20} />
              {submitting ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-5 flex items-start gap-4 rounded-2xl border border-gold/25 bg-gold-bg/70 p-4">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gold text-white">
              <Icon d={ICONS.shield} size={20} />
            </span>
            <div>
              <p className="text-[0.95rem] font-bold text-ink">Security Notice</p>
              <p className="mt-1 text-[0.88rem] leading-relaxed text-muted">
                Never share your password or verification code. Access is
                restricted to authorized {COMPANY.name} personnel.
              </p>
            </div>
          </div>

          <hr className="mt-5 border-line" />
          <p className="mt-4 text-center text-[0.82rem] text-muted">
            © {new Date().getFullYear()} {COMPANY.name}. All rights reserved.
          </p>
          </div>
        </div>
      </div>
    </div>
  );
}

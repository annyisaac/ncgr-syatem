"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import { useAuth } from "@/components/AuthProvider";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { COMPANY } from "@/lib/config";

export default function LoginPage() {
  const { user, loading, login } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already logged in → go to the dashboard.
  useEffect(() => {
    if (!loading && user) router.replace("/dashboard");
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
    if (res.ok) router.replace("/dashboard");
    else setError(res.error ?? "Login failed.");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-[430px]">
        <div className="rounded-[18px] border border-line bg-paper px-8 py-9 text-center shadow-pop">
          <Image
            src={COMPANY.logoPath}
            alt={`${COMPANY.name} logo`}
            width={200}
            height={72}
            className="mx-auto h-auto w-[190px] object-contain"
            priority
            unoptimized
          />
          <p className="mb-6 mt-1 text-[1rem] text-muted">Sales &amp; Delivery Portal</p>

          <form
            onSubmit={onSubmit}
            className="space-y-4 text-left [&_label]:text-[0.82rem] [&_input]:text-[1.05rem] [&_input]:py-3"
          >
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                type="email"
                autoComplete="username"
                placeholder="you@ncgrltd.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </Field>

            <Field label="Password" htmlFor="password" hint="At least 6 characters.">
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </Field>

            {error && (
              <p className="rounded-md bg-red-bg px-3 py-2 text-sm font-semibold text-red">
                {error}
              </p>
            )}

            <Button
              variant="secondary"
              type="submit"
              className="w-full py-3 text-[1.05rem]"
              disabled={submitting}
            >
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 rounded-[10px] border border-[#efdfae] bg-gold-bg px-3 py-2.5 text-[0.72rem] leading-relaxed text-muted">
            {COMPANY.name} · {COMPANY.address}
            <br />
            {COMPANY.tagline}
          </p>
        </div>
      </div>
    </div>
  );
}

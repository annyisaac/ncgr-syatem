"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";

import { getSupabase } from "@/lib/supabase";
import { getDeviceId, deviceLabel } from "@/lib/device";
import { COMPANY } from "@/lib/config";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";

export default function DsrLoginPage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (code.trim().length < 4) return setError("Enter your sign-in code.");
    setBusy(true);
    try {
      const sb = getSupabase();
      const { data, error: fnErr } = await sb.functions.invoke("dsr-login", {
        body: { code: code.trim().toUpperCase(), deviceId: getDeviceId(), deviceLabel: deviceLabel() },
      });
      let payload = data as { access_token?: string; refresh_token?: string; error?: string } | null;
      if (fnErr) {
        try {
          const ctx = (fnErr as { context?: { json?: () => Promise<{ error?: string }> } }).context;
          const j = ctx?.json ? await ctx.json() : undefined;
          payload = j ?? null;
        } catch { /* ignore */ }
      }
      if (payload?.error) { setError(payload.error); setBusy(false); return; }
      if (!payload?.access_token || !payload?.refresh_token) { setError("Sign in failed. Try again."); setBusy(false); return; }
      await sb.auth.setSession({ access_token: payload.access_token, refresh_token: payload.refresh_token });
      window.location.assign("/dsr");
    } catch {
      setError("Sign in failed. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-[430px]">
        <div className="rounded-[18px] border border-line bg-paper px-8 py-9 text-center shadow-pop">
          <Image src={COMPANY.logoPath} alt={`${COMPANY.name} logo`} width={200} height={72} className="brand-logo mx-auto h-auto w-[190px] object-contain" priority unoptimized />
          <p className="mb-6 mt-1 text-[1rem] text-muted">DSR Portal</p>

          <form onSubmit={onSubmit} className="space-y-4 text-left">
            <Field label="Your sign-in code" hint="From your zone manager. Works on this device only.">
              <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="DSR-XXXXXX" autoComplete="off" className="text-center text-[1.1rem] font-mono tracking-wider" />
            </Field>
            {error && <p className="rounded-md bg-red-bg px-3 py-2 text-sm font-semibold text-red">{error}</p>}
            <Button variant="secondary" type="submit" className="w-full py-3 text-[1.05rem]" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <p className="mt-6 text-[0.72rem] text-muted">
            Staff? <Link href="/login" className="font-semibold text-gold-dark underline">Sign in here</Link>.
          </p>
        </div>
      </div>
    </div>
  );
}

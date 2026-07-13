"use client";

import { useMemo, useState, type ReactNode } from "react";
import Image from "next/image";

import { useAuth } from "./AuthProvider";
import { useData } from "./DataProvider";
import { useToast } from "./ui/Toast";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field, Input } from "./ui/Select";
import { COMPANY } from "@/lib/config";
import { getDeviceId, deviceLabel } from "@/lib/device";

/**
 * Second-factor gate for DSRs. A DSR signs in with their own email + password
 * on the normal login page; this gate then guards the portal:
 *   • If this browser is already the DSR's trusted device → straight in.
 *   • Otherwise they must enter their fixed zone-manager code once. On success
 *     this device becomes their trusted device (bound on the DSR record) and no
 *     code is asked again here until they move to another device.
 *
 * Everything the DSR sees lives behind this gate, so the code can never be
 * skipped on an unrecognised device.
 */
export function DsrGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { dsrs, upsertDSR } = useData();
  const { toast } = useToast();

  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);

  const deviceId = getDeviceId();

  const myDsr = useMemo(
    () => dsrs.find((d) => d.authEmail?.toLowerCase() === user?.email.toLowerCase()),
    [dsrs, user]
  );

  const trusted = !!myDsr?.deviceId && myDsr.deviceId === deviceId;

  // No DSR profile is linked to this login — nothing the DSR can do here.
  if (!myDsr) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream px-4">
        <Card className="max-w-md text-center">
          <p className="text-sm text-muted">
            Your DSR profile could not be found. Ask your zone manager.
          </p>
        </Card>
      </div>
    );
  }

  if (trusted || unlocked) return <>{children}</>;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!myDsr) return;
    setErr(null);
    const entered = code.trim().toUpperCase();
    if (!entered) return setErr("Enter your code.");
    if (entered !== (myDsr.loginCode ?? "").toUpperCase()) {
      setCode("");
      return setErr("That code is not correct. Ask your zone manager for your code.");
    }
    setBusy(true);
    try {
      await upsertDSR({ ...myDsr, deviceId, deviceLabel: deviceLabel() });
      setUnlocked(true);
      toast("This device is now trusted — welcome.");
    } catch {
      setErr("Could not verify this device. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-cream px-4">
      <div className="w-full max-w-md">
        <Card className="relative overflow-hidden text-center">
          {/* Company logo as a faint form background */}
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-[0.06]">
            <Image
              src={COMPANY.logoPath}
              alt=""
              width={520}
              height={200}
              className="w-[85%] max-w-none object-contain"
              priority
              unoptimized
            />
          </div>

          <div className="relative z-10">
            <Image
              src={COMPANY.logoPath}
              alt={`${COMPANY.name} logo`}
              width={200}
              height={72}
              className="brand-logo mx-auto mb-4 h-auto w-[170px] object-contain"
              priority
              unoptimized
            />
            <p className="mb-1 text-[1.02rem] font-semibold text-ink">One more step, {myDsr.name.split(" ")[0]}</p>
            <p className="mb-5 text-sm text-muted">
              This device isn&apos;t recognised yet. Enter the code your zone manager gave you to trust it.
            </p>

            <form onSubmit={submit} className="space-y-4 text-left">
              <Field label="Your code">
                <Input
                  value={code}
                  onChange={(e) => { setCode(e.target.value); setErr(null); }}
                  placeholder="DSR-XXXXXX"
                  autoComplete="off"
                  autoFocus
                />
              </Field>
              {err && <p className="text-sm font-semibold text-status-refunded">{err}</p>}
              <Button type="submit" className="w-full py-3 text-[1.02rem]" disabled={busy}>
                {busy ? "Verifying…" : "Trust this device & continue"}
              </Button>
            </form>
          </div>
        </Card>
      </div>
    </div>
  );
}

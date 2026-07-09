"use client";

import { useState } from "react";
import Image from "next/image";

import { useHatchery } from "./HatcheryProvider";
import { useOperator } from "./OperatorProvider";
import { Card } from "./ui/Card";
import { Button } from "./ui/Button";
import { Field, Input, Select } from "./ui/Select";
import { COMPANY } from "@/lib/config";

/**
 * Full-screen identity gate for the shared attendant tablet. The worker picks
 * their name and enters their operator code before they can record anything.
 * Branded with the company logo instead of a text header.
 */
export function OperatorGate() {
  const { operators, loading } = useHatchery();
  const { pickOperator } = useOperator();
  const [id, setId] = useState("");
  const [code, setCode] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const activeOps = operators.filter((o) => o.active);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const res = pickOperator(id, code);
    if (!res.ok) setErr(res.error ?? "Could not continue.");
  }

  return (
    <div className="flex min-h-[74vh] items-center justify-center px-4">
      <div className="w-full max-w-md">
        <Card className="relative overflow-hidden text-center">
          {/* Company logo as the form background (watermark) */}
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
            {/* Logo header (replaces the text heading) */}
            <Image
              src={COMPANY.logoPath}
              alt={`${COMPANY.name} logo`}
              width={200}
              height={72}
              className="brand-logo mx-auto mb-4 h-auto w-[170px] object-contain"
              priority
              unoptimized
            />

            {loading ? (
              <p className="text-sm text-muted">Loading attendants…</p>
            ) : activeOps.length === 0 ? (
              <p className="text-sm text-status-refunded">
                No attendants are registered yet. Ask the Hatchery Manager to register you on the Hatchery Attendants page.
              </p>
            ) : (
              <form onSubmit={submit} className="space-y-4 text-left">
                <Field label="Your name">
                  <Select
                    value={id}
                    onChange={(e) => { setId(e.target.value); setErr(null); }}
                    placeholder="Select your name"
                    options={activeOps.map((o) => ({ value: o.id, label: o.name }))}
                  />
                </Field>
                <Field label="Your code">
                  <Input
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder="OP-XXXX"
                    autoComplete="off"
                  />
                </Field>
                {err && <p className="text-sm font-semibold text-status-refunded">{err}</p>}
                <Button type="submit" className="w-full py-3 text-[1.02rem]">Continue</Button>
              </form>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

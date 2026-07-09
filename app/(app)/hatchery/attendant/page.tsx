"use client";

import Link from "next/link";

import { useAuth } from "@/components/AuthProvider";
import { useOperator } from "@/components/OperatorProvider";

const TILES = [
  { href: "/hatchery/storeroom", label: "Store room", hint: "Log temperature & humidity, send eggs to setting" },
  { href: "/hatchery/machines", label: "Record machines", hint: "Enter setter / hatcher readings" },
  { href: "/hatchery/boxes", label: "Box making", hint: "Log boxes assembled from stock" },
  { href: "/hatchery/counting", label: "Counting chicks", hint: "Count hatched chicks box by box" },
  { href: "/hatchery/biosecurity", label: "Biosecurity", hint: "Cleaning, disinfection & incidents" },
];

export default function AttendantHome() {
  const { user } = useAuth();
  const { operator } = useOperator();
  if (!user) return null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="section-heading text-2xl">
          {operator ? `Hello, ${operator.name}` : "Hatchery attendant"}
        </h1>
        <p className="mt-1 text-muted">Choose what you want to record.</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TILES.map((t) => (
          <Link
            key={t.href}
            href={t.href}
            className="group flex min-h-[130px] flex-col justify-between rounded-2xl border border-line bg-paper p-5 shadow-card transition hover:-translate-y-0.5 hover:border-gold hover:shadow-pop"
          >
            <span className="text-xl font-bold text-ink group-hover:text-gold-dark">{t.label}</span>
            <span className="text-sm text-muted">{t.hint}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

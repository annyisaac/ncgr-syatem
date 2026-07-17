"use client";

import { useMemo, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useHatchery } from "@/components/HatcheryProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Select";
import { Pill } from "@/components/ui/Pill";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { nowISO } from "@/lib/format";
import { PRODUCTS, type Product } from "@/lib/types";
import type { Farm, Flock } from "@/lib/hatchery/types";

const CAN_MANAGE = ["Admin", "Hatchery Manager"];

/** Breeder-farm & flock-ID management, embedded on the Egg Reception page.
 *  Admin / Hatchery Manager add here; Production Technicians only select. */
export function FarmsManager() {
  const { user } = useAuth();
  const { farms, flocks, upsertFarm, upsertFlock, newId } = useHatchery();
  const { toast } = useToast();

  const [showAdd, setShowAdd] = useState(false);
  const [nf, setNf] = useState({ name: "", location: "" });
  const [err, setErr] = useState<string | null>(null);
  const [flockDraft, setFlockDraft] = useState<Record<string, { code: string; product: Product }>>({});

  const canManage = !!user && CAN_MANAGE.includes(user.role);
  const sortedFarms = useMemo(() => farms.slice().sort((a, b) => a.name.localeCompare(b.name)), [farms]);
  const flocksOf = (farmId: string) => flocks.filter((f) => f.farmId === farmId).sort((a, b) => a.code.localeCompare(b.code));

  if (!user) return null;

  function addFarm(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!nf.name.trim()) return setErr("Enter a farm name.");
    if (farms.some((f) => f.name.toLowerCase() === nf.name.trim().toLowerCase()))
      return setErr("A farm with that name already exists.");
    const farm: Farm = { id: newId("farm"), name: nf.name.trim(), location: nf.location.trim() || undefined, active: true, by: user!.email, on: nowISO() };
    upsertFarm(farm);
    toast(`Farm ${farm.name} added.`);
    setShowAdd(false); setNf({ name: "", location: "" });
  }

  function toggleFarm(f: Farm) {
    upsertFarm({ ...f, active: !f.active, on: nowISO() });
  }

  function addFlock(farm: Farm) {
    const draft = flockDraft[farm.id] ?? { code: "", product: PRODUCTS[0] };
    const code = draft.code.trim();
    if (!code) return toast("Enter a flock ID.", "error");
    if (flocks.some((f) => f.code.toLowerCase() === code.toLowerCase()))
      return toast(`Flock ${code} already exists.`, "error");
    const flock: Flock = { id: newId("flock"), code, farmId: farm.id, productType: draft.product, active: true, by: user!.email, on: nowISO() };
    upsertFlock(flock);
    toast(`Flock ${code} added to ${farm.name}.`);
    setFlockDraft({ ...flockDraft, [farm.id]: { code: "", product: draft.product } });
  }

  function toggleFlock(f: Flock) {
    upsertFlock({ ...f, active: !f.active, on: nowISO() });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          Admin and the Hatchery Manager maintain breeder farms and flock IDs here — Production
          Technicians pick from this list above; they don&apos;t type farm or flock names.
        </p>
        {canManage && <Button size="sm" onClick={() => setShowAdd((v) => !v)}>{showAdd ? "Hide" : "Add farm"}</Button>}
      </div>

      {showAdd && canManage && (
        <Card>
          <CardHeader title="Add breeder farm" />
          <form onSubmit={addFarm} className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Farm name"><Input value={nf.name} onChange={(e) => setNf({ ...nf, name: e.target.value })} placeholder="e.g. Cyahafi" /></Field>
            <Field label="Location (optional)"><Input value={nf.location} onChange={(e) => setNf({ ...nf, location: e.target.value })} /></Field>
            <div className="flex items-end"><Button type="submit">Save farm</Button></div>
            {err && <p className="sm:col-span-3 text-sm text-status-refunded">{err}</p>}
          </form>
        </Card>
      )}

      {sortedFarms.length === 0 ? (
        <Card><p className="text-sm text-muted">No farms yet.{canManage ? " Add one to start." : " Ask Admin or the Hatchery Manager to add farms."}</p></Card>
      ) : (
        sortedFarms.map((farm) => {
          const list = flocksOf(farm.id);
          const draft = flockDraft[farm.id] ?? { code: "", product: PRODUCTS[0] };
          return (
            <Card key={farm.id}>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-[0.95rem] font-bold text-ink">{farm.name}</h3>
                  {farm.location && <span className="text-xs text-muted">· {farm.location}</span>}
                  {!farm.active && <Pill tone="neutral">inactive</Pill>}
                </div>
                {canManage && (
                  <Button size="sm" variant="ghost" onClick={() => toggleFarm(farm)}>{farm.active ? "Deactivate" : "Reactivate"}</Button>
                )}
              </div>
              <TableWrap>
                <thead><tr><Th>Flock ID</Th><Th>Product</Th><Th>Status</Th>{canManage && <Th>Action</Th>}</tr></thead>
                <tbody>
                  {list.length === 0 ? (
                    <EmptyRow colSpan={canManage ? 4 : 3} text="No flocks for this farm yet." />
                  ) : list.map((f) => (
                    <tr key={f.id}>
                      <Td className="font-medium">{f.code}</Td>
                      <Td>{f.productType}</Td>
                      <Td>{f.active ? <Pill tone="green">active</Pill> : <Pill tone="neutral">inactive</Pill>}</Td>
                      {canManage && <Td><Button size="sm" variant="ghost" onClick={() => toggleFlock(f)}>{f.active ? "Deactivate" : "Reactivate"}</Button></Td>}
                    </tr>
                  ))}
                </tbody>
              </TableWrap>
              {canManage && (
                <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr_auto] sm:items-end">
                  <Field label="New flock ID">
                    <Input value={draft.code} onChange={(e) => setFlockDraft({ ...flockDraft, [farm.id]: { ...draft, code: e.target.value } })} placeholder="e.g. NCGR-F25-R03-03" />
                  </Field>
                  <Field label="Product">
                    <Select value={draft.product} onChange={(e) => setFlockDraft({ ...flockDraft, [farm.id]: { ...draft, product: e.target.value as Product } })}
                      options={PRODUCTS.map((p) => ({ value: p, label: p }))} />
                  </Field>
                  <Button size="sm" onClick={() => addFlock(farm)}>Add flock</Button>
                </div>
              )}
            </Card>
          );
        })
      )}
    </div>
  );
}

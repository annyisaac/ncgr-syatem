"use client";

import { useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { nowISO, todayISO } from "@/lib/format";
import {
  PS_BREEDS, PS_STAGES, newFlockId, newPlacementId, stamp, upsertFlock, type BreederFlock, type FlockStage, type Sex,
} from "@/lib/parentStock";

/** Place a new breeder delivery — female and male birds entered separately and
 *  saved as two linked flocks (one per sex) from the same placement. */
export function PlaceFlock({ flocks, onPlaced }: { flocks: BreederFlock[]; onPlaced?: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [placementDate, setPlacementDate] = useState(todayISO());
  const [breed, setBreed] = useState<string>(PS_BREEDS[0]);
  const [stage, setStage] = useState<FlockStage>("Rearing");
  const [supplier, setSupplier] = useState("");
  const [hatchDate, setHatchDate] = useState("");
  const [notes, setNotes] = useState("");
  const [femaleCode, setFemaleCode] = useState("");
  const [femaleHouse, setFemaleHouse] = useState("");
  const [femalePop, setFemalePop] = useState("");
  const [maleCode, setMaleCode] = useState("");
  const [maleHouse, setMaleHouse] = useState("");
  const [malePop, setMalePop] = useState("");

  if (!user) return null;

  const year = todayISO().slice(0, 4);
  const suggestCode = (sex: Sex) => {
    const p = sex === "Male" ? `PS-M-${year}-` : `PS-F-${year}-`;
    const n = flocks.filter((f) => f.code.startsWith(p)).length + 1;
    return `${p}${String(n).padStart(2, "0")}`;
  };

  function openNew() {
    setPlacementDate(todayISO());
    setBreed(PS_BREEDS[0]);
    setStage("Rearing");
    setSupplier(""); setHatchDate(""); setNotes("");
    setFemaleCode(suggestCode("Female")); setFemaleHouse(""); setFemalePop("");
    setMaleCode(suggestCode("Male")); setMaleHouse(""); setMalePop("");
    setOpen(true);
  }

  const fPop = Number(femalePop) || 0;
  const mPop = Number(malePop) || 0;

  async function save() {
    if (fPop <= 0 && mPop <= 0) return toast("Enter a female and/or male population to place.", "info");
    if (fPop > 0 && !femaleCode.trim()) return toast("Enter a female flock ID.", "info");
    if (mPop > 0 && !maleCode.trim()) return toast("Enter a male flock ID.", "info");

    const bothSexes = fPop > 0 && mPop > 0;
    const placementId = bothSexes ? newPlacementId() : undefined;
    const shared = {
      placementId,
      breed,
      supplier: supplier.trim() || undefined,
      hatchDate: hatchDate || undefined,
      placementDate: placementDate || undefined,
      stage,
      active: true,
      notes: notes.trim() || undefined,
      by: user!.email,
    };
    const make = (sex: Sex, code: string, house: string, pop: number): BreederFlock => ({
      id: newFlockId(),
      code: code.trim(),
      sex,
      ...shared,
      house: house.trim() || undefined,
      initialPopulation: pop,
      currentPopulation: pop,
      on: nowISO(),
      history: [stamp(user!.email, "placed")],
    });

    const toSave: BreederFlock[] = [];
    if (fPop > 0) toSave.push(make("Female", femaleCode, femaleHouse, fPop));
    if (mPop > 0) toSave.push(make("Male", maleCode, maleHouse, mPop));

    setSaving(true);
    try {
      for (const f of toSave) await upsertFlock(f);
      toast(toSave.length === 2 ? "Placed female and male flocks." : "Flock placed.");
      setOpen(false);
      onPlaced?.();
    } catch {
      toast("Could not place the flock.", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button onClick={openNew}>＋ Place flock</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Place a new breeder flock" className="max-w-2xl"
        footer={<><Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button><Button onClick={save} disabled={saving}>{saving ? "Placing…" : "Place flock"}</Button></>}>
        <div className="space-y-5">
          {/* Shared delivery details */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Breed"><Select value={breed} onChange={(e) => setBreed(e.target.value)} options={PS_BREEDS.map((b) => ({ value: b, label: b }))} /></Field>
            <Field label="Supplier"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} placeholder="e.g. Hatchery / importer" /></Field>
            <Field label="Hatch date"><Input type="date" value={hatchDate} onChange={(e) => setHatchDate(e.target.value)} /></Field>
            <Field label="Placement date"><Input type="date" value={placementDate} onChange={(e) => setPlacementDate(e.target.value)} /></Field>
            <Field label="Stage"><Select value={stage} onChange={(e) => setStage(e.target.value as FlockStage)} options={PS_STAGES.map((s) => ({ value: s, label: s }))} /></Field>
          </div>

          {/* Female birds */}
          <div className="rounded-xl border border-line bg-paper p-3">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#c2185b" }} /> Female birds</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Female flock ID"><Input value={femaleCode} onChange={(e) => setFemaleCode(e.target.value)} placeholder={`PS-F-${year}-01`} /></Field>
              <Field label="House"><Input value={femaleHouse} onChange={(e) => setFemaleHouse(e.target.value)} placeholder="e.g. House 1" /></Field>
              <Field label="Females placed"><Input type="number" min={0} value={femalePop} onChange={(e) => setFemalePop(e.target.value)} /></Field>
            </div>
          </div>

          {/* Male birds */}
          <div className="rounded-xl border border-line bg-paper p-3">
            <p className="mb-3 flex items-center gap-2 text-sm font-bold text-ink"><span className="h-2.5 w-2.5 rounded-full" style={{ background: "#1565c0" }} /> Male birds</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Male flock ID"><Input value={maleCode} onChange={(e) => setMaleCode(e.target.value)} placeholder={`PS-M-${year}-01`} /></Field>
              <Field label="House"><Input value={maleHouse} onChange={(e) => setMaleHouse(e.target.value)} placeholder="e.g. House 2" /></Field>
              <Field label="Males placed"><Input type="number" min={0} value={malePop} onChange={(e) => setMalePop(e.target.value)} /></Field>
            </div>
          </div>

          {fPop > 0 && mPop > 0 && (
            <p className="text-xs text-muted">
              Placing <strong>{fPop.toLocaleString()}</strong> females and <strong>{mPop.toLocaleString()}</strong> males
              {` — ratio 1 male : ${(fPop / mPop).toFixed(1)} females`}. They are saved as two linked flocks.
            </p>
          )}

          <Field label="Notes"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        </div>
      </Modal>
    </>
  );
}

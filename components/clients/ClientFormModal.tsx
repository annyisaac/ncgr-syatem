"use client";

import { useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { productForRole } from "@/lib/permissions";
import { clientRecordKey } from "@/lib/clients";
import { nowISO } from "@/lib/format";
import type { Client, Product } from "@/lib/types";

/**
 * Add / edit a client record. Self-contained (owns its draft, validates, and
 * persists via useData().upsertClient), so both the Clients list and the client
 * detail page can open it. Mount it with a `key` (e.g. the client id) so each
 * open starts from a fresh `initial`.
 */
export function ClientFormModal({ initial, onClose }: { initial: Client; onClose: () => void }) {
  const { user } = useAuth();
  const { upsertClient } = useData();
  const { toast } = useToast();
  const [draft, setDraft] = useState<Client>(initial);

  const crossProduct = user ? !productForRole(user.role) : false; // Admin/Accountant → both
  const existing = !!initial.id;
  const set = (patch: Partial<Client>) => setDraft((d) => ({ ...d, ...patch }));

  async function save() {
    const name = draft.name.trim();
    if (!name) { toast("Enter the client's name.", "info"); return; }
    const id = draft.id || clientRecordKey({ phone: draft.phone, name });
    const clean: Client = { ...draft, id, name, phone: (draft.phone ?? "").trim(), on: draft.on || nowISO(), by: user?.email };
    try {
      await upsertClient(clean);
      toast("Client saved.");
      onClose();
    } catch {
      toast("Could not save the client.", "error");
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={existing ? "Edit client" : "Add new client"}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={save}>Save client</Button></>}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Full name" required><Input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="Client name" /></Field>
        <Field label="Phone"><Input value={draft.phone ?? ""} onChange={(e) => set({ phone: e.target.value })} placeholder="07…" /></Field>
        <Field label="District"><Input value={draft.district ?? ""} onChange={(e) => set({ district: e.target.value })} /></Field>
        <Field label="Sector"><Input value={draft.sector ?? ""} onChange={(e) => set({ sector: e.target.value })} /></Field>
        <Field label="Product scope" hint={crossProduct ? "Which product's team can see this client." : "Set by your role."}>
          <Select
            value={draft.product ?? ""}
            disabled={!crossProduct}
            onChange={(e) => set({ product: (e.target.value || undefined) as Product | undefined })}
            options={[{ value: "", label: "Both / any" }, { value: "Ross 308", label: "Ross 308" }, { value: "Tetra Super Harco", label: "Tetra Super Harco" }]}
          />
        </Field>
        <Field label="Status">
          <Select
            value={(draft.active ?? true) ? "active" : "inactive"}
            onChange={(e) => set({ active: e.target.value === "active" })}
            options={[{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }]}
          />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Note"><Input value={draft.note ?? ""} onChange={(e) => set({ note: e.target.value })} placeholder="Optional — anything worth remembering about this client" /></Field>
        </div>
      </div>
    </Modal>
  );
}

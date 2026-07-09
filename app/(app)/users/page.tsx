"use client";

import { useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Pill } from "@/components/ui/Pill";
import { Modal } from "@/components/ui/Modal";
import { Field, Input, Select } from "@/components/ui/Select";
import { TableWrap, Th, Td, EmptyRow } from "@/components/ui/Table";
import { GmailLink } from "@/components/ui/GmailLink";

import type { Role, User, Zone } from "@/lib/types";
import { ROLES } from "@/lib/types";
import { ZONES } from "@/lib/config";
import { nowISO, formatDate, formatDateTime } from "@/lib/format";
import { adminCreateUser, adminSetPassword } from "@/lib/adminApi";

export default function UsersPage() {
  const { user, refresh } = useAuth();
  const { users, upsertUser, reload } = useData();
  const { toast } = useToast();

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("Ross Order Receiver");
  const [zone, setZone] = useState<Zone>("Zone 1");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [resetting, setResetting] = useState<User | null>(null);
  const [editing, setEditing] = useState<User | null>(null);
  const [devicesFor, setDevicesFor] = useState<User | null>(null);

  const pwRequests = users.filter((u) => u.pwRequest);

  if (user?.role !== "Admin") {
    return (
      <Card>
        <p className="text-sm text-ink/70">Only the Admin can manage users.</p>
      </Card>
    );
  }

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (name.trim().length < 2) return setErr("Enter the user's name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setErr("Enter a valid email.");
    if (users.some((u) => u.email.toLowerCase() === email.toLowerCase()))
      return setErr("A user with that email already exists.");
    if (password.length < 6) return setErr("Password must be at least 6 characters.");

    const profile: User = {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      role,
      zone: role === "Tetra Zone Manager" ? zone : undefined,
      password: "",
      active: true,
      created: nowISO(),
    };
    setBusy(true);
    try {
      await adminCreateUser(profile.email, password, profile);
      await reload();
      toast(`Created ${profile.name}.`);
      setName("");
      setEmail("");
      setPassword("");
      setRole("Ross Order Receiver");
      setShowForm(false);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Could not create the account.");
    } finally {
      setBusy(false);
    }
  }

  function toggleActive(u: User) {
    if (u.email === user!.email) {
      toast("You cannot deactivate your own account.", "error");
      return;
    }
    upsertUser({ ...u, active: !u.active });
    toast(`${u.name} ${u.active ? "deactivated" : "activated"}.`);
  }

  async function approvePw(u: User) {
    try {
      await adminSetPassword(u.email, u.pwRequest!.newPassword);
      await upsertUser({ ...u, pwRequest: undefined });
      if (u.email === user!.email) await refresh();
      toast(`Password change approved for ${u.name}.`);
    } catch (e) {
      toast(e instanceof Error ? e.message : "Could not approve.", "error");
    }
  }

  async function rejectPw(u: User) {
    await upsertUser({ ...u, pwRequest: undefined });
    toast(`Password change rejected for ${u.name}.`);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="section-heading text-lg">Users</h1>
        <Button onClick={() => setShowForm((v) => !v)}>
          {showForm ? "Hide form" : "Create user"}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardHeader title="Create user" />
          <form onSubmit={create} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Name">
              <Input value={name} onChange={(e) => setName(e.target.value)} />
            </Field>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </Field>
            <Field label="Role">
              <Select
                value={role}
                onChange={(e) => setRole(e.target.value as Role)}
                options={ROLES.map((r) => ({ value: r, label: r }))}
              />
            </Field>
            {role === "Tetra Zone Manager" && (
              <Field label="Zone">
                <Select
                  value={zone}
                  onChange={(e) => setZone(e.target.value as Zone)}
                  options={ZONES.map((z) => ({ value: z, label: z }))}
                />
              </Field>
            )}
            <Field label="Temporary password" hint="At least 6 characters.">
              <Input type="text" value={password} onChange={(e) => setPassword(e.target.value)} />
            </Field>
            {err && (
              <p className="sm:col-span-2 text-sm text-status-refunded">{err}</p>
            )}
            <div className="sm:col-span-2 flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button type="submit" disabled={busy}>{busy ? "Creating…" : "Save user"}</Button>
            </div>
          </form>
        </Card>
      )}

      {/* Password change requests */}
      <Card>
        <CardHeader title={`Password change requests (${pwRequests.length})`} />
        {pwRequests.length === 0 ? (
          <p className="text-sm text-muted">No pending password change requests.</p>
        ) : (
          <TableWrap>
            <thead>
              <tr>
                <Th>User</Th>
                <Th>Email</Th>
                <Th>Requested</Th>
                <Th>New password</Th>
                <Th>Action</Th>
              </tr>
            </thead>
            <tbody>
              {pwRequests.map((u) => (
                <tr key={u.email}>
                  <Td>{u.name}</Td>
                  <Td><GmailLink email={u.email} /></Td>
                  <Td>{formatDateTime(u.pwRequest!.on)}</Td>
                  <Td><span className="font-mono">{u.pwRequest!.newPassword}</span></Td>
                  <Td>
                    <div className="flex gap-1">
                      <Button size="sm" onClick={() => approvePw(u)}>Approve</Button>
                      <Button size="sm" variant="danger" onClick={() => rejectPw(u)}>Reject</Button>
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        )}
      </Card>

      <Card>
        <CardHeader title={`${users.length} user(s)`} />
        <p className="mb-3 text-xs text-ink/60">
          Accounts are never deleted — only activated or deactivated.
        </p>
        <TableWrap>
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th>Zone</Th>
              <Th>Devices</Th>
              <Th>Created</Th>
              <Th>Status</Th>
              <Th>Actions</Th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 ? (
              <EmptyRow colSpan={8} text="No users." />
            ) : (
              users.map((u) => {
                const signedIn = (u.devices ?? []).filter((d) => d.signedIn).length;
                return (
                  <tr key={u.email}>
                    <Td>{u.name}</Td>
                    <Td><GmailLink email={u.email} /></Td>
                    <Td>{u.role}</Td>
                    <Td>{u.zone ?? "—"}</Td>
                    <Td>
                      <Button size="sm" variant="ghost" onClick={() => setDevicesFor(u)}>
                        Devices ({signedIn} in)
                      </Button>
                    </Td>
                    <Td>{formatDate(u.created)}</Td>
                    <Td>
                      {u.active ? (
                        <Pill tone="fulfilled">Active</Pill>
                      ) : (
                        <Pill tone="neutral">Inactive</Pill>
                      )}
                    </Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        <Button size="sm" variant="ghost" onClick={() => setEditing(u)}>
                          Reassign / edit
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setResetting(u)}>
                          Reset password
                        </Button>
                        <Button
                          size="sm"
                          variant={u.active ? "ghost" : "primary"}
                          onClick={() => toggleActive(u)}
                        >
                          {u.active ? "Deactivate" : "Activate"}
                        </Button>
                      </div>
                    </Td>
                  </tr>
                );
              })
            )}
          </tbody>
        </TableWrap>
      </Card>

      {resetting && (
        <ResetModal
          user={resetting}
          onClose={() => setResetting(null)}
          onSave={async (pwd) => {
            const target = resetting;
            try {
              await adminSetPassword(target.email, pwd);
              if (target.pwRequest) await upsertUser({ ...target, pwRequest: undefined });
              toast(`Password reset for ${target.name}.`);
              setResetting(null);
            } catch (e) {
              toast(e instanceof Error ? e.message : "Could not reset password.", "error");
            }
          }}
        />
      )}

      {editing && (
        <EditUserModal
          user={editing}
          onClose={() => setEditing(null)}
          onSave={async ({ name: n, role: r, zone: z, newPassword }) => {
            const target = editing;
            try {
              await upsertUser({
                ...target,
                name: n,
                role: r,
                zone: r === "Tetra Zone Manager" ? z : undefined,
              });
              if (newPassword) await adminSetPassword(target.email, newPassword);
              if (target.email === user!.email) await refresh();
              toast(`Account ${target.email} reassigned to ${n}.`);
              setEditing(null);
            } catch (e) {
              toast(e instanceof Error ? e.message : "Could not update the account.", "error");
            }
          }}
        />
      )}

      {devicesFor && (
        <Modal
          open
          onClose={() => setDevicesFor(null)}
          title={`Devices — ${devicesFor.name}`}
        >
          {(devicesFor.devices ?? []).length === 0 ? (
            <p className="text-sm text-muted">
              This account has not signed in on any device yet.
            </p>
          ) : (
            <div className="space-y-2">
              {(devicesFor.devices ?? [])
                .slice()
                .sort((a, b) => (a.lastSeen < b.lastSeen ? 1 : -1))
                .map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line p-3"
                  >
                    <div className="text-sm">
                      <p className="font-semibold text-ink">{d.label}</p>
                      <p className="text-xs text-muted">
                        First seen {formatDateTime(d.firstSeen)} · Last active{" "}
                        {formatDateTime(d.lastSeen)}
                      </p>
                    </div>
                    {d.signedIn ? (
                      <Pill tone="fulfilled">Signed in</Pill>
                    ) : (
                      <Pill tone="neutral">Signed out</Pill>
                    )}
                  </div>
                ))}
            </div>
          )}
        </Modal>
      )}
    </div>
  );
}

function EditUserModal({
  user,
  onClose,
  onSave,
}: {
  user: User;
  onClose: () => void;
  onSave: (v: { name: string; role: Role; zone: Zone; newPassword: string }) => void;
}) {
  const [name, setName] = useState(user.name);
  const [role, setRole] = useState<Role>(user.role);
  const [zone, setZone] = useState<Zone>(user.zone ?? "Zone 1");
  const [newPassword, setNewPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);

  return (
    <Modal
      open
      onClose={onClose}
      title="Reassign / edit account"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              if (name.trim().length < 2) return setErr("Enter the person's name.");
              if (newPassword && newPassword.length < 6)
                return setErr("New password must be at least 6 characters.");
              onSave({ name: name.trim(), role, zone, newPassword });
            }}
          >
            Save changes
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="rounded-md bg-gold-bg px-3 py-2 text-xs text-muted">
          Hand this account to a new worker. The login email{" "}
          <strong className="text-ink">{user.email}</strong> stays the same, so all
          its data is kept. Set a new password so the previous worker can no longer
          sign in.
        </p>
        <Field label="Worker name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Role">
          <Select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            options={ROLES.map((r) => ({ value: r, label: r }))}
          />
        </Field>
        {role === "Tetra Zone Manager" && (
          <Field label="Zone">
            <Select
              value={zone}
              onChange={(e) => setZone(e.target.value as Zone)}
              options={ZONES.map((z) => ({ value: z, label: z }))}
            />
          </Field>
        )}
        <Field label="New password" hint="Leave blank to keep the current password.">
          <Input type="text" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </Field>
        {err && <p className="text-sm text-status-refunded">{err}</p>}
      </div>
    </Modal>
  );
}

function ResetModal({
  user,
  onClose,
  onSave,
}: {
  user: User;
  onClose: () => void;
  onSave: (pwd: string) => void;
}) {
  const [pwd, setPwd] = useState("");
  const [err, setErr] = useState<string | null>(null);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Reset password — ${user.name}`}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={() => (pwd.length >= 6 ? onSave(pwd) : setErr("At least 6 characters."))}>
            Save password
          </Button>
        </>
      }
    >
      <Field label="New password">
        <Input type="text" value={pwd} onChange={(e) => setPwd(e.target.value)} />
      </Field>
      {err && <p className="mt-2 text-sm text-status-refunded">{err}</p>}
    </Modal>
  );
}

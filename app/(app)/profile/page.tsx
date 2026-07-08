"use client";

import { useRef, useState } from "react";

import { useAuth } from "@/components/AuthProvider";
import { useData } from "@/components/DataProvider";
import { useTheme } from "@/components/ThemeProvider";
import { useToast } from "@/components/ui/Toast";
import { Card, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Select";
import { Avatar } from "@/components/ui/Avatar";
import { GmailLink } from "@/components/ui/GmailLink";
import { cn } from "@/lib/cn";
import { formatDate, formatDateTime, nowISO } from "@/lib/format";
import { getSupabase } from "@/lib/supabase";

export default function ProfilePage() {
  const { user, refresh } = useAuth();
  const { upsertUser } = useData();
  const { theme, setTheme } = useTheme();
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [pwErr, setPwErr] = useState<string | null>(null);

  if (!user) return null;

  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast("Please choose an image file.", "error");
      return;
    }
    if (file.size > 2_000_000) {
      toast("Please choose an image under 2 MB.", "error");
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = async () => {
      await upsertUser({ ...user!, avatar: reader.result as string });
      await refresh();
      toast("Profile picture updated.");
      if (fileRef.current) fileRef.current.value = "";
    };
    reader.readAsDataURL(file);
  }

  async function removePicture() {
    await upsertUser({ ...user!, avatar: undefined });
    await refresh();
    toast("Profile picture removed.");
  }

  async function changePassword(e: React.FormEvent) {
    e.preventDefault();
    setPwErr(null);
    if (newPw.length < 6) return setPwErr("New password must be at least 6 characters.");
    if (newPw === curPw) return setPwErr("New password must be different.");

    const sb = getSupabase();
    // Verify the current password by re-authenticating.
    const { error: verifyErr } = await sb.auth.signInWithPassword({
      email: user!.email,
      password: curPw,
    });
    if (verifyErr) return setPwErr("Your current password is incorrect.");

    if (user!.role === "Admin") {
      // Admins approve requests themselves, so they change directly in Auth.
      const { error } = await sb.auth.updateUser({ password: newPw });
      if (error) return setPwErr(error.message);
      toast("Password changed.");
    } else {
      // Everyone else needs Admin approval (the new password is held pending).
      await upsertUser({ ...user!, pwRequest: { newPassword: newPw, on: nowISO() } });
      toast("Password change sent to the Admin for approval.");
    }
    await refresh();
    setCurPw("");
    setNewPw("");
  }

  async function cancelPwRequest() {
    await upsertUser({ ...user!, pwRequest: undefined });
    await refresh();
    toast("Password change request cancelled.");
  }

  return (
    <div className="space-y-6">
      <h1 className="section-heading text-lg">My Account</h1>

      {/* Profile picture */}
      <Card>
        <CardHeader title="Profile picture" />
        <div className="flex flex-wrap items-center gap-5">
          <Avatar user={user} size={84} />
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => fileRef.current?.click()}>Upload picture</Button>
              {user.avatar && (
                <Button variant="ghost" onClick={removePicture}>
                  Remove
                </Button>
              )}
            </div>
            <p className="text-xs text-muted">PNG or JPG, up to 2 MB.</p>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={onPickFile}
            />
          </div>
        </div>
      </Card>

      {/* Account details (read-only) */}
      <Card>
        <CardHeader title="Account details" />
        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <Detail label="Name" value={user.name} />
          <Detail label="Role" value={`${user.role}${user.zone ? ` · ${user.zone}` : ""}`} />
          <div>
            <p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">Email</p>
            <p className="font-medium"><GmailLink email={user.email} /></p>
          </div>
          <Detail label="Member since" value={formatDate(user.created)} />
        </div>
        <p className="mt-3 text-xs text-muted">
          Only an Admin can change your name, role, or email. You can update your
          picture, theme, and password here.
        </p>
      </Card>

      {/* Appearance */}
      <Card>
        <CardHeader title="Appearance" />
        <p className="mb-3 text-sm text-muted">Choose how the app looks on this device.</p>
        <div className="grid grid-cols-2 gap-3 sm:max-w-md">
          <ThemeOption
            label="Light mode"
            active={theme === "light"}
            onClick={() => setTheme("light")}
            swatch="bg-[#f6f5f1]"
            dot="bg-[#1c1a16]"
          />
          <ThemeOption
            label="Dark mode"
            active={theme === "dark"}
            onClick={() => setTheme("dark")}
            swatch="bg-[#201d18]"
            dot="bg-[#f2eee4]"
          />
        </div>
      </Card>

      {/* Change password */}
      <Card>
        <CardHeader title="Change password" />
        {user.pwRequest ? (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#efdfae] bg-gold-bg p-4">
            <div className="text-sm">
              <p className="font-semibold text-ink">Waiting for Admin approval</p>
              <p className="text-xs text-muted">
                You requested a password change on {formatDateTime(user.pwRequest.on)}.
                Your current password still works until the Admin approves it.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={cancelPwRequest}>
              Cancel request
            </Button>
          </div>
        ) : (
          <>
            {user.role !== "Admin" && (
              <p className="mb-3 text-xs text-muted">
                Password changes need Admin approval. Your new password starts
                working after the Admin approves it.
              </p>
            )}
            <form onSubmit={changePassword} className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:max-w-xl">
              <Field label="Current password">
                <Input type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} />
              </Field>
              <Field label="New password" hint="At least 6 characters.">
                <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} />
              </Field>
              {pwErr && <p className="sm:col-span-2 text-sm text-status-refunded">{pwErr}</p>}
              <div className="sm:col-span-2">
                <Button type="submit">
                  {user.role === "Admin" ? "Update password" : "Request password change"}
                </Button>
              </div>
            </form>
          </>
        )}
      </Card>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[0.66rem] font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="font-medium text-ink">{value}</p>
    </div>
  );
}

function ThemeOption({
  label,
  active,
  onClick,
  swatch,
  dot,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  swatch: string;
  dot: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex items-center gap-3 rounded-xl border p-3 text-left transition",
        active ? "border-gold ring-2 ring-gold" : "border-line hover:border-ink/40"
      )}
    >
      <span className={cn("flex h-9 w-9 items-center justify-center rounded-full", swatch)}>
        <span className={cn("h-4 w-4 rounded-full", dot)} />
      </span>
      <span className="text-sm font-semibold text-ink">{label}</span>
      {active && <span className="ml-auto text-[0.68rem] font-bold text-gold-dark">Active</span>}
    </button>
  );
}

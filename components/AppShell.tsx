"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "./AuthProvider";
import { useData } from "./DataProvider";
import { useTheme } from "./ThemeProvider";
import { useToast } from "./ui/Toast";
import { Avatar } from "./ui/Avatar";
import { canAccess, navForRole } from "@/lib/permissions";
import { COMPANY } from "@/lib/config";
import { cn } from "@/lib/cn";

/**
 * Authenticated app shell with a left sidebar (collapses to a drawer on
 * mobile), an avatar user card that links to the profile page, and the auth
 * guard.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { reload } = useData();
  const { theme, toggle } = useTheme();
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Close the menu when the route changes (adjust-state-during-render pattern).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setDrawer(false);
  }

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }
  async function handleRefresh() {
    await reload();
    toast("Data refreshed.", "info");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted">
        Loading…
      </div>
    );
  }
  if (!user) return null;

  const nav = navForRole(user.role);
  const allowed = canAccess(user.role, pathname);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <Link href="/dashboard" className="flex items-center">
          <Image
            src={COMPANY.logoPath}
            alt={`${COMPANY.name} logo`}
            width={150}
            height={48}
            className="brand-logo h-12 w-auto object-contain"
            priority
            unoptimized
          />
        </Link>
        <button
          type="button"
          onClick={() => setDrawer(false)}
          className="rounded-md border border-line px-2.5 py-1 text-[0.72rem] font-semibold text-muted transition hover:border-ink hover:text-ink"
        >
          Close
        </button>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
        {nav.map((item) => (
          <NavLink key={item.href} {...item} pathname={pathname} />
        ))}
      </nav>

      <div className="space-y-2 border-t border-line p-3">
        <Link
          href="/profile"
          className={cn(
            "flex items-center gap-2.5 rounded-lg p-2 transition-colors hover:bg-grey-bg",
            pathname === "/profile" && "bg-grey-bg"
          )}
        >
          <Avatar user={user} size={36} />
          <div className="min-w-0 leading-tight">
            <p className="truncate text-[0.82rem] font-semibold text-ink">{user.name}</p>
            <p className="truncate text-[0.68rem] text-gold-dark">
              {user.role}
              {user.zone ? ` · ${user.zone}` : ""}
            </p>
          </div>
        </Link>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={toggle}
            className="flex-1 rounded-md border border-line px-2 py-1.5 text-[0.72rem] font-semibold text-muted transition hover:border-ink hover:text-ink"
          >
            {theme === "dark" ? "Light mode" : "Dark mode"}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            className="flex-1 rounded-md border border-line px-2 py-1.5 text-[0.72rem] font-semibold text-muted transition hover:border-ink hover:text-ink"
          >
            Refresh
          </button>
        </div>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full rounded-md border border-line px-2 py-1.5 text-[0.72rem] font-semibold text-muted transition hover:border-ink hover:text-ink"
        >
          Log out
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen">
      {/* Top bar (all screen sizes) — the menu stays hidden until opened */}
      <div className="sticky top-0 z-30 flex h-20 items-center justify-between border-b border-line bg-paper px-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setDrawer((v) => !v)}
            className="rounded-md border border-line px-3.5 py-2 text-[0.9rem] font-semibold text-ink transition hover:border-ink"
            aria-expanded={drawer}
          >
            Menu
          </button>
          <Link href="/dashboard" className="flex items-center">
            <Image
              src={COMPANY.logoPath}
              alt={`${COMPANY.name} logo`}
              width={160}
              height={56}
              className="brand-logo h-14 w-auto object-contain"
              unoptimized
            />
          </Link>
        </div>
        <Link href="/profile" className="flex items-center gap-2">
          <span className="hidden text-[0.9rem] font-semibold text-ink sm:inline">
            {user.name}
          </span>
          <Avatar user={user} size={40} />
        </Link>
      </div>

      {/* Slide-in menu (opens on demand, closes on navigation or backdrop) */}
      {drawer && (
        <div className="fixed inset-0 z-40">
          <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-paper shadow-pop">
            {sidebar}
          </aside>
        </div>
      )}

      {/* Main */}
      <div className="flex min-h-screen flex-col">
        <main className="mx-auto w-full max-w-[1200px] grow px-4 py-6 md:px-6">
          {allowed ? (
            children
          ) : (
            <div className="rounded-2xl border border-line bg-paper p-8 text-center text-muted shadow-card">
              <p className="mb-2 font-bold text-ink">Not authorized</p>
              <p className="text-sm">Your role ({user.role}) cannot open this page.</p>
            </div>
          )}
        </main>
        <footer className="border-t border-line bg-paper">
          <div className="mx-auto flex max-w-[1200px] flex-col items-center justify-between gap-1 px-4 py-4 text-[0.72rem] text-muted sm:flex-row md:px-6">
            <span>{COMPANY.name} — {COMPANY.address}</span>
            <span className="text-gold-dark">{COMPANY.tagline}</span>
          </div>
        </footer>
      </div>
    </div>
  );
}

function isActive(href: string, pathname: string): boolean {
  if (href === "/dashboard" || href === "/orders/new") return pathname === href;
  if (href === "/orders") return pathname === "/orders";
  return pathname === href || pathname.startsWith(href + "/");
}

function NavLink({
  href,
  label,
  pathname,
}: {
  href: string;
  label: string;
  pathname: string;
}) {
  const active = isActive(href, pathname);
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-lg px-3.5 py-2.5 text-[1.05rem] font-semibold transition-colors",
        active
          ? "bg-gold text-[#231b04]"
          : "text-muted hover:bg-grey-bg hover:text-ink"
      )}
    >
      {label}
    </Link>
  );
}

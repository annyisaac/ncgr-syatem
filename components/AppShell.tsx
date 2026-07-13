"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "./AuthProvider";
import { useOperator } from "./OperatorProvider";
import { OperatorGate } from "./OperatorGate";
import { DsrGate } from "./DsrGate";
import { NotificationBell } from "./NotificationBell";
import { Avatar } from "./ui/Avatar";
import { canAccess, navForRole, homeForRole } from "@/lib/permissions";
import { COMPANY } from "@/lib/config";
import { cn } from "@/lib/cn";

/**
 * Authenticated app shell: a persistent left sidebar on desktop that collapses
 * to a slide-in drawer on mobile, a slim top bar, and the auth / role gates.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { operator, clearOperator } = useOperator();
  const router = useRouter();
  const pathname = usePathname();
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Close the drawer when the route changes (adjust-state-during-render pattern).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setDrawer(false);
  }

  async function handleLogout() {
    await logout();
    router.replace("/login");
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
  const activeNav = activeHref(nav, pathname);
  const allowed = canAccess(user.role, pathname);
  // Shared attendant tablet: no side menu, and must identify the operator first.
  const isAttendant = user.role === "Hatchery Attendant";
  const needsOperator = isAttendant && !operator;
  const isDsr = user.role === "DSR";
  const homeHref = homeForRole(user.role);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 shrink-0 items-center justify-between px-4">
        <Link href={homeHref} className="flex items-center">
          <Image
            src={COMPANY.logoPath}
            alt={`${COMPANY.name} logo`}
            width={150}
            height={48}
            className="brand-logo h-11 w-auto object-contain"
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

      <nav className="flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {groupNav(nav).map((group) => (
          <div key={group.name} className="space-y-0.5">
            <p className="px-3 pb-1 text-[0.6rem] font-semibold uppercase tracking-[0.12em] text-muted/70">
              {group.name}
            </p>
            {group.items.map((item) => (
              <NavLink key={item.href} href={item.href} label={item.label} active={item.href === activeNav} />
            ))}
          </div>
        ))}
      </nav>

      <div className="space-y-2 border-t border-line p-3">
        <Link
          href="/profile"
          className={cn(
            "flex items-center gap-2.5 rounded-xl border border-transparent p-2 transition-colors hover:border-line hover:bg-grey-bg",
            pathname === "/profile" && "border-line bg-grey-bg"
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

        <button
          type="button"
          onClick={handleLogout}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-line px-3 py-2.5 text-[0.8rem] font-semibold text-muted transition hover:border-red/40 hover:bg-red-bg hover:text-red"
        >
          <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.5 14v1.5A1.5 1.5 0 0 1 11 17H5.5A1.5 1.5 0 0 1 4 15.5v-11A1.5 1.5 0 0 1 5.5 3H11a1.5 1.5 0 0 1 1.5 1.5V6" />
            <path d="M9 10h8M14 7l3 3-3 3" />
          </svg>
          Log out
        </button>
      </div>
    </div>
  );

  const shell = (
    <div className="min-h-screen">
      {/* Attendant tablet: company logo as a faint body-wide background */}
      {isAttendant && (
        <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 flex items-center justify-center">
          <Image
            src={COMPANY.logoPath}
            alt=""
            width={760}
            height={300}
            className="w-[72%] max-w-3xl object-contain opacity-[0.08]"
            unoptimized
          />
        </div>
      )}

      {/* Top bar + main + footer (the menu opens on demand via the Menu button) */}
      <div className="flex min-h-screen flex-col">
        {/* Top bar */}
        <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-line bg-paper/90 px-4 backdrop-blur md:px-6">
          <div className="flex items-center gap-3">
            {isAttendant ? (
              <Link
                href={homeHref}
                className="rounded-md border border-line px-3.5 py-2 text-[0.9rem] font-semibold text-ink transition hover:border-ink"
              >
                Home
              </Link>
            ) : (
              <button
                type="button"
                onClick={() => setDrawer((v) => !v)}
                className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[0.85rem] font-semibold text-ink transition hover:border-ink"
                aria-expanded={drawer}
              >
                <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M3 5h14M3 10h14M3 15h14" /></svg>
                Menu
              </button>
            )}
            <Link href={homeHref} className="flex items-center">
              <Image
                src={COMPANY.logoPath}
                alt={`${COMPANY.name} logo`}
                width={150}
                height={52}
                className="brand-logo h-12 w-auto object-contain"
                unoptimized
              />
            </Link>
          </div>
          <div className="flex items-center gap-3">
            {operator && (
              <div className="flex items-center gap-2 rounded-full border border-gold/50 bg-gold-bg px-3 py-1.5">
                <span className="text-[0.82rem] font-semibold text-gold-dark">{operator.name}</span>
                <button
                  type="button"
                  onClick={clearOperator}
                  className="rounded-md border border-gold/50 px-2 py-0.5 text-[0.68rem] font-semibold text-gold-dark transition hover:bg-gold hover:text-[#231b04]"
                >
                  Switch user
                </button>
              </div>
            )}
            {!isAttendant && <NotificationBell />}
            <Link href="/profile" className="flex items-center gap-2.5 rounded-full py-1 pl-1 pr-1 transition hover:bg-grey-bg sm:pr-3">
              <Avatar user={user} size={36} />
              <span className="hidden text-left leading-tight sm:block">
                <span className="block text-[0.82rem] font-semibold text-ink">{user.name}</span>
                <span className="block text-[0.66rem] text-muted">{user.role}</span>
              </span>
            </Link>
          </div>
        </header>

        {/* Slide-in menu (opens on demand from the Menu button) */}
        {drawer && !isAttendant && (
          <div className="fixed inset-0 z-40">
            <div className="absolute inset-0 bg-black/40" onClick={() => setDrawer(false)} />
            <aside className="absolute inset-y-0 left-0 w-64 border-r border-line bg-paper shadow-pop">
              {sidebar}
            </aside>
          </div>
        )}

        <main className="mx-auto w-full max-w-[1280px] grow px-4 py-6 md:px-8">
          {needsOperator ? (
            <OperatorGate />
          ) : allowed ? (
            children
          ) : (
            <NotAuthorized role={user.role} />
          )}
        </main>

        <footer className="border-t border-line bg-paper">
          <div className="mx-auto flex max-w-[1280px] flex-col items-center justify-between gap-1 px-4 py-4 text-[0.72rem] text-muted sm:flex-row md:px-8">
            <span>{COMPANY.name} — {COMPANY.address}</span>
            <span className="text-gold-dark">{COMPANY.tagline}</span>
          </div>
        </footer>
      </div>
    </div>
  );

  // DSRs must confirm their zone code before ANYTHING loads — the gate fills the
  // whole screen (no sidebar, top bar or bell) until this device is trusted.
  return isDsr ? <DsrGate>{shell}</DsrGate> : shell;
}

function NotAuthorized({ role }: { role: string }) {
  return (
    <div className="rounded-2xl border border-line bg-paper p-8 text-center text-muted shadow-card">
      <p className="mb-2 font-bold text-ink">Not authorized</p>
      <p className="text-sm">Your role ({role}) cannot open this page.</p>
    </div>
  );
}

type NavItem = { href: string; label: string };

/** Split a role's flat nav into ordered sections so long menus stay scannable. */
function groupNav(nav: NavItem[]): { name: string; items: NavItem[] }[] {
  const sectionOf = (href: string) =>
    href.startsWith("/hatchery") ? "Hatchery" : href === "/users" ? "Admin" : "Sales";
  const groups: { name: string; items: NavItem[] }[] = [];
  for (const item of nav) {
    const name = sectionOf(item.href);
    let g = groups.find((x) => x.name === name);
    if (!g) {
      g = { name, items: [] };
      groups.push(g);
    }
    g.items.push(item);
  }
  // A single-section menu shouldn't shout its department — just call it "Menu".
  if (groups.length === 1) groups[0].name = "Menu";
  return groups;
}

/**
 * The single active nav item = the one whose href is the LONGEST match for the
 * current path (exact, or a `/`-boundary prefix). This way a parent like `/dsr`
 * doesn't also light up when you're on the more specific `/dsr/orders`.
 */
function activeHref(nav: NavItem[], pathname: string): string {
  let best = "";
  for (const { href } of nav) {
    const matches = pathname === href || pathname.startsWith(href + "/");
    if (matches && href.length > best.length) best = href;
  }
  return best;
}

function NavLink({
  href,
  label,
  active,
}: {
  href: string;
  label: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "block rounded-lg px-3.5 py-2 text-[0.92rem] font-semibold transition-colors",
        active
          ? "bg-gold text-[#231b04] shadow-card"
          : "text-muted hover:bg-grey-bg hover:text-ink"
      )}
    >
      {label}
    </Link>
  );
}

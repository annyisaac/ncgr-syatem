# NCGR LTD

Role-based sales-and-delivery management for **NCGR LTD**, a poultry hatchery in
Rwamagana–Gishari, Eastern Province, Rwanda. It manages orders, deliveries,
payment verification, and DSR commissions for two chick products —
**Tetra Super Harco** and **Ross 308**.

> _Your Partner in Poultry Excellence_

## Tech stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS v4** (brand tokens in `app/globals.css` via `@theme`; light & dark themes)
- **recharts** (charts), **xlsx** (Excel), **jspdf** + **jspdf-autotable** (PDF)
- **react-hook-form** + **zod** (forms & validation)

## Authentication

Login uses **Supabase Auth** (hashed passwords, JWT sessions managed by the
browser client). Database access **requires authentication** — RLS restricts
every table to the `authenticated` role, so nobody without a login can read or
write data. Within the app, who-sees-what is enforced by role
([`lib/permissions.ts`](lib/permissions.ts)).

- Only the **Admin** creates accounts and resets passwords; that runs through
  a service-role **edge function** (`supabase/functions/admin-users`) so the
  service key never reaches the browser.
- Users change their own password from **My Account**; for non-admins the
  change goes to the Admin for approval, then is applied in Supabase Auth.
- Passwords are hashed, so they can't be viewed — only reset.

## Data & persistence

All persistence lives behind the data-access layer in [`lib/db.ts`](lib/db.ts),
backed by **Supabase (Postgres)** — data is shared live across every computer.
UI components never talk to Supabase directly.

Setup: copy [`.env.example`](.env.example) to `.env` and fill in your Supabase
project URL + publishable key. Tables (users, dsrs, orders, commissions,
statements) and RLS policies are created by the project migrations.

**Download backup (JSON)** on the Admin dashboard still works and is still
recommended weekly.

## Getting started

```bash
npm install
npm run dev        # development
npm run build      # production build
npm run start      # run the production build
npm run lint       # lint
```

Open http://localhost:3000.

### First login (seeded Admin)

- **Email:** `isaac@ncgrltd.com`
- **Password:** `ncgr1234` (change this after first login)

Only the Admin creates additional users. Accounts are never deleted — only
activated/deactivated.

## Features

- **Orders & lifecycle** — create (Tetra: Province → District → DSR → sector;
  Ross: district + free pickup), auto 2% free chicks, confirm → verify →
  fulfill gates, reschedule/edit/refund (never deleted), full audit history.
- **Requests & approvals** — salespeople request refunds, compensation, or
  delivery-on-debt; the Admin dashboard opens with an **"Approvals waiting"**
  card covering order requests, commission requests, and password changes.
- **Payment verification** — Admin uploads multiple bank statements (Excel),
  auto-check adopts bank amounts and flags duplicates/missing; manual check
  (CASH allowed) with required comment. Payment checkers can record payments.
- **Deliveries** — monthly calendar with per-date counts/chick totals; click a
  date to manage that day's orders and delivery plan.
- **Commission** — 100 RWF/Tetra chick, 20 RWF/Ross chick; due on delivery or
  in advance when fully paid; initiate → Admin approve/reject or direct pay.
- **DSR registry** — register/activate DSRs, per-DSR dashboards and detail pages.
- **Dashboards** — role-specific KPIs, line/pie charts, clickable Admin tiles,
  delivery-date range filter.
- **Reports** — branded landscape PDFs (Delivery & Payment, Orders, DSR
  Commission) with signature lines; Excel export/import; JSON backup/restore.
- **Accounts** — profile page for every role (picture upload, light/dark mode,
  password change with Admin approval); Admin can view passwords, approve
  password changes, and see each account's signed-in devices.

## Roles

| Role | Sees |
| --- | --- |
| Admin | Everything |
| Tetra Zone Manager | Tetra orders in their own zone |
| Tetra Payment Checker | Tetra orders (verification + payments) |
| Ross Order Receiver | Ross orders |
| Ross Payment Checker | Ross orders (verification + payments) |

Visibility is enforced centrally by `canSee(order, user)` in
[`lib/permissions.ts`](lib/permissions.ts).

## Project structure

```
app/
  login/            Login page
  (app)/            Authenticated route group (sidebar shell + guard)
    dashboard/  users/  dsrs/  commission/
    verification/  deliveries/  orders/  profile/
components/
  ui/               Reusable UI (Button, Card, Modal, Toast, Table, Pill,
                    Select, DateRange, Dropdown, Avatar, GmailLink)
  charts/           Recharts wrappers (client-only)
  AuthProvider  DataProvider  ThemeProvider  AppShell  Providers
lib/
  types.ts          Domain types + computed helpers
  config.ts         Products, Rwanda geography, Tetra zones, rates, company
  db.ts             Data-access layer (localStorage today; swappable)
  permissions.ts    canSee gate + role navigation
  orders.ts         Lifecycle gates & transitions
  commission.ts     Commission math   commissionActions.ts  Workflow
  verification.ts   Statement auto-check   excel.ts  Sheet parsing
  reports.ts        PDF/Excel/backup   format.ts  device.ts  cn.ts
public/
  logo.png          Brand logo (header, login, PDF reports)
```

## Deployment

Standard Next.js build. Set the two `NEXT_PUBLIC_SUPABASE_*` environment
variables (see [`.env.example`](.env.example)) on the host, then:

```bash
npm run build && npm run start
```

or deploy to Vercel/Netlify (add the same env vars in the project settings).
All deployments share the same Supabase data.

## Domain notes

- **Tetra zones:** Zone 1 = Northern + Southern; Zone 2 = Eastern + Western.
  Kigali City is split by district (Zone 1 → Kicukiro + Nyarugenge; Zone 2 →
  Gasabo). Ross uses the flat 30-district list plus a free-text sector/pickup.
- **Computeds:** 2% extra chicks are free; free chicks are not charged;
  balance = chicks × price − payments.

# NCGR Ltd — Sales & Delivery Management System

Role-based sales-and-delivery management for **NCGR Ltd**, a poultry hatchery in
Rwamagana–Gishari, Eastern Province, Rwanda. It manages orders, deliveries,
payment verification, and DSR commissions for two chick products —
**Tetra Super Harco** and **Ross 308**.

> _Your Partner in Poultry Excellence_

## Tech stack

- **Next.js 16** (App Router) + **TypeScript**
- **Tailwind CSS v4** (brand tokens in `app/globals.css` via `@theme`; light & dark themes)
- **recharts** (charts), **xlsx** (Excel), **jspdf** + **jspdf-autotable** (PDF)
- **react-hook-form** + **zod** (forms & validation)

## Data & persistence

All persistence lives behind the data-access layer in [`lib/db.ts`](lib/db.ts).
Today it reads/writes the browser's `localStorage`; every function is typed and
async so the backend can be swapped for Firebase / Postgres **without changing
any UI code**. UI components never touch `localStorage` directly.

> **Important:** because storage is per-browser today, each computer holds its
> own data. Use **Download backup (JSON)** on the Admin dashboard to move or
> safeguard data (weekly backups recommended). Swapping in a real database via
> `lib/db.ts` makes all data shared automatically.

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
- **Password:** `ncgr1234`

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

The app is a standard Next.js build with no required environment variables
(see [`.env.example`](.env.example) for the future backend config). Any Node
host works:

```bash
npm run build && npm run start
```

or deploy directly to Vercel/Netlify. Because data is stored in each user's
browser today, deploying does not migrate data — use backup/restore.

## Domain notes

- **Tetra zones:** Zone 1 = Northern + Southern; Zone 2 = Eastern + Western.
  Kigali City is split by district (Zone 1 → Kicukiro + Nyarugenge; Zone 2 →
  Gasabo). Ross uses the flat 30-district list plus a free-text sector/pickup.
- **Computeds:** 2% extra chicks are free; free chicks are not charged;
  balance = chicks × price − payments.

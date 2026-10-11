# camtech back office

Web app for back-office staff of **camtech**, the standalone identity-verification service (selfie liveness, Emirates ID / passport / trade licence documents, face-to-document matching and manual review). Staff use it to watch verifications, decide review cases, look up people and documents, and manage configuration.

It is a static single-page app (Vite + React + TypeScript + Ant Design) that talks to the camtech **admin API** (`/v2/admin/...`, see `../camtech/docs/admin-api.md`). It can also run with a built-in **mock** back end, so it can be demoed with no server.

## Prerequisites

- Node.js 22 (20.19+ also works) and npm 10+
- For real data: a running camtech backend (default `http://localhost:8080/camtech-service`) whose CORS settings allow the back-office origin

## Setup

```bash
npm install
cp .env.example .env      # then edit if needed
npm run dev               # real backend at VITE_API_BASE_URL
npm run dev:mock          # no backend needed: mock data
```

Open http://localhost:5173.

## Environment variables

Vite inlines these at **build time** (`.env`, `.env.<mode>`, or the shell environment).

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8080/camtech-service` | Base URL of the camtech backend. The app calls `${VITE_API_BASE_URL}/v2/admin/...`. |
| `VITE_USE_MOCKS` | `false` | `true` serves everything from the in-memory mock layer in `src/mocks/` instead of the network. |

`.env.mock` (committed) sets `VITE_USE_MOCKS=true` and is loaded by `npm run dev:mock` / `npm run build:mock`.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` | Dev server against the real backend |
| `npm run dev:mock` | Dev server with mock data |
| `npm run build` | Type-check (`tsc -b`) and build to `dist/` |
| `npm run build:mock` | Same, but the bundle uses mock data (static demo build) |
| `npm run typecheck` | Type-check only |
| `npm run lint` | ESLint |
| `npm run preview` | Serve the built `dist/` locally |

## Mock mode

With `VITE_USE_MOCKS=true` the API client swaps `fetch` for `src/mocks/server.ts`, a fetch-compatible in-memory implementation of the whole admin API contract: paging, filters, role checks (403), validation errors (422), conflicts (409), the must-change-password flow, secrets shown once, and placeholder images for media (SVG avatars and "SPECIMEN" documents; images of failed attempts older than 7 days return `410 MEDIA_PURGED`, matching the retention policy).

The seed (`src/mocks/seed.ts`) is deterministic: ~60 verifications over the last 14 days across the four flows and both channels, failed liveness attempts (TOO_DARK, BLURRY, NOT_CLOSER, FACE_CHANGED, HEAD_TURNED), review cases (open, in review, decided), rejections (face mismatch, expired document, duplicate identity), fictional people with Emirates ID numbers such as `784-1990-1234567-1`, companies with trade licences, tenant `NOQODI` with all entitlements enabled and unlimited quotas, client apps `MOBILE_APP` / `WEB_APP` / `BACKOFFICE`, settings, reason codes in English and Arabic, webhooks with deliveries, audit events and users.

Demo users (password for all: `Demo@1234`):

| Username | Role | Notes |
|---|---|---|
| `admin` | ADMIN | everything |
| `sara.review` | REVIEWER | can decide reviews, cancel verifications |
| `omar.view` | VIEWER | read-only |
| `layla.new` | REVIEWER | must change password at first sign-in |

Changes are kept in memory only: reloading the page resets the data (you stay signed in).

## Roles

- **Viewer** — reads everything except back-office users.
- **Reviewer** — Viewer + review actions (assign, comment, approve, reject) and cancelling a verification.
- **Administrator** — everything, including configuration and users.

Actions a role can't perform are hidden or disabled; configuration pages show a read-only hint for non-admins. If the API still answers `403`, the app shows "You don't have permission".

## Authentication

`POST /v2/admin/auth/login` returns a bearer token. It is kept in memory and in `sessionStorage` (survives a reload, not a new tab) and sent as `Authorization: Bearer …`. Any `401` clears it and returns to the sign-in page. When `mustChangePassword` is true the user only sees the "Choose a new password" screen until it is changed. Images (`GET /v2/admin/media/{id}`) are fetched as blobs with the token and shown via object URLs.

## Production build and deployment

```bash
VITE_API_BASE_URL=https://dev.noqodi.com/camtech-service npm run build
```

`dist/` is plain static files: serve it from any web server with an **SPA fallback** (unknown paths → `index.html`).

The backend must allow the back-office origin in its **CORS** configuration (methods GET, POST, PUT, DELETE; header `Authorization`, `Content-Type`), otherwise the browser blocks the calls. Alternatively serve the app and the API from the same origin behind a reverse proxy.

### Docker

```bash
docker build -t camtech-backoffice --build-arg VITE_API_BASE_URL=https://dev.noqodi.com/camtech-service .
docker run -p 8081:80 camtech-backoffice
```

Multi-stage: Node builds `dist/`, nginx serves it (`nginx.conf`: SPA fallback, long cache for hashed assets, no cache for `index.html`). For a demo image use `--build-arg VITE_USE_MOCKS=true`.

## Folder structure

```
src/
  api/          typed client (client.ts), contract types (types.ts), endpoint modules
                (auth.ts, operations.ts = dashboard/sessions/reviews/parties/documents/media/audit,
                 configuration.ts = tenant/client apps/settings/catalogue/webhooks/retention/users)
  mocks/        in-memory mock API: server.ts (routes), seed.ts (dataset), catalog.ts, images.ts
  auth/         token store, auth context/hooks, login + change-password screens, route guards
  layout/       app shell (sidebar, header, account menu), theme (light/dark), navigation
  components/   shared UI: Tags (status/decision…), SimilarityBand, Timeline (attempts),
                FaceComparison, ImageViewer, PageHeader, ConfirmAction, SecretModal, DataState…
  features/     one folder per area, pages + their components
    dashboard/ sessions/ reviews/ people/ documents/ config/ admin/ misc/
  lib/          labels.ts (code → label), colors.ts, format.ts (dates/numbers), hooks.ts, …
```

## Operator guide (page by page)

**Overview**
- **Dashboard** — volumes for the last 7/14/30 days, approval rate, cases waiting for review, average face-match similarity, a daily chart by decision, top failure reasons, split by flow and channel, and a "Needs attention" list of open review cases.

**Operations**
- **Verifications** — every session. Filter by status, decision, flow, channel, app, dates or search (session id, customer ref, document number, name). Click a row to open it.
- **Verification detail** — the face comparison (selfie vs document photo on the similarity band: red = no match, amber = review, green = match, dark green = excellent), then *What happened, step by step*: every attempt with its checks (score vs what was needed) and images (click to enlarge). On the right: decision, summary, document fields, device, webhook events, and a link to the review case. Reviewers can **Cancel** a verification that is still created/in progress.
- **Review queue** — tabs *Open*, *In review*, *Decided* (approved / rejected). *Assign to me* takes a case.
- **Review case** — big selfie vs document photo with the similarity band. Write a short note, press **Approve** or **Reject**, confirm. The decision is final and the client app is notified. *Add as comment only* records a note without deciding. Key facts, attempts and history are below.
- **People** — search people and companies. A record shows personal data, documents, face templates (admins can **Revoke** one), verifications and relations (owners/partners). Admins can **Erase person** (typing the name to confirm) — this permanently deletes their data; only an audit entry remains.
- **Documents** — filter by type, status, "expiring before" (or the *Expiring in 30 days* shortcut; those rows are highlighted). Detail shows each field with its source (App OCR, Server OCR, MRZ, Entered manually), images and server scans.
- **Document scans** — each server OCR run with confidence, timing and errors; detail shows raw fields and the raw OCR text.

**Configuration** (administrators edit; others read)
- **Tenant & entitlements** — flows, documents and features the tenant may use: enable switch, daily quota (*Unlimited* when empty), used today, valid until.
- **Client apps** — each calling app: details, permissions per feature, credentials (create: the secret is shown once — copy it; revoke), and *Preview capabilities* (exactly what the app receives).
- **Settings** — thresholds and limits. Each has a global default and optional overrides per flow / channel / client app; the most specific wins (client app > channel > flow > global). Pick a flow/channel/app at the top to see which value is in effect. Global defaults can be edited but not deleted.
- **Flows** — ordered steps per flow; mandatory or optional, maximum attempts.
- **Messages** — what people see in the app for each reason code, in English and Arabic.
- **Webhooks** — endpoints notified of events; create (secret shown once), edit, rotate secret, send test, deliveries with retry.
- **Data retention** — how many days each kind of data is kept.

**Administration**
- **Audit log** — who did what and when; expand a row for details.
- **Users** (administrators only) — create users (a temporary password is shown once), change role/status, reset password.
- **Account menu** (top right) — your name and role, change password, sign out. The moon/sun button switches dark/light theme (remembered in this browser).

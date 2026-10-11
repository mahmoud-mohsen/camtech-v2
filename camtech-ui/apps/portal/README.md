# camtech tenant portal (`@camtech/portal`)

The console for **tenants** — companies that integrate camtech identity verification. They see their verifications and document scans, manage apps, API keys and webhooks, brand the end-user screens, try the flows in a playground and copy integration code.

Stack: React 19, Ant Design 6, TanStack Query 5, React Router 7 (data router), Recharts, Vite 8, Vitest. All API calls go through `CamtechTenantClient` from `@camtech/api-client` (`/v2/tenant/**`).

## Run

From `camtech-ui/` (dependencies are installed at the workspace root):

```bash
npm run dev:portal          # http://localhost:5174 against VITE_API_BASE_URL
npm run dev:portal:mock     # same, with the in-memory mock backend (tenants NOQODI and DEMO)
npm run build -w @camtech/portal
npm run build:mock -w @camtech/portal
npm run test -w @camtech/portal
npm run lint -w @camtech/portal
```

The Branding preview and the Playground embed the SDK (`apps/sdk`), so run `npm run dev:sdk` (or `dev:sdk:mock`) next to it.

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8080/camtech-service` | camtech backend |
| `VITE_SDK_URL` | `http://localhost:5175` | Where the SDK is served (preview, playground, code samples). Its origin is the only one whose `postMessage`s are accepted. |
| `VITE_USE_MOCKS` | `false` | `true` = in-memory mock backend (`.env.mock`, used by `--mode mock`) |

## Sign-in and roles

Users sign in on `/login` with a username and password (`POST /v2/tenant/auth/login`). The bearer token is kept in
`sessionStorage` (`camtech.portal.token`, so it survives a reload but not a new tab) and sent as
`Authorization: Bearer …` on every call; on load the session is restored with `GET /v2/tenant/auth/me`. The tenant
comes from the signed-in user (a `?tenant=` query from old back-office links is ignored).

- `src/auth/`: `AuthContext` (provider), `useAuth()` / `usePermissions()` / `useTenantInfo()`, `RequireAuth`
  (+ `OwnerOnly`), `LoginPage`, `ChangePasswordPage` and the shared `ChangePasswordForm`.
- Every API answer goes through `src/api/client.ts`: `401 UNAUTHORIZED` signs the user out (back to `/login`),
  `403 PASSWORD_CHANGE_REQUIRED` sends them to `/change-password`, `403 TENANT_SUSPENDED` shows the suspended screen.
- `usePermissions()`: `canBuild` (OWNER, DEVELOPER: apps, keys, webhooks, flows, branding, scan settings, playground),
  `canReview` (OWNER, REVIEWER: cancel verifications, review scans), `isOwner` (Settings → Users). Other roles see
  the same pages read-only; the server enforces the same rules.

**Mock mode** (`npm run dev:portal:mock`): sign in as `owner`, `developer`, `reviewer`, `viewer`, `newbie` (must change
password) or `demo.owner` (the DEMO tenant), all with the password `Demo123456`. The login page lists them.

## Pages

Sign in · Change password · Overview · Verifications (+ detail) · Document scans (+ detail) · Apps & API keys · Webhooks · Branding · Playground · Integration guide · Audit log · Reason codes · Users (owners) · 404. Every route is lazy-loaded and has its own error boundary; list filters and paging live in the URL.

## postMessage protocol

- SDK → portal: `{ source: 'camtech-sdk', version: 1, type: 'ready'|'step'|'complete'|'cancel'|'error'|'event'|'resize', payload }` — accepted only when `event.origin` is the SDK origin **and** `event.source` is our iframe.
- Portal → SDK (branding preview): `{ source: 'camtech-portal', type: 'branding', payload: Branding }`, `targetOrigin` = SDK origin, sent after load, on `ready`, and (debounced) on every form change.

See `src/lib/sdkMessages.ts`.

## Layout

```
src/
  api/client.ts          transport (real fetch or lazy mock), auth-failure hook, the `api` client
  auth/                  sign-in: AuthContext, RequireAuth, LoginPage, ChangePasswordPage, permissions
  layout/                AppLayout, nav, theme (light/dark), RouteError, PageSkeleton
  components/            DataState, PageHeader, Tags, CodeBlock, CopyButton, SecretModal, ConfirmAction, …
  features/<page>/       one folder per page
  lib/                   origins, contrast, jwt, mask, image (logo), snippets, sdkMessages, labels, hooks, …
  i18n/                  shell strings (English, Arabic for the sign-in / users screens; falls back to English)
  mocks/                 fetch-compatible mock of /v2/tenant/** (server.ts, seed.ts, catalog.ts)
```

# Tenant Portal — Feature Spec (v1)

Status: Implemented (backend, Backoffice, portal) · Date: 2026-10-10

## 1. Goal

Make the tenant portal (`camtech-ui/apps/portal`) production-ready and self-service: tenants sign in, manage their own
users, view their documents and people, review cases that need a human, and act on data-subject requests — without
asking camtech operators.

## 2. Current state (summary)

| Area | Portal today |
|---|---|
| Access | No sign-in. Tenant chosen by code (`X-Tenant-Code`), gated by `camtech.tenant-portal.enabled` (dev/QA only). Actor recorded as `tenant-portal`. |
| Verifications | List, detail, cancel. |
| Scans | List, detail, review (approve with corrections / reject), OCR settings (`reviewMode` AUTO/ALWAYS/NEVER). **No images** (`imagesCount` only). |
| Apps, Webhooks, Flows (liveness), Branding, Playground, Guide, Audit, Reason codes | Done. |
| Overview | Usage vs quota, daily chart, get-started checklist. |
| Missing | Users/roles, Documents, People, review-case queue, retention, richer dashboard. |

## 3. Scope

### 3.1 Sign-in and tenant users — **P0, blocker for production**

Sign-in is **username + password only** (no SSO / 2FA in v1).

**Tenant portal pages**
- `/login` — username + password.
- `/change-password` — forced on first login and after any reset.
- `/users` (Owner only) — list; add user (username, name, email, role) with a **Generate password** button;
  edit role; disable/enable; reset password (shows the new password once).

**Backoffice changes** (camtech creates the first login)
- "New tenant" form gets an **Owner account** section: username, name, email, password with a **Generate password**
  button (random, 16 chars). Shown once in the secret modal with a Copy button; camtech shares it with the tenant.
- Tenant row gets **Reset owner password** (same generate + show-once modal) for when the tenant is locked out.
- Generated/reset passwords always set `mustChangePassword = true`.

**Roles**

| Role | Permissions |
|---|---|
| OWNER | Everything, including Users, People erase/revoke, review settings. |
| DEVELOPER | Apps, credentials, webhooks, flows, branding, playground, OCR settings. Read everything else. |
| REVIEWER | Review queue (scans + verifications), cancel verification. Read everything else. |
| VIEWER | Read-only. |

A tenant must always have at least one active OWNER (cannot disable or demote the last one). The first OWNER is
created by camtech in the Backoffice when the tenant is created.

**Backend**
- New entity `TenantUser` (tenantId, username, email, name, role, status, passwordHash, mustChangePassword, lastLoginAt).
- `/v2/tenant/auth/login | me | logout | change-password`.
- `/v2/tenant/users` (GET, POST), `/v2/tenant/users/{id}` (PUT), `/v2/tenant/users/{id}/reset-password` (POST).
- `POST /v2/admin/tenants` accepts `owner { username, displayName, email, password }`;
  `GET/POST /v2/admin/tenants/{id}/users`, `PUT /v2/admin/tenants/{id}/users/{userId}`,
  `POST /v2/admin/tenants/{id}/users/{userId}/reset-password` (ADMIN). Passwords are hashed; never returned after creation.
- Replace `TenantPortalFilter` header resolution with token auth; tenant comes from the user, not a header.
  Suspended tenant → 403 `TENANT_SUSPENDED` (unchanged).
- Role enforcement server-side (same pattern as `AdminRoleInterceptor` / `@AdminAccess`).
- Audit actor = tenant username, actorType = `TENANT_USER`.
- Remove the `camtech.tenant-portal.enabled` dev-only gate once this ships.

**Frontend**
- Replace `TenantContext` / `TenantGate` / `ChooseTenantPage` with an `AuthContext` + `RequireAuth`, mirroring the
  Backoffice (`backoffice/src/auth/*`). `usePermissions()` hides/disables controls per role.
- Backoffice "Portal" button opens the portal login page.

### 3.2 Documents with images — P1

**Pages**
- `/documents` — list with filters: search, document type, status, expiring before.
- `/documents/:id` — extracted fields, status, expiry, issuer, linked person, linked scans, **front/back images**.
- `/scans/:id` — add document images next to the fields (needed to review corrections).

**Backend**
- `GET /v2/tenant/documents`, `GET /v2/tenant/documents/{id}` (tenant-scoped, same data as admin minus internal fields).
- `GET /v2/tenant/media/{id}` — serves **document images only**. Selfie / face-crop media → 404.
- Media responses: `Cache-Control: private, no-store`.

### 3.3 Review queue — P1

**Page** `/reviews` with two tabs, plus a pending count badge in the nav and on Overview.

**Tab: Scans** (OCR review — already reviewable today)
- Queue of scans awaiting review (status pending review), oldest first.
- Detail: fields side-by-side with document images; approve with corrections / reject with reason
  (existing `POST /v2/tenant/document-scans/{id}/review`).

**Tab: Verifications** (face/liveness review cases)
- Queue: open / mine / decided.
- Case detail: session summary, step timeline, selfie, document photo, match label **Strong / Weak / No match**
  (no raw similarity score, no thresholds), reason codes.
- Actions: claim/assign, comment, approve / reject with note.

**Review ownership** — the tenant's decision is the main, final decision. camtech has no override.

| Value | Behaviour |
|---|---|
| `TENANT` (default) | Cases go to the tenant queue. The tenant's approve/reject is final. camtech can see cases and decisions read-only in the Backoffice. |
| `CAMTECH` | Tenant hands review to camtech (managed service). Cases go to the Backoffice queue; tenant sees the outcome. |

Set by the Owner on `/reviews/settings`; camtech can also set it in the Backoffice.

**Backend**
- New config key `review.owner` (tenant-scoped, default `TENANT`).
- Backoffice review-case decide/assign/comment are blocked (409) for cases owned by the tenant.
- `GET /v2/tenant/review-cases`, `GET /v2/tenant/review-cases/{id}` (read-only view always);
  `POST .../assign`, `POST .../comment`, `POST .../decide` — REVIEWER/OWNER only; 409 `REVIEW_OWNED_BY_CAMTECH`
  when `review.owner = CAMTECH`.
- Backoffice queue lists the default tenant's cases plus those of tenants with `review.owner = CAMTECH`
  (cross-tenant; each case carries `tenantId`).
- Tenant media access extended to the case's selfie only while the case is open to the tenant
  (`/v2/tenant/review-cases/{id}/media/{mediaId}`).
- Backoffice: show who decided (tenant user vs camtech) on the case page; filter queue by owner.
- Backoffice gap fix: wire the existing `POST /v2/admin/document-scans/{id}/review` into the Backoffice scan detail.

### 3.4 People — P1

**Pages**
- `/people` — search by subject ref / name / document number.
- `/people/:id` — sessions, documents, face templates (status, created, last used — no images).
- Actions (Owner only, confirm by typing the subject ref):
  - Revoke face template.
  - Erase person (permanent; removes images, templates, document data; keeps an anonymised audit row).
- **Export person data** (Owner only): downloads a ZIP with `person.json` (profile, sessions with steps and
  decisions, documents with fields, face templates metadata, review decisions, audit events about the person) and the
  person's document images. Used for data-subject access requests.

**Backend**
- `GET /v2/tenant/parties`, `GET /v2/tenant/parties/{id}`, `DELETE /v2/tenant/parties/{id}`,
  `POST /v2/tenant/parties/{id}/face-templates/{tid}/revoke`, `GET /v2/tenant/parties/{id}/export` (ZIP).
- Every action audited with the tenant user.

### 3.5 Overview improvements — P2

Add to `/`:
- Top failure reasons (reason code + count + link to filtered verifications).
- Results by flow and by channel.
- "Needs attention": pending reviews, webhooks failing, credentials expiring within 14 days, quota > 80%.

**Backend**: extend `GET /v2/tenant/dashboard` with `topFailureReasons`, `byFlow`, `byChannel`, `attention`.

### 3.6 Data retention (read-only) — P2

**Page** `/settings/retention` — retention days per data category. Editing stays in the Backoffice.

**Backend**: `GET /v2/tenant/retention-policies`.

### 3.6a Document expiry warning — P2

**Setting** (Owner/Developer) on `/settings/documents`: "Warn before document expiry" in days (1–365, default 30).
Drives the `DOCUMENT_EXPIRING` webhook and the default of the "expiring before" filter on `/documents`.

**Backend**: new tenant-scoped config key `document.expiry_warning_days`;
`GET/PUT /v2/tenant/document-settings`.

### 3.7 Webhooks — P1 (changes only; page already exists)

**Existing events:** `SESSION_COMPLETED`, `SESSION_EXPIRED`, `REVIEW_OPENED`, `REVIEW_DECIDED` (review cases),
`WEBHOOK_TEST`.

**New events**

| Event | When | Payload (key fields) |
|---|---|---|
| `SCAN_REVIEW_REQUIRED` | A scan enters pending review | scanId, documentType, createdAt |
| `SCAN_REVIEW_DECIDED` | A scan is approved/rejected | scanId, decision, decidedBy (`TENANT`/`CAMTECH`) |
| `DOCUMENT_EXPIRING` | Daily job; document expires within the tenant's warning period (`document.expiry_warning_days`, default 30) | documentId, partyId, expiresOn |
| `PARTY_ERASED` | A person is erased | partyId, subjectRef, erasedAt, erasedBy |

**Changes to existing events**
- `REVIEW_DECIDED`: `decidedBy` is now `TENANT`/`CAMTECH` (it used to carry the camtech operator's username);
  `reviewer` = the tenant username when the tenant decided.

**Other**
- Add new events to the allowed set (`AdminWebhookController.EVENTS`) and the portal event picker.
- Roles: OWNER/DEVELOPER manage; others read-only.
- Endpoint failing repeatedly (e.g. last 10 deliveries failed) → "Failing" badge on the webhooks page and an
  entry in Overview "Needs attention".

## 4. Stays camtech-only (out of scope)

- Editing entitlements / quotas (portal stays read-only; optional "Request more" link later).
- Liveness policy limits (tenant chooses within them on `/flows`, as today).
- Global flows/steps and global reason-code messages.
- Tenant create / suspend.
- Raw similarity scores and thresholds.
- camtech staff users.
- Retention editing.

## 5. Navigation (after)

- **Monitor**: Overview, Verifications, Reviews, Scans, Documents, People, Audit
- **Build**: Apps, Webhooks, Flows, Branding, Playground, Guide
- **Settings**: Users, Review settings, OCR settings, Document settings, Retention
- **Reference**: Reason codes

## 6. Delivery order

| Phase | Items |
|---|---|
| 1 | 3.1 Sign-in, users, roles |
| 2 | 3.2 Documents + images, scan images, 3.3 Scans review tab, 3.7 scan webhook events |
| 3 | 3.4 People (incl. export), `PARTY_ERASED` |
| 4 | 3.3 Verification review cases + review ownership setting, `REVIEW_DECIDED.decidedBy` |
| 5 | 3.5 Overview, 3.6 Retention, 3.6a Document settings, `DOCUMENT_EXPIRING`, failing-webhook alerts |

## 7. Open questions

None.

# Tenant portal API

The API behind the tenant portal ([`camtech-ui/apps/portal`](../../camtech-ui/apps/portal)). A tenant is a company that integrates camtech into its own apps. In the portal it sees its verifications, document scans, documents and people, reviews what needs a person, manages its client apps, API keys and webhooks, sets the look of the web SDK, and tries the end-user flows in a playground.

All paths are under `/v2/tenant`. The back-office API for camtech's own operators is in [admin-api.md](admin-api.md). The public API for apps is in [integration-guide.md](integration-guide.md).

## Sign-in, users and roles

Tenant users sign in with a username and password (usernames are unique across tenants, so no tenant code is needed). camtech creates each tenant's first OWNER in the back-office (`POST /v2/admin/tenants` with `owner`, or `POST /v2/admin/tenants/{id}/users`) and shares the password; the owner then adds the rest. A generated or reset password must be changed at first sign-in.

| Method | Path | Body / response |
|---|---|---|
| POST | `/auth/login` | `{username, password}` → `{token, expiresAt, user, tenant: {code, name}}`. `401 INVALID_LOGIN`, `423 ACCOUNT_LOCKED`, `403 TENANT_SUSPENDED` |
| POST | `/auth/logout` | 204 |
| GET | `/auth/me` | `{user, tenant}` |
| POST | `/auth/change-password` | `{currentPassword, newPassword}` → 204. At least 10 characters with letters and digits (`400 WEAK_PASSWORD`, `400 WRONG_PASSWORD`) |
| GET | `/users` | `TenantUser[]` (OWNER) |
| POST | `/users` | `{username, displayName?, email?, role, password?}` → `{user, password}`; a blank password is generated. The password is returned once. `409 USERNAME_TAKEN` (OWNER) |
| PUT | `/users/{id}` | `{displayName?, email?, role?, status?}`. `409 LAST_OWNER`, `409 SELF_LOCKOUT` (OWNER) |
| POST | `/users/{id}/reset-password` | `{password?}` → `{password}`; signs the user out everywhere (OWNER) |

Every other call sends `Authorization: Bearer <token>`. Errors: `401 UNAUTHORIZED` (no or expired session), `403 PASSWORD_CHANGE_REQUIRED`, `403 TENANT_SUSPENDED`, `403 FORBIDDEN` (role).

| Role | Can |
|---|---|
| OWNER | Everything, including users, people (erase, export, revoke a face), review settings |
| DEVELOPER | Apps and API keys, webhooks, flows, branding, OCR and document settings, playground |
| REVIEWER | Review scans and verifications, cancel a verification |
| VIEWER | Read only |

Without a role rule on an endpoint, GET is open to every role and other methods need DEVELOPER. Changes are written to the audit log with actor type `TENANT` and the user's username.

## What the portal does not show

The portal shows the same records as the back-office, limited to the tenant, but some data stays inside camtech:
- similarity scores and thresholds (review cases show a match label: `STRONG`, `WEAK` or `NO_MATCH`)
- IP addresses
- selfies, except to a reviewer of an open case the tenant reviews; document images are served by `/media/{id}`
- camtech operators' names and notes: shown as `camtech`

## Conventions

These are the same as the admin API: camelCase JSON, ISO-8601 UTC dates, errors as `{ code, message }`, and paging with `?page=0&size=20`, which returns `{ items, page, size, total }`. TypeScript types for every response are in [`camtech-ui/packages/api-client/src/types.ts`](../../camtech-ui/packages/api-client/src/types.ts).

## Tenant and usage

| Method | Path | Response |
|---|---|---|
| GET | `/info` | `TenantInfo = { code, name, status, createdAt, flows: {code,name,enabled}[], documentTypes: {code,name,enabled}[], features: {code,enabled}[] }` |
| GET | `/dashboard?days=14` | The admin dashboard without `avgDocMatchSimilarity`. It includes `byClientApp`, `scans` and `attention = { scansToReview, verificationsToReview, failingWebhooks[], credentialsExpiring[], documentsExpiring, expiryWarningDays }`. |
| GET | `/entitlements` | `Entitlement[]`, read-only: what the tenant may use, its daily quota and today's usage |
| GET | `/reason-codes` | `{ code, category, httpStatus, messageEn, messageAr }[]`: the messages end users see |
| GET | `/audit-events?actor&action&entity&from&to&page&size` | `Page<AuditEvent>` |

## Verifications and document scans

| Method | Path | Response |
|---|---|---|
| GET | `/sessions?status&decision&flowCode&channel&clientAppCode&from&to&q&page&size` | `Page<TenantSessionSummary>` |
| GET | `/sessions/{publicId}` | `TenantSessionDetail` (steps with check outcomes, document, decision, review, webhook events, device) |
| POST | `/sessions/{publicId}/cancel` | `TenantSessionDetail`. Only open sessions can be cancelled (`409 SESSION_CLOSED`). |
| GET | `/document-scans?status&docTypeCode&page&size` | `Page<TenantScanSummary>`, each with its `reviewReasons` (why it waits for review) |
| GET | `/document-scans/{id}` | `TenantScanDetail` with the extracted fields, `documentId` and `media` (document images) |
| POST | `/document-scans/{id}/review` | `{decision: APPROVE\|REJECT, corrections?, note?}` (REVIEWER) |

## Documents, images and people

| Method | Path | Response |
|---|---|---|
| GET | `/documents?q&docTypeCode&status&expiringBefore&page&size` | `Page<DocumentSummary>` |
| GET | `/documents/{id}` | Fields, `media` (images), scans |
| GET | `/media/{id}` | A document image (`Cache-Control: no-store`). Only images linked to a document or scan; anything else is 404. |
| GET | `/parties?q&partyType&page&size` | `Page<PartySummary>` |
| GET | `/parties/{id}` | Profile, documents, face templates (no images), verifications |
| DELETE | `/parties/{id}` | Erases the person: verifications, documents, images, face templates. Sends `PARTY_ERASED` (OWNER) |
| POST | `/parties/{id}/face-templates/{templateId}/revoke` | 204 (OWNER) |
| GET | `/parties/{id}/export` | ZIP: `person.json` (profile, verifications, documents with fields, audit entries) and `documents/{id}/…` images (OWNER) |

## Reviews

The tenant decides its verifications that need a person when `review.owner` is `TENANT` (the default). With `CAMTECH`, camtech operators decide them in the back-office and the tenant sees the outcome; tenant writes return `409 REVIEW_OWNED_BY_CAMTECH`.

| Method | Path | Response |
|---|---|---|
| GET / PUT | `/review-settings` | `{owner, owners}`; PUT `{owner: TENANT\|CAMTECH}` (OWNER) |
| GET | `/reviews/summary` | `{owner, scansToReview, verificationsToReview}` |
| GET | `/review-cases?status&mine&page&size` | `Page<{id, sessionPublicId, status, reason, matchLabel, assignedTo, partyName, documentType, createdAt, updatedAt}>` |
| GET | `/review-cases/{id}` | Case with `canDecide`, `evidence` ({mediaId, stepCode, role}: selfie and document images, open cases only), the verification, actions |
| POST | `/review-cases/{id}/assign` | `{assignee?}` (a tenant username; default yourself) (REVIEWER) |
| POST | `/review-cases/{id}/comment` | `{note}` (REVIEWER) |
| POST | `/review-cases/{id}/decide` | `{decision: APPROVED\|REJECTED, note}`. Sends `REVIEW_DECIDED` with `decidedBy: TENANT` (REVIEWER) |
| GET | `/review-cases/{id}/media/{mediaId}` | An evidence image of an open case (REVIEWER) |

## Settings

| Method | Path | Response |
|---|---|---|
| GET / PUT | `/document-settings` | `{expiryWarningDays, defaultExpiryWarningDays, min, max}`; PUT `{expiryWarningDays}` (1-365). Documents entering this window send `DOCUMENT_EXPIRING` once. |
| GET | `/retention-policies` | Read-only: retention days per data category (camtech sets them) |

## Client apps and API keys

The tenant manages its `MOBILE` and `WEB` apps. The `ADMIN` channel is camtech's own back-office and is never listed here.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/client-apps` | — | `ClientApp[]` |
| POST | `/client-apps` | `{ code, name, channel: 'MOBILE' \| 'WEB', platform?, appIdentifier?, allowedOrigins?: string[] }` | `201 ClientApp` |
| PUT | `/client-apps/{id}` | `{ name?, platform?, appIdentifier?, allowedOrigins?, status? }` | `ClientApp` |
| PUT | `/client-apps/{id}/permissions` | `{ featureCode, allowed }[]` (can only narrow the tenant's entitlements) | `ClientApp` |
| GET | `/client-apps/{id}/capabilities` | — | What the app gets from `GET /v2/capabilities` |
| GET | `/client-apps/{id}/credentials` | — | `Credential[]` |
| POST | `/client-apps/{id}/credentials` | `{ expiresAt?: 'YYYY-MM-DD' }` | `201 { credential, secret }`. The secret is shown **once**. |
| POST | `/credentials/{id}/revoke` | — | `Credential` |

## Webhooks

These are the same as the admin webhooks (see [integration-guide.md §7](integration-guide.md#7-webhooks) for the payload and signature).

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/webhooks` | — | `Webhook[]` |
| POST | `/webhooks` | `{ url, events[] }` | `201 { webhook, secret }`. The secret is shown once. |
| PUT | `/webhooks/{id}` | `{ url?, events?, status? }` | `Webhook` |
| DELETE | `/webhooks/{id}` | — | `204` |
| POST | `/webhooks/{id}/rotate-secret` | — | `{ webhook, secret }` |
| POST | `/webhooks/{id}/test` | — | `WebhookDelivery` (sent right away) |
| GET | `/webhooks/{id}/deliveries?page&size` | — | `Page<WebhookDelivery>` |
| POST | `/webhook-deliveries/{id}/retry` | — | `WebhookDelivery` |

## Duplicate identity search

When `DEDUP_SEARCH` is in the tenant's plan, the tenant chooses whether new faces are searched against the faces registered to its other people (`dedup.enabled`, tenant-wide). A match sends the verification to review with `DUPLICATE_IDENTITY`. The similarity threshold stays with camtech, and camtech can still override the switch for a flow, channel or app.

```ts
DuplicateSearchSettings = { available: boolean, enabled: boolean, flows: FlowCode[] }   // flows: the tenant's flows with the step
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/duplicate-search` | — | `DuplicateSearchSettings` |
| PUT | `/duplicate-search` | `{ enabled: boolean }` | `DuplicateSearchSettings`. `403 FEATURE_NOT_ENABLED` when not in the plan, `400 VALIDATION_ERROR` without `enabled`. Audited as `DUPLICATE_SEARCH_UPDATED`. |

When the search is off for an app, its capabilities leave `DEDUP_SEARCH` out of the flow `steps`.

## Liveness settings per flow

For each liveness flow the tenant is entitled to, the tenant chooses the mode, the challenges and how many each user does, inside the limits set by camtech's back-office (`policy`). By default every challenge (`TURN_LEFT`, `TURN_RIGHT`, `BLINK`, `LOOK_UP`, `LOOK_DOWN`, `SMILE`, `MOVE_CLOSER`) is allowed and selected, with 2 per user. Each session draws `challengeCount` of the selected challenges at random, in random order; selecting exactly `challengeCount` means all of them every time. Selfie ID verification is always ACTIVE.

```ts
TenantFlowLiveness = { flowCode, flowName, mode: 'PASSIVE' | 'ACTIVE', actions: ChallengeAction[], challengeCount: number,
  policy: LivenessPolicy, customized: boolean, updatedAt: string | null }   // customized false = policy defaults
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/flows` | — | `TenantFlowLiveness[]` |
| PUT | `/flows/{flowCode}/liveness` | `{ mode, actions, challengeCount }` | `TenantFlowLiveness`. Audited as `LIVENESS_SETTINGS_UPDATED`. |

`400` codes, checked in this order: `VALIDATION_ERROR` (missing or unknown values), `MODE_NOT_ALLOWED`, `DUPLICATE_ACTION`, `ACTION_NOT_ALLOWED`, then for ACTIVE only: `COUNT_OUT_OF_RANGE` (outside `minActions..maxActions`), `COUNT_EXCEEDS_SELECTION`, `SPARE_ACTION_REQUIRED` (with `requireSpareAction`, select at least `challengeCount + 1`). In PASSIVE mode no challenge is done and the actions and count are kept for later. Thresholds stay with camtech.

## Branding of the web SDK

This sets what the tenant's end users see in the web SDK. The SDK reads it from `GET /v2/branding`. When the tenant has not set any branding, defaults apply.

```ts
Branding = {
  tenant: string, displayName: string,
  logoDataUrl: string | null,          // data:image/(png|jpeg|webp|svg+xml);base64,… ≤ ~300 KB; SVG without scripts
  primaryColor, accentColor, backgroundColor, surfaceColor, textColor: string,   // #RRGGBB or #RRGGBBAA
  borderRadius: number,                // 0-32
  fontFamily: 'system-ui' | 'Inter' | 'Roboto' | 'Noto Sans Arabic' | 'Tajawal' | 'Cairo',
  themeMode: 'LIGHT' | 'DARK' | 'AUTO',
  supportEmail: string | null, supportUrl: string | null, privacyUrl: string | null,   // https:// URLs
  showPoweredBy: boolean,
  texts: { en?: Texts, ar?: Texts },   // Texts = { welcomeTitle?, welcomeBody?, doneTitle?, doneBody? }
  updatedAt: string | null             // null = defaults
}
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/branding` | — | `Branding` |
| PUT | `/branding` | `Branding` without `tenant` and `updatedAt` | `Branding`. Invalid input returns `400 VALIDATION_ERROR` with the field name in the message. |
| DELETE | `/branding` | — | `Branding` (the defaults) |

## Playground

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/playground/sdk-token` | `{ clientAppCode, subjectRef?, ttlMinutes? }` | `201 { sdkToken, expiresAt, tenantCode, clientAppCode, subjectRef }` |

This gives an SDK token for one of the tenant's active apps, the same token its backend would get from `POST /v2/sdk-tokens`. The portal uses it to run the real end-user flows in the web SDK.

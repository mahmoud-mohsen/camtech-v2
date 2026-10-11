# Back-office (admin) API

The admin API the back-office UI uses. All paths are under `/v2/admin`. The public API for mobile and web apps is described separately in [integration-guide.md](integration-guide.md).

## Conventions

- **Auth:** `POST /v2/admin/auth/login` returns a bearer token. Send it as `Authorization: Bearer <token>` on every other call. Tokens expire after 8 hours of inactivity.
- **Roles:**
  - `VIEWER` can read everything except back-office users.
  - `REVIEWER` can do everything `VIEWER` can, plus review actions and cancelling a session.
  - `ADMIN` can do everything.
  - A call the role can't make gets `403 FORBIDDEN`.
- **JSON** uses camelCase. Dates are ISO-8601 in UTC (`2026-10-08T09:00:00Z`). Plain dates are `YYYY-MM-DD`.
- **Errors** look like this: `{ "code": "NOT_FOUND", "message": "Session not found" }`.
  - `401` means the token is missing or expired, so log in again.
  - `403` means the role isn't allowed.
  - `409` means the action conflicts with the current state.
  - `400` and `422` mean the input is invalid.
- **Paging:** `?page=0&size=20` (page is 0-based). The response is `Page<T> = { items: T[], page: number, size: number, total: number }`.
- **Unlimited:** a `quotaPerDay` of `null` means unlimited.

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/v2/admin/auth/login` | `{ username, password }` | `{ token, expiresAt, user: AdminUser }` |
| POST | `/v2/admin/auth/logout` | — | `204` |
| GET | `/v2/admin/auth/me` | — | `AdminUser` |
| POST | `/v2/admin/auth/change-password` | `{ currentPassword, newPassword }` | `204` |

```ts
AdminUser = { id: number, username: string, displayName: string, email: string | null,
  role: 'ADMIN' | 'REVIEWER' | 'VIEWER', status: 'ACTIVE' | 'DISABLED',
  mustChangePassword: boolean, lastLoginAt: string | null, createdAt: string }
```

The first `admin` user is created on first start. Its password comes from `CAMTECH_BACKOFFICE_ADMIN_PASSWORD`, or is generated and written to the log once. When `mustChangePassword` is `true`, the UI must make the user change their password before showing anything else.

## Dashboard

`GET /v2/admin/dashboard?days=14`
```ts
Dashboard = {
  days: number,
  totals: { sessions: number, approved: number, review: number, rejected: number,
            inProgress: number, expired: number, failed: number },
  approvalRate: number | null,          // 0..1, approved / completed
  avgDocMatchSimilarity: number | null, // FACE_DOC_MATCH, passed attempts
  pendingReviews: number,
  daily: { date: string, approved: number, review: number, rejected: number, other: number }[],
  topFailureReasons: { code: string, message: string, count: number }[],
  byFlow: { flowCode: string, count: number }[],
  byChannel: { channel: string, count: number }[],
  byClientApp: { clientAppCode: string, count: number }[],
  scans: number                         // document scans in the window
}
```

## Verification sessions

`GET /v2/admin/sessions?page&size&status&decision&flowCode&channel&clientAppCode&from&to&q`

`q` matches the session id, the subject reference, the document number or the person's name. `from` and `to` are dates.

```ts
SessionSummary = { publicId: string, flowCode: string,
  status: 'CREATED' | 'IN_PROGRESS' | 'COMPLETED' | 'EXPIRED' | 'FAILED' | 'CANCELLED',
  decision: 'APPROVED' | 'REVIEW' | 'REJECTED' | null,
  channel: 'MOBILE' | 'WEB' | 'ADMIN', clientAppCode: string,
  partyId: number | null, partyName: string | null, subjectRef: string | null,
  documentType: string | null, documentNumber: string | null,
  finalSimilarity: number | null,
  livenessAttempts: number, documentAttempts: number,
  createdAt: string, expiresAt: string, completedAt: string | null }
```

`GET /v2/admin/sessions/{publicId}` returns `SessionDetail`:
```ts
SessionDetail = Omit<SessionSummary, 'decision'> & {   // here `decision` is the Decision object
  device: { id: number, deviceRef: string, platform: string, osVersion: string | null,
            appVersion: string | null, model: string | null, attestationStatus: string } | null,
  ipAddress: string | null, userAgent: string | null,
  steps: Step[],                     // ordered by startedAt, every attempt is a row
  document: DocumentSummary | null,
  decision: Decision | null,
  reviewCase: ReviewCaseSummary | null,
  events: { eventType: string, status: string, createdAt: string }[]
}
Step = { id: number, stepCode: string, attemptNo: number,
  status: 'PENDING' | 'IN_PROGRESS' | 'PASSED' | 'FAILED' | 'REVIEW' | 'SKIPPED',
  reasonCode: string | null, reasonMessage: string | null,
  startedAt: string | null, endedAt: string | null,
  checks: Check[], media: MediaRef[] }
Check = { id: number, checkCode: string, score: number | null, thresholdUsed: string | null,
  outcome: 'PASS' | 'REVIEW' | 'FAIL' | 'SKIPPED', details: Record<string, unknown> | null }
MediaRef = { id: number, role: string, mimeType: string, byteCount: number,
  width: number | null, height: number | null, createdAt: string, purged: boolean }
Decision = { decision: 'APPROVED' | 'REVIEW' | 'REJECTED', decidedBy: 'SYSTEM' | 'USER',
  decidedByUser: string | null, reason: string | null, finalSimilarity: number | null, decidedAt: string }
```

`POST /v2/admin/sessions/{publicId}/cancel` (REVIEWER) returns `SessionDetail`. It only works on `CREATED` and `IN_PROGRESS` sessions, otherwise `409`.

Step codes are `LIVENESS`, `DOC_CAPTURE`, `DOC_VALIDATION`, `FACE_DOC_MATCH`, `FACE_TEMPLATE_MATCH`, `DEDUP_SEARCH`.
Media roles are `SELFIE_NORMAL`, `SELFIE_CLOSER`, `FRONT`, `BACK`, `PHOTO_PAGE`, `FACE_PHOTO`, `SIGNATURE`, `DOCUMENT`.

## Media

`GET /v2/admin/media/{id}` returns the image bytes with the right `Content-Type`. It needs the bearer header, so the UI fetches it as a blob and shows it with an object URL. A media file that has been purged returns `410 MEDIA_PURGED`.

## Review cases

```ts
ReviewCaseSummary = { id: number, sessionPublicId: string,
  status: 'OPEN' | 'IN_REVIEW' | 'APPROVED' | 'REJECTED',
  reason: string, finalSimilarity: number | null, assignedTo: string | null,
  partyName: string | null, documentType: string | null,
  createdAt: string, updatedAt: string }
ReviewCaseDetail = ReviewCaseSummary & { session: SessionDetail,
  actions: { id: number, action: 'OPENED' | 'ASSIGNED' | 'COMMENTED' | 'APPROVED' | 'REJECTED',
             actor: string, note: string | null, createdAt: string }[] }
```

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/review-cases?status&assignedTo&page&size` | — | `Page<ReviewCaseSummary>` |
| GET | `/v2/admin/review-cases/{id}` | — | `ReviewCaseDetail` |
| POST | `/v2/admin/review-cases/{id}/assign` | `{ assignee?: string }` (defaults to the caller) | `ReviewCaseDetail` |
| POST | `/v2/admin/review-cases/{id}/comment` | `{ note }` | `ReviewCaseDetail` |
| POST | `/v2/admin/review-cases/{id}/decide` | `{ decision: 'APPROVED' \| 'REJECTED', note }` | `ReviewCaseDetail` |

A decision is final: the session decision becomes `decidedBy = USER`, and a `REVIEW_DECIDED` event is sent. The queue holds the cases camtech decides: the default tenant's, and those of tenants whose `review.owner` is `CAMTECH` (each case has `tenantId`). Cases of tenants that review their own are decided in the tenant portal. Deciding a case that is already closed returns `409`.

## People (parties)

```ts
PartySummary = { id: number, publicId: string, partyType: 'PERSON' | 'ORG',
  externalRef: string | null, status: string, displayName: string | null,
  nationality: string | null, dateOfBirth: string | null,
  documentsCount: number, sessionsCount: number, lastVerifiedAt: string | null, createdAt: string }
PartyDetail = PartySummary & {
  person: { fullNameEn: string | null, fullNameAr: string | null, dateOfBirth: string | null,
            gender: string | null, nationality: string | null } | null,
  organization: { legalNameEn: string | null, legalNameAr: string | null,
                  legalForm: string | null, issuerCode: string | null } | null,
  documents: DocumentSummary[],
  faceTemplates: { id: number, role: 'SELFIE' | 'DOCUMENT', modelVersion: string, dimension: number,
                   qualityScore: number | null, status: 'SESSION' | 'ENROLLED' | 'REVOKED',
                   sourceMediaId: number | null, createdAt: string }[],
  sessions: SessionSummary[],
  relations: { relationType: string, otherPartyId: number, otherPartyName: string | null,
               sharePct: number | null }[] }
```

| Method | Path | Response |
|---|---|---|
| GET | `/v2/admin/parties?q&partyType&page&size` | `Page<PartySummary>` |
| GET | `/v2/admin/parties/{id}` | `PartyDetail` |
| DELETE | `/v2/admin/parties/{id}` (ADMIN) | `204`. Erases the person, their documents, media, face templates and sessions. An audit event is kept. |
| POST | `/v2/admin/parties/{id}/face-templates/{templateId}/revoke` (ADMIN) | `204` |

## Documents and scans

```ts
DocumentSummary = { id: number, partyId: number | null, partyName: string | null,
  docTypeCode: 'EMIRATES_ID' | 'PASSPORT' | 'TRADE_LICENCE' | string,
  issuerCode: string | null, documentNumber: string | null, issuingCountry: string | null,
  issueDate: string | null, expiryDate: string | null,
  status: 'CAPTURED' | 'VERIFIED' | 'EXPIRED' | 'REJECTED', createdAt: string }
DocumentDetail = DocumentSummary & {
  fields: { fieldCode: string, lang: string | null, value: string | null,
            source: 'CLIENT_OCR' | 'SERVER_OCR' | 'MRZ' | 'MANUAL', confidence: number | null,
            groupCode: string | null, groupIdx: number | null }[],
  media: MediaRef[], scans: ScanSummary[] }
ScanSummary = { id: number, publicId: string, documentId: number | null, docTypeCode: string,
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED', confidence: number | null,
  processingMs: number | null, errorMessage: string | null, ocrProvider: string | null, createdAt: string }
ScanDetail = ScanSummary & {
  fields: { fieldCode: string, lang: string | null, rawValue: string | null,
            confidence: number | null, validationStatus: string | null }[],
  media: MediaRef[], rawText: string | null }
```

| Method | Path | Response |
|---|---|---|
| GET | `/v2/admin/documents?q&docTypeCode&status&expiringBefore&page&size` | `Page<DocumentSummary>` |
| GET | `/v2/admin/documents/{id}` | `DocumentDetail` |
| GET | `/v2/admin/document-scans?status&docTypeCode&page&size` | `Page<ScanSummary>` |
| GET | `/v2/admin/document-scans/{id}` | `ScanDetail` |

## Configuration

### Tenant and entitlements
```ts
Tenant = { id: number, code: string, name: string, status: string, createdAt: string }
Entitlement = { id: number, featureType: 'FLOW' | 'DOCUMENT' | 'FEATURE', featureCode: string,
  enabled: boolean, quotaPerDay: number | null, usedToday: number, validUntil: string | null }
```
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/tenant` | — | `Tenant` |
| GET | `/v2/admin/entitlements` | — | `Entitlement[]` |
| PUT | `/v2/admin/entitlements/{id}` (ADMIN) | `{ enabled, quotaPerDay: number \| null, validUntil: string \| null }` | `Entitlement` |

These are the default tenant's. Any tenant's plan is under `/v2/admin/tenants/{id}/entitlements` (below).

### Tenants (ADMIN)
Each camtech serves several tenants (companies). Their users integrate from the tenant portal ([tenant-api.md](tenant-api.md)). A new tenant starts as a copy of a template tenant (the default tenant unless `templateCode` is sent): entitlements, settings, retention policies and liveness limits (the starting values for a flow the template has none for), plus a `MOBILE_APP` and a `WEB_APP` client app.
```ts
TenantSummary = { id: number, code: string, name: string, status: 'ACTIVE' | 'SUSPENDED', isDefault: boolean, createdAt: string }
```
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/tenants` | — | `TenantSummary[]` |
| POST | `/v2/admin/tenants` | `{ code, name, templateCode?, owner?: { username, displayName?, email?, password? } }` (code: 2-30 of `A-Z 0-9 _`) | `201 TenantSummary & { owner: { user, password } \| null }`: the first portal OWNER; a blank password is generated and returned once. `409 CODE_TAKEN`, `409 USERNAME_TAKEN` |
| GET | `/v2/admin/tenants/{id}/users` | — | `TenantUser[]`: the tenant's portal users |
| POST | `/v2/admin/tenants/{id}/users` (ADMIN) | `{ username, displayName?, email?, role, password? }` | `201 { user, password }` |
| PUT | `/v2/admin/tenants/{id}/users/{userId}` (ADMIN) | `{ displayName?, email?, role?, status? }` | `TenantUser`. `409 LAST_OWNER` |
| POST | `/v2/admin/tenants/{id}/users/{userId}/reset-password` (ADMIN) | `{ password? }` | `{ password }`, to share with the user; they must change it at sign-in |
| PUT | `/v2/admin/tenants/{id}` | `{ name?, status?: 'ACTIVE' \| 'SUSPENDED' }` | `TenantSummary`. The default tenant cannot be suspended (`409 DEFAULT_TENANT`). A suspended tenant's portal and apps stop working. |
| GET | `/v2/admin/tenants/{id}/entitlements` | — | `Entitlement[]`: the tenant's plan |
| PUT | `/v2/admin/tenants/{id}/entitlements/{entitlementId}` (ADMIN) | as `/v2/admin/entitlements/{id}` | `Entitlement`. `404` for another tenant's entitlement |
| GET | `/v2/admin/tenants/{id}/config-params` | — | `ConfigParam[]`: the tenant's settings |
| POST / PUT / DELETE | `/v2/admin/tenants/{id}/config-params[/{paramId}]` (ADMIN) | as `/v2/admin/config-params` | as `/v2/admin/config-params` |
| GET | `/v2/admin/tenants/{id}/client-apps` | — | `ClientApp[]`, to scope a setting to one of them |

The per-tenant routes run the same checks and audit entries as the default tenant's routes; the audit entry lands in that tenant's log.

### Liveness limits per flow
The back-office sets the limits for each tenant and liveness flow (`SELFIE_ID_VERIFICATION`, `FACE_AUTHENTICATION`, `LIVENESS_CHECK`, `FACE_ENROLLMENT`); the tenant picks its settings inside them in the portal ([tenant-api.md](tenant-api.md#liveness-settings-per-flow)). Starting values: `allowedModes ['ACTIVE']`, `allowedActions` = all seven challenges, `minActions 2`, `maxActions 4`, `requireSpareAction true`. Selfie ID verification and face registration (the flows that register a face) are always ACTIVE.
```ts
LivenessPolicy = { allowedModes: ('PASSIVE' | 'ACTIVE')[], allowedActions: ChallengeAction[],   // TURN_LEFT, TURN_RIGHT, BLINK, LOOK_UP, LOOK_DOWN, SMILE, MOVE_CLOSER
  minActions: number, maxActions: number, requireSpareAction: boolean }   // 1 <= min <= max <= 7
LivenessSettings = { mode: 'PASSIVE' | 'ACTIVE', actions: ChallengeAction[], challengeCount: number }
AdminFlowLiveness = { tenantId: number, flowCode: string, flowName: string, policy: LivenessPolicy,
  settings: LivenessSettings,      // what sessions run with now
  customized: boolean,             // the tenant has saved settings
  updatedAt: string | null }       // when the tenant last saved them
```
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/tenants/{tenantId}/liveness-policies` | — | `AdminFlowLiveness[]` (both flows) |
| GET | `/v2/admin/tenants/{tenantId}/flows/{flowCode}/liveness-policy` | — | `AdminFlowLiveness` |
| PUT | `/v2/admin/tenants/{tenantId}/flows/{flowCode}/liveness-policy` (ADMIN) | `LivenessPolicy & { resetTenant?: boolean }` | `AdminFlowLiveness`. `400 MODE_NOT_ALLOWED` (no mode, or PASSIVE for selfie ID verification), `400 VALIDATION_ERROR` (unknown or repeated values, bad range, fewer `allowedActions` than `minActions` (+1 with `requireSpareAction`)), `409 TENANT_SETTINGS_CONFLICT` (the tenant's saved settings would break the new limits; `reason` = the rule). `resetTenant: true` deletes the tenant's settings for the flow, so the defaults apply. Audited as `LIVENESS_POLICY_UPDATED`. |

A tenant that has saved nothing gets: mode ACTIVE (PASSIVE only when the policy allows only PASSIVE), every allowed action, `challengeCount = minActions`.

### Client apps, permissions and credentials
```ts
ClientApp = { id: number, code: string, name: string, channel: 'MOBILE' | 'WEB' | 'ADMIN',
  platform: string | null, appIdentifier: string | null, allowedOrigins: string[],
  status: 'ACTIVE' | 'DISABLED', permissions: { featureCode: string, allowed: boolean }[],
  credentialsCount: number, createdAt: string }
Credential = { id: number, keyId: string, status: 'ACTIVE' | 'REVOKED',
  createdAt: string, expiresAt: string | null, lastUsedAt: string | null }
```
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/client-apps` | — | `ClientApp[]` |
| POST | `/v2/admin/client-apps` (ADMIN) | `{ code, name, channel, platform, appIdentifier, allowedOrigins }` | `ClientApp` |
| PUT | `/v2/admin/client-apps/{id}` (ADMIN) | `{ name, platform, appIdentifier, allowedOrigins, status }` | `ClientApp` |
| PUT | `/v2/admin/client-apps/{id}/permissions` (ADMIN) | `[{ featureCode, allowed }]` | `ClientApp` |
| GET | `/v2/admin/client-apps/{id}/credentials` | — | `Credential[]` |
| POST | `/v2/admin/client-apps/{id}/credentials` (ADMIN) | `{ expiresAt: string \| null }` | `{ credential: Credential, secret: string }` (the secret is shown only this once) |
| POST | `/v2/admin/credentials/{id}/revoke` (ADMIN) | — | `Credential` |
| GET | `/v2/admin/client-apps/{id}/capabilities` | — | `Capabilities`: what this app would get from `GET /v2/capabilities` |

`Capabilities` has the same shape as the public `GET /v2/capabilities` response (see integration-guide.md).

### Settings (config params)
```ts
ConfigParam = { id: number, flowCode: string | null, channel: string | null,
  clientAppCode: string | null, paramKey: string, paramValue: string,
  description: string | null, updatedAt: string, updatedBy: string | null }
ConfigKey = { key: string, description: string,
  type: 'NUMBER' | 'INTEGER' | 'BOOLEAN' | 'STRING' | 'LIST',
  defaultValue: string, min: number | null, max: number | null }
```
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/config-keys` | — | `ConfigKey[]` (the catalogue of known keys) |
| GET | `/v2/admin/config-params` | — | `ConfigParam[]` |
| POST | `/v2/admin/config-params` (ADMIN) | `{ flowCode, channel, clientAppCode, paramKey, paramValue }` | `ConfigParam`. `409 ALREADY_EXISTS` if that scope already has a value. |
| PUT | `/v2/admin/config-params/{id}` (ADMIN) | `{ paramValue }` | `ConfigParam` |
| DELETE | `/v2/admin/config-params/{id}` (ADMIN) | — | `204`. A global default (all scopes null) can't be deleted: `409`. |

The value is resolved from the most specific scope: global, then flow, then channel, then client app.

Liveness keys: `liveness.mode`, `liveness.challenge_actions` and `liveness.challenge_steps` are the tenant's own settings (flow-scoped rows written by the portal); they cannot be created here (`400`). Back-office only: `liveness.allow_without_challenge` (default false; true for `MOBILE` after the 1.2.0 migration, so released apps without challenges keep working, with the passive check required), `liveness.look_min_pitch` (15°), `liveness.smile_min_gain` (1.10), `liveness.max_faceless_frames` (1), `liveness.eyes_open_min` (0.24), `liveness.eyes_closed_max` (0.21). `liveness.active_required` no longer exists.

### Flows, document types, issuers, reason codes
```ts
// Flow definitions are shared by every tenant. enabled: in this tenant's plan; enabledTenants: in how many plans.
Flow = { code: string, name: string, description: string | null, enabled: boolean, enabledTenants: number,
  steps: { id: number, seq: number, stepCode: string, mandatory: boolean, maxAttempts: number,
    maxAttemptsUsed: boolean,      // false: the step runs once per session, maxAttempts has no effect
    tenantSwitch: string | null }[] }  // e.g. 'dedup.enabled' for DEDUP_SEARCH; null = the step always runs
// mandatory is kept for older clients and is not enforced.
DocumentType = { id: number, code: string, name: string, sides: number,
  hasMrz: boolean, hasFacePhoto: boolean, enabled: boolean }
Issuer = { id: number, code: string, docTypeCode: string, countryCode: string,
  emirate: string | null, nameEn: string, nameAr: string | null }
ReasonCode = { code: string, category: 'LIVENESS' | 'DOCUMENT' | 'MATCH' | 'SESSION' | 'ACCESS' | 'SYSTEM',
  httpStatus: number, messageEn: string, messageAr: string | null }
```
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/flows` | — | `Flow[]` |
| PUT | `/v2/admin/flows/{code}/steps/{stepId}` (ADMIN) | `{ maxAttempts }` (1-20; `mandatory` is still accepted) | `Flow`. Applies to all tenants. |
| GET | `/v2/admin/document-types` | — | `DocumentType[]` |
| GET | `/v2/admin/issuers` | — | `Issuer[]` |
| GET | `/v2/admin/reason-codes` | — | `ReasonCode[]` |
| PUT | `/v2/admin/reason-codes/{code}` (ADMIN) | `{ messageEn, messageAr }` | `ReasonCode` |

### Webhooks
```ts
Webhook = { id: number, url: string, events: string[], status: 'ACTIVE' | 'DISABLED',
  createdAt: string, lastDeliveryAt: string | null, lastStatus: string | null }
WebhookDelivery = { id: number, webhookId: number, eventType: string, eventId: number,
  attempt: number, httpStatus: number | null,
  status: 'PENDING' | 'DELIVERED' | 'RETRYING' | 'FAILED',
  error: string | null, nextRetryAt: string | null, createdAt: string }
```
The events are `SESSION_COMPLETED`, `SESSION_EXPIRED`, `REVIEW_OPENED`, `REVIEW_DECIDED`, `SCAN_REVIEW_REQUIRED`, `SCAN_REVIEW_DECIDED`, `DOCUMENT_EXPIRING` and `PARTY_ERASED`. Each webhook shows `consecutiveFailures` and `failing` (the last 5 deliveries failed). A test delivery has event type `WEBHOOK_TEST` and cannot be retried.

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/webhooks` | — | `Webhook[]` |
| POST | `/v2/admin/webhooks` (ADMIN) | `{ url, events }` | `{ webhook: Webhook, secret: string }` |
| PUT | `/v2/admin/webhooks/{id}` (ADMIN) | `{ url, events, status }` | `Webhook` |
| DELETE | `/v2/admin/webhooks/{id}` (ADMIN) | — | `204` |
| POST | `/v2/admin/webhooks/{id}/rotate-secret` (ADMIN) | — | `{ webhook: Webhook, secret: string }` |
| POST | `/v2/admin/webhooks/{id}/test` (ADMIN) | — | `WebhookDelivery` |
| GET | `/v2/admin/webhooks/{id}/deliveries?page&size` | — | `Page<WebhookDelivery>` |
| POST | `/v2/admin/webhook-deliveries/{id}/retry` (ADMIN) | — | `WebhookDelivery` |

### Data retention
```ts
RetentionPolicy = { id: number,
  dataCategory: 'FAILED_ATTEMPT_MEDIA' | 'VERIFIED_MEDIA' | 'SCAN_ONLY_MEDIA' | 'AUDIT_EVENTS',
  retentionDays: number, description: string, updatedAt: string }
```
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/retention-policies` | — | `RetentionPolicy[]` |
| PUT | `/v2/admin/retention-policies/{id}` (ADMIN) | `{ retentionDays }` | `RetentionPolicy` |

## Audit log

`GET /v2/admin/audit-events?actor&action&entity&from&to&page&size` returns `Page<AuditEvent>`:
```ts
AuditEvent = { id: number, actorType: 'CLIENT' | 'ADMIN' | 'SYSTEM', actor: string,
  action: string, entity: string | null, entityId: string | null,
  ipAddress: string | null, details: Record<string, unknown> | null, at: string }
```

## Back-office users (ADMIN)

| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/v2/admin/users` | — | `AdminUser[]` |
| POST | `/v2/admin/users` | `{ username, displayName, email, role }` | `{ user: AdminUser, temporaryPassword: string }` |
| PUT | `/v2/admin/users/{id}` | `{ displayName, email, role, status }` | `AdminUser` |
| POST | `/v2/admin/users/{id}/reset-password` | — | `{ temporaryPassword: string }` |

A temporary password sets `mustChangePassword = true`. Passwords need at least 10 characters with letters and numbers. Five wrong passwords lock the account for 15 minutes (`423 ACCOUNT_LOCKED`).

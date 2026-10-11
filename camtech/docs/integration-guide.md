# camtech integration guide (mobile and web)

This guide is for developers of the **mobile apps (iOS / Android)** and the **web app** that verify people with camtech. It covers:

1. [What changed](#1-what-changed)
2. [The verification flow](#2-the-verification-flow)
3. [Basics: base URL, headers, errors](#3-basics)
4. [API reference with requests and responses](#4-api-reference)
5. [Errors and what the app should do](#5-errors-and-what-the-app-should-do)
6. [Trusting the result on your backend](#6-trusting-the-result-on-your-backend)
7. [Webhooks](#7-webhooks)
8. [Moving from /face-tech to /v2](#8-moving-from-face-tech-to-v2)
9. [Capture tips](#9-capture-tips)
10. [Legacy endpoints](#10-legacy-endpoints-still-available)
11. [Web SDK](#11-web-sdk)

---

## 1. What changed

| Area | Before | Now |
|---|---|---|
| Flow name | "Face Tech" | **Selfie ID verification** (`SELFIE_ID_VERIFICATION`): liveness, then the Emirates ID or passport, then **face-to-document match** (`FACE_DOC_MATCH`) |
| API | `/face-tech/sessions/**`, snake_case, scores returned to the app | **`/v2/selfie-verifications/**`**, camelCase, every response says what to do next (`nextStep`), no scores sent to the app |
| What is saved | Only the last state of the session; failed attempts, earlier images and scores were overwritten | **Every attempt, image, check, score and decision** is stored. The back-office shows the full history. |
| Images | On the pod disk | Always **OCI Object Storage**, bucket folder `camtech/` with one sub-folder per case (see below). Nothing is stored on the pod. |
| Result | Read by the app from the response | **Signed result token** (JWT, RS256) that your backend verifies, plus an optional **webhook** |
| Settings | Thresholds and attempt limits in `application.yml` | Managed in the **back-office** per flow, channel (mobile / web) or app. The app reads its limits from `GET /v2/capabilities`. |
| What an app may do | Everything was open | **Entitlements** (tenant) and **permissions** (per app). For NOQODI everything is enabled and there is no daily limit. |
| Returning users | Not supported | **Face authentication** (`POST /v2/face-authentications`) against the registered face |
| Selfie only | Not supported | **Liveness check** (`LIVENESS_CHECK`, `POST /v2/liveness-checks`) and **face registration** (`FACE_ENROLLMENT`, `POST /v2/face-enrollments`), no document |
| Messages | English only, hard-coded | **English and Arabic** for every reason code (`Accept-Language: ar`), editable in the back-office |
| Manual review | None | Borderline matches go to a **review queue** in the back-office, and the final decision is sent by webhook |
| Database | `ddl-auto: update` | **Liquibase** (`db/changelog`), Oracle in every environment |

### Products and flows
| Product | Flow / call |
|---|---|
| Trade licence, Emirates ID or passport scan | `DOCUMENT_SCAN`: `POST /v2/documents/scan` ([4.11](#411-server-side-ocr-optional)) |
| Liveness check (selfie only) | `LIVENESS_CHECK`: `POST /v2/liveness-checks` ([4.15](#415-post-v2liveness-checks-liveness-check-selfie-only)) |
| Selfie verification with Emirates ID or passport | `SELFIE_ID_VERIFICATION` with `"enrollFace": false` ([4.2](#42-post-v2selfie-verifications-start-a-verification)) |
| Face registration (selfie only) | `FACE_ENROLLMENT`: `POST /v2/face-enrollments` ([4.16](#416-post-v2face-enrollments-face-registration-selfie-only)) |
| Face registration with Emirates ID or passport | `SELFIE_ID_VERIFICATION` with `"enrollFace": true` |
| Face login for a registered user | `FACE_AUTHENTICATION`: `POST /v2/face-authentications` ([4.8](#48-post-v2face-authentications-returning-user-face-login--step-up)) |

The `FACE_ENROLLMENT` entitlement is what lets a tenant (and each of its apps) register faces, alone or as part of an ID
verification. Every flow has its own entitlement, permission and daily quota; an ID verification that registers the face
counts one `SELFIE_ID_VERIFICATION` and one `FACE_ENROLLMENT`.

**Nothing breaks.** The old `/face-tech/sessions/**`, `/onboarding/**`, `/face/**`, `/user/**` and `/api/v1/documents/**` endpoints keep their exact requests and responses. They now store their data in the new model too. Move to `/v2` when convenient (see [section 8](#8-moving-from-face-tech-to-v2)).

### Where images are stored
```
<bucket>/camtech/
  selfie-verifications/2026/10/08/<sessionId>/liveness/attempt-1-normal.jpg
  selfie-verifications/2026/10/08/<sessionId>/liveness/attempt-1-closer.jpg
  selfie-verifications/2026/10/08/<sessionId>/document/attempt-1-front.jpg
  face-authentications/2026/10/08/<sessionId>/liveness/attempt-1-normal.jpg
  document-scans/2026/10/08/<scanId>/document.jpg
  onboarding/<personId>/face/front-3f2a9c1e.jpg
  onboarding/<personId>/emirates-id/front-3f2a9c1e.jpg
  onboarding/<personId>/passport/photo-page-3f2a9c1e.jpg
```

---

## 2. The verification flow

```
App                                   camtech
 │ 1. GET  /v2/capabilities  ───────────► what this app may use + limits (cache with ETag)
 │ 2. POST /v2/selfie-verifications ────► sessionId + sessionToken, nextStep = LIVENESS
 │ 3. capture the normal selfie (+ the challenge in ACTIVE mode)
 │    POST /{id}/liveness ──────────────► PASSED → nextStep = DOCUMENT
 │                                        FAILED → reason (TOO_DARK…), attemptsRemaining, nextStep = LIVENESS
 │ 4. capture Emirates ID front / passport photo page (+ number, expiry, MRZ read on the device)
 │    POST /{id}/document ──────────────► MATCH    → decision APPROVED, nextStep = DONE
 │                                        REVIEW / NO_MATCH with attempts left → nextStep = DOCUMENT (rescan)
 │                                        last attempt → decision REVIEW (manual review) or REJECTED
 │ 5. GET  /{id}/result ────────────────► decision + resultToken → send the token to your backend
 │                                        (your backend can also receive a webhook)
```

**Statuses**

| Session `status` | Meaning |
|---|---|
| `CREATED` | Started, nothing uploaded yet |
| `IN_PROGRESS` | At least one upload done |
| `COMPLETED` | A decision exists (`APPROVED`, `REVIEW` or `REJECTED`) |
| `FAILED` | Liveness attempts used up, no decision |
| `EXPIRED` | Not finished within the time limit (15 minutes by default) |
| `CANCELLED` | Cancelled by the app or the back-office |

| `decision` | What the app shows |
|---|---|
| `APPROVED` | Verified |
| `REVIEW` | "We are checking your verification. You will be notified." The final result comes later by webhook (`REVIEW_DECIDED`) or from `GET /{id}/result`. |
| `REJECTED` | Not verified. The user can start a new verification. |

---

## 3. Basics

| | |
|---|---|
| Base URL | `https://<host>/camtech-service`. Only the host changes between environments, e.g. `http://localhost:8080/camtech-service` locally and `https://dev.noqodi.com/camtech-service` on dev. All paths below are relative to it. |
| Formats | JSON responses. Uploads are `multipart/form-data`. Dates are ISO-8601 UTC (`2026-10-08T09:15:00Z`). |
| Max upload | 10 MB per image, 25 MB per request |
| Language | `Accept-Language: ar` returns Arabic messages, anything else returns English |

### Headers

| Header | When | Notes |
|---|---|---|
| `X-Client-Id`, `X-Client-Secret` | Server-side calls | Your app's credentials, created in the tenant portal (**Apps & API keys**) or the back-office. **Optional for now**: without them, calls run as `MOBILE_APP`. They will become required, so add them now. **Never put the secret in a browser or app build**: browsers use an SDK token (next row). |
| `X-Sdk-Token` | Browser and app calls | A short-lived token your **backend** gets from `POST /v2/sdk-tokens` with its credentials ([section 4.12](#412-post-v2sdk-tokens-a-token-for-the-browser)). It allows only the end-user flows of that app, optionally for one user. The web SDK sends it for you. |
| `Authorization: Bearer <sessionToken>` | Every call on one verification | Returned when the verification starts. Optional for now, required later. Keep it in memory only. On its own (without credentials or an SDK token) it is enough to continue that verification, so your backend can start a verification and hand only `sessionId` + `sessionToken` to the browser. |
| `X-Device-Id` | Recommended | A stable, app-generated id per install (not the IMEI) |
| `X-Platform` | Recommended | `IOS`, `ANDROID` or `WEB` |
| `X-OS-Version`, `X-App-Version`, `X-Device-Model` | Recommended | Shown in the back-office to help investigate problems |
| `Accept-Language` | Optional | `ar` or `en` |

### Error body (all /v2 endpoints)
```json
{
  "code": "TOO_DARK",
  "message": "It is too dark. Move to a brighter place and try again.",
  "step": "LIVENESS",
  "attemptsRemaining": 4,
  "nextStep": "LIVENESS"
}
```
`code` is stable: drive the app's logic from it. `message` is ready to show to the user, in the requested language. `step`, `attemptsRemaining` and `nextStep` appear when they apply.

---

## 4. API reference

### 4.1 `GET /v2/capabilities`: what this app may use
Call it at start-up and build your screens from it. For example, hide the passport option if `PASSPORT` is missing. Send `If-None-Match: <ETag>` to get `304` when nothing changed.

**Response 200** (`ETag: "a1b2c3d4e5f60718"`)
```json
{
  "tenant": "NOQODI",
  "clientApp": "MOBILE_APP",
  "channel": "MOBILE",
  "flows": [
    {
      "code": "SELFIE_ID_VERIFICATION",
      "documents": ["EMIRATES_ID", "PASSPORT"],
      "steps": ["LIVENESS", "DOC_CAPTURE", "DOC_VALIDATION", "FACE_DOC_MATCH", "DEDUP_SEARCH"],
      "settings": {
        "livenessMaxAttempts": 5,
        "documentMaxAttempts": 3,
        "sessionTtlMinutes": 15,
        "deviceAntispoofRequired": false,
        "fileUploadAllowed": true,
        "livenessChallengeRequired": false,
        "livenessMode": "ACTIVE",
        "challengeActions": ["TURN_LEFT", "TURN_RIGHT", "BLINK"],
        "challengeCount": 2
      },
      "quota": { "perDay": null, "remainingToday": null }
    },
    {
      "code": "FACE_AUTHENTICATION",
      "documents": [],
      "steps": ["LIVENESS", "FACE_TEMPLATE_MATCH"],
      "settings": { "livenessMaxAttempts": 1, "documentMaxAttempts": 1, "sessionTtlMinutes": 15,
                    "deviceAntispoofRequired": false, "fileUploadAllowed": true },
      "quota": { "perDay": null, "remainingToday": null }
    }
  ],
  "features": ["DEDUP_SEARCH", "FACE_COMPARE", "MANUAL_REVIEW", "SERVER_OCR", "WEBHOOKS"],
  "locales": ["en", "ar"]
}
```
`quota.perDay: null` means unlimited. Thresholds are never included. `DEDUP_SEARCH` is listed in `steps` only when duplicate identity search runs for this app (in the plan, allowed for the app, and turned on by the tenant).

Liveness flows (`SELFIE_ID_VERIFICATION`, `FACE_AUTHENTICATION`, `LIVENESS_CHECK`, `FACE_ENROLLMENT`) also carry the tenant's liveness settings: `livenessMode` (`ACTIVE` = a challenge is done, `PASSIVE` = no challenge, only the anti-spoof model), `challengeActions` (what a challenge is drawn from) and `challengeCount`. `FACE_AUTHENTICATION` and `LIVENESS_CHECK` are `PASSIVE` by default (the tenant can pick `ACTIVE`); `SELFIE_ID_VERIFICATION` and `FACE_ENROLLMENT` are always `ACTIVE`. `livenessChallengeRequired` is `livenessMode == ACTIVE` unless this app may still upload without a challenge (released mobile apps); it is `false` for other flows.

---

### 4.2 `POST /v2/selfie-verifications`: start a verification
**Request** (`Content-Type: application/json`, body optional)
```json
{
  "subjectRef": "usr_8812",
  "documentType": "EMIRATES_ID",
  "enrollFace": true
}
```
| Field | Required | Meaning |
|---|---|---|
| `subjectRef` | Recommended | **Your** id for this user. camtech links all their verifications to it and uses it for face authentication later. |
| `documentType` | No | `EMIRATES_ID` or `PASSPORT`, if already known (it can also be sent at the document step) |
| `enrollFace` | No | `true`: register the face when the verification is approved (needs `FACE_ENROLLMENT`, else `403`). `false`: verify only, nothing is registered. Omitted: registered when the app may register faces (`settings.faceEnrollmentAvailable` in capabilities), as before. A face that goes to review is registered only if the reviewer approves. |

**Response 201**
```json
{
  "sessionId": "3b6e1c0a-58d2-4f0e-9c1b-7a4e2c9d9f2d",
  "sessionToken": "q9V2c0b1yF0pQ7xT3mL8sWk4nR6eH1aZ5uJ2dC7gB0o",
  "flow": "SELFIE_ID_VERIFICATION",
  "status": "CREATED",
  "expiresAt": "2026-10-08T09:15:00Z",
  "nextStep": "LIVENESS",
  "enrollFace": true
}
```
**Errors:** `403 FEATURE_NOT_ENABLED` / `FEATURE_NOT_ALLOWED` (also for `FACE_ENROLLMENT` with `enrollFace: true`), `429 QUOTA_EXCEEDED`, `401 CLIENT_AUTH_INVALID`.

---

### 4.3 `POST /v2/selfie-verifications/{sessionId}/liveness`: the two selfies
Take the **normal** selfie first (face inside the oval). In ACTIVE mode the user then does the challenge; moving closer is one of its actions (`MOVE_CLOSER`). The separate **closer** selfie is optional: released apps that still send it keep today's checks on it (quality, same person, face at least 10% larger); without it those three checks are recorded as skipped (or covered by `MOVE_CLOSER`).

**Request** (`multipart/form-data`)
| Field | Required | Meaning |
|---|---|---|
| `normal` | Yes | JPEG/PNG, the normal selfie |
| `closer` | No | JPEG/PNG, the closer selfie (older clients) |
| `deviceAntispoofScore` | No (unless `deviceAntispoofRequired`) | 0–1 score from the on-device anti-spoof model |
| `challengeId` | When `livenessMode` is `ACTIVE` (required when `livenessChallengeRequired`; never in PASSIVE mode) | The active-liveness challenge from [4.14](#414-post-v2liveness-challenges-active-liveness), done just before these selfies |
| `challengeFrames` | With `challengeId` | Up to 16 JPEG frames, under 1 MB each, recorded while the user did the challenge, in capture order and unmirrored |

```bash
curl -X POST https://<host>/camtech-service/v2/selfie-verifications/3b6e1c0a-…/liveness \
  -H "Authorization: Bearer <sessionToken>" -H "X-Client-Id: ck_…" -H "X-Client-Secret: …" \
  -F normal=@normal.jpg -F closer=@closer.jpg -F deviceAntispoofScore=0.97
```

**Response 200: passed**
```json
{
  "sessionId": "3b6e1c0a-58d2-4f0e-9c1b-7a4e2c9d9f2d",
  "step": "LIVENESS",
  "result": "PASSED",
  "status": "IN_PROGRESS",
  "attemptsRemaining": 4,
  "nextStep": "DOCUMENT"
}
```
**Response 422: try again** (the body tells the user what to fix)
```json
{
  "code": "TOO_DARK",
  "message": "It is too dark. Move to a brighter place and try again.",
  "step": "LIVENESS",
  "attemptsRemaining": 3,
  "nextStep": "LIVENESS"
}
```
Liveness codes: `TOO_DARK`, `TOO_BRIGHT`, `BLURRY`, `FACE_TOO_SMALL`, `MULTIPLE_FACES`, `HEAD_TURNED`, `HEAD_TILTED`, `NO_FACE`, `FACE_CHANGED` (different person in the two selfies or the challenge frames), `NOT_CLOSER`, `SPOOF_SUSPECTED` (the passive model sees a photo, a screen or a mask), `CHALLENGE_FAILED` (the requested actions were not seen), `FACE_NOT_VISIBLE` (more than one challenge frame without a face).

Challenge problems that do **not** use up an attempt: `400 CHALLENGE_REQUIRED`, `409 CHALLENGE_INVALID` (already used, or for another verification) and `409 CHALLENGE_EXPIRED`. Ask for a new challenge and redo it.

When `attemptsRemaining` is `0` (`nextStep: "DONE"`), the verification is over. Start a new one.

---

### 4.4 `POST /v2/selfie-verifications/{sessionId}/document`: the identity document and face match
**Request** (`multipart/form-data`)
| Field | Required | Meaning |
|---|---|---|
| `documentType` | Yes | `EMIRATES_ID` or `PASSPORT` |
| `document` | Yes | Emirates ID **front**, or passport **photo page** |
| `documentNumber` | Recommended | Read on the device. For an Emirates ID, the 15-digit number (dashes allowed): its checksum is verified. |
| `expiryDate` | Recommended | `YYYY-MM-DD` or `DD/MM/YYYY`. An expired document is refused. |
| `mrzLine2` | Passport, recommended | Second MRZ line: its check digits are verified |
| `fullName`, `dateOfBirth` | Optional | Saved on the person's record |
| `issuingCountry` | Passport, optional | ISO-3166 alpha-3 (`EGY`, `IND`…) |

```bash
curl -X POST https://<host>/camtech-service/v2/selfie-verifications/3b6e1c0a-…/document \
  -H "Authorization: Bearer <sessionToken>" \
  -F documentType=EMIRATES_ID -F document=@eid-front.jpg \
  -F documentNumber=784-1990-1234567-1 -F expiryDate=2027-05-01
```

**Response 200: match**
```json
{
  "sessionId": "3b6e1c0a-58d2-4f0e-9c1b-7a4e2c9d9f2d",
  "step": "DOCUMENT",
  "result": "MATCH",
  "status": "COMPLETED",
  "decision": "APPROVED",
  "attemptsRemaining": 0,
  "nextStep": "DONE",
  "reasonCode": null,
  "message": "Your face matches your Emirates ID."
}
```
**Response 200: borderline, rescan** (attempts left)
```json
{
  "sessionId": "3b6e1c0a-58d2-4f0e-9c1b-7a4e2c9d9f2d",
  "step": "DOCUMENT",
  "result": "REVIEW",
  "status": "IN_PROGRESS",
  "decision": null,
  "attemptsRemaining": 2,
  "nextStep": "DOCUMENT",
  "reasonCode": "LOW_CONFIDENCE",
  "message": "We could not confirm the match with enough confidence. Rescan the Emirates ID in good light, without glare, or start again without glasses."
}
```
**Response 200: last attempt borderline, sent to manual review**
```json
{
  "sessionId": "3b6e1c0a-…",
  "step": "DOCUMENT",
  "result": "REVIEW",
  "status": "COMPLETED",
  "decision": "REVIEW",
  "attemptsRemaining": 0,
  "nextStep": "DONE",
  "reasonCode": "LOW_CONFIDENCE",
  "message": "We could not confirm the match with enough confidence. …"
}
```
`result` is one of:
- `MATCH`
- `REVIEW`: borderline, or a match flagged for review with `reasonCode` `DUPLICATE_IDENTITY` (the face belongs to another enrolled person) or `DOCUMENT_OWNER_MISMATCH` (the document is on file for someone else)
- `NO_MATCH`: `reasonCode` `FACE_MISMATCH`

**Response 422: document problem** (attempts left → rescan)
```json
{
  "code": "ID_EXPIRED",
  "message": "This Emirates ID has expired. Please use a valid document.",
  "step": "DOCUMENT",
  "attemptsRemaining": 2,
  "nextStep": "DOCUMENT"
}
```
Document codes: `ID_NUMBER_INVALID`, `MRZ_INVALID`, `ID_EXPIRED`, `PASSPORT_EXPIRED`, `NO_FACE` (no portrait found on the document). Other errors: `409 LIVENESS_REQUIRED` (liveness not passed yet), `409 ALREADY_VERIFIED`, `429 TOO_MANY_ATTEMPTS`.

---

### 4.5 `GET /v2/selfie-verifications/{sessionId}`: current state
Use it to resume after the app was killed, or to redraw the progress screen.
```json
{
  "sessionId": "3b6e1c0a-…",
  "flow": "SELFIE_ID_VERIFICATION",
  "status": "IN_PROGRESS",
  "decision": null,
  "documentType": "EMIRATES_ID",
  "expiresAt": "2026-10-08T09:15:00Z",
  "nextStep": "DOCUMENT",
  "steps": [
    { "step": "LIVENESS", "status": "PASSED", "attemptsUsed": 2, "attemptsMax": 5 },
    { "step": "DOCUMENT", "status": "REVIEW", "attemptsUsed": 1, "attemptsMax": 3 }
  ]
}
```

### 4.6 `GET /v2/selfie-verifications/{sessionId}/result`: decision and signed token
```json
{
  "sessionId": "3b6e1c0a-…",
  "status": "COMPLETED",
  "decision": "APPROVED",
  "decidedAt": "2026-10-08T09:02:18Z",
  "resultToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCIsImtpZCI6ImNhbXRlY2gtMSJ9.eyJpc3MiOiJjYW10ZWNoIi…",
  "resultTokenExpiresAt": "2026-10-08T09:12:18Z"
}
```
Before a decision exists, `decision` and `resultToken` are `null`. For `REVIEW`, call it again later (or rely on the webhook): once a reviewer decides, it returns `APPROVED` or `REJECTED`.

### 4.7 `POST /v2/selfie-verifications/{sessionId}/cancel`
The user closed the flow. Returns the state (4.5) with `status: "CANCELLED"`.

---

### 4.8 `POST /v2/face-authentications`: returning user (face login / step-up)
For a user whose face is registered (face registration, or a selfie ID verification that registered the face; `subjectRef` must match). One call: liveness, then a match against the registered face.

**Request** (`multipart/form-data`): `subjectRef`, `normal`, optional `closer` and `deviceAntispoofScore`, and `challengeId` + `challengeFrames` from a challenge issued for this `subjectRef` ([4.14](#414-post-v2liveness-challenges-active-liveness)).

**Response 200**
```json
{
  "sessionId": "c9d0e1f2-…",
  "decision": "APPROVED",
  "reasonCode": null,
  "message": "Face recognised.",
  "resultToken": "eyJhbGciOiJSUzI1NiIs…",
  "resultTokenExpiresAt": "2026-10-08T10:12:00Z"
}
```
A rejected attempt returns `decision: "REJECTED"` with `reasonCode` set to a liveness code or `FACE_MISMATCH`. `404 NO_ENROLLED_FACE` means the user must register their face first.

---

### 4.9 `GET /v2/reason-codes`: all messages
Returns `[{ "code": "TOO_DARK", "category": "LIVENESS", "message": "…" }, …]` in the `Accept-Language` language. You can bundle these in the app as a fallback, but always prefer `message` from the response, because the back-office can change the text.

### 4.10 `GET /v2/.well-known/jwks.json`: public key for result tokens
Standard JWKS. See [section 6](#6-trusting-the-result-on-your-backend).

### 4.11 Server-side OCR (optional)
`POST /v2/documents/scan` (same as `/api/v1/documents/scan`) with `image`, `documentType` (`EMIRATES_ID`, `EMIRATES_ID_FRONT`, `EMIRATES_ID_BACK`, `PASSPORT`, `TRADE_LICENCE`), and optionally `format` (trade licence issuer) and `userId` (your subject reference). It returns the extracted fields:
```json
{
  "success": true,
  "scanId": "5f1c…",
  "documentType": "TRADE_LICENCE",
  "confidence": 0.9312,
  "fields": { "licenseNo": "1234567", "companyName": "AL NOOR GENERAL TRADING L.L.C", "expiryDate": "28/02/2027" },
  "rawText": "…",
  "processingTimeMs": 3840,
  "message": "Document processed successfully"
}
```
`/v2/documents/scan-only` does the same without storing anything.

---

### 4.12 `POST /v2/sdk-tokens`: a token for the browser
**Call this from your backend only**, with `X-Client-Id` / `X-Client-Secret`. Give the token to the web SDK (or your mobile app). It lets the SDK run the end-user flows of this app, and nothing else, without the client secret ever leaving your servers.

**Request** (`Content-Type: application/json`, body optional)
```json
{ "subjectRef": "usr_8812", "ttlMinutes": 30 }
```
| Field | Required | Meaning |
|---|---|---|
| `subjectRef` | Recommended | Bind the token to this user. Verifications, face authentications and scans made with it always use this `subjectRef`, and a different one gets `403 SUBJECT_MISMATCH`. |
| `ttlMinutes` | No | 1–60, default 30 |

**Response 201**
```json
{
  "sdkToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJjYW10ZWNoIi…",
  "expiresAt": "2026-10-08T09:45:00Z",
  "tenantCode": "NOQODI",
  "clientAppCode": "WEB_APP",
  "subjectRef": "usr_8812"
}
```
The browser sends it as `X-Sdk-Token`. It works on `GET /v2/capabilities`, `GET /v2/branding`, `GET /v2/reason-codes`, `/v2/selfie-verifications/**`, `POST /v2/liveness-challenges`, `POST /v2/face-authentications`, `POST /v2/liveness-checks`, `POST /v2/face-enrollments` and `POST /v2/documents/scan[-only]`. Everything else answers `403 SDK_TOKEN_NOT_ALLOWED`. For a `WEB` app with allowed origins, the calls must come from one of those origins. An SDK token is **not** a result: always verify the `resultToken` ([section 6](#6-trusting-the-result-on-your-backend)).

### 4.13 `GET /v2/branding`: how the SDK looks
This returns the colours, logo, font, theme and texts the tenant set in the tenant portal (**Branding**), or the defaults. The web SDK applies them automatically. The shape is in [tenant-api.md](tenant-api.md#branding-of-the-web-sdk).

### 4.14 `POST /v2/liveness-challenges`: active liveness
camtech checks liveness in two independent ways:
- **Passive:** an anti-spoof model looks at every image for printed photos, screens and masks. It needs nothing from the app.
- **Active:** the user performs random actions that camtech chooses. A pre-recorded video can't know them in advance.

Ask for a challenge right before the liveness step, and ask for a new one for every attempt.

**Request** (`application/json`): `{ "sessionId": "3b6e1c0a-…" }` for a selfie ID verification (with its session token); for the one-call flows `{ "flow": "FACE_AUTHENTICATION", "subjectRef": "usr_8812" }` (`flow` defaults to `FACE_AUTHENTICATION`), `"FACE_ENROLLMENT"` (`subjectRef` required) or `"LIVENESS_CHECK"` (`subjectRef` optional). A challenge only works in the flow it was issued for. Add `"supportedActions": [...]` with every action your app can show; without it the app is assumed to support `TURN_LEFT`, `TURN_RIGHT` and `BLINK` only.

**Response 201**
```json
{ "challengeId": "9d1f…", "actions": ["TURN_LEFT", "BLINK"], "expiresAt": "2026-10-08T09:05:00Z" }
```

**Rules:**
- **The actions:** `TURN_LEFT` / `TURN_RIGHT` (from the user's own point of view: turn the head at least about 20°), `LOOK_UP` / `LOOK_DOWN` (tilt the head about 15° or more), `BLINK` (open, closed, open), `SMILE` and `MOVE_CLOSER` (the face at least 10% larger; both measured against the neutral opening frame, and followed by a frame back at the normal distance). They are drawn at random, without repeats, from the tenant's selection for the flow that your app supports.
- **Errors:** `409 FACE_ALREADY_ENROLLED` for a face registration of a person who already has one; `409 CHALLENGE_NOT_USED` when the flow is PASSIVE (upload the selfies without a challenge); `400 CHALLENGE_REQUIRED` when your app supports too few of the selected actions (ask the user to update the app).
- **One challenge per attempt:** a challenge works for one upload, before `expiresAt` (3 minutes by default).

**Capture:**
1. Take the normal selfie.
2. Guide the user through the actions in the given order. Record a frontal frame first, the frames that show each action (for a blink, include the eyes-closed frame), and a frontal frame between actions and at the end. Never send a frame without a face. Keep it to 16 frames at most, 480–640 px on the long side, unmirrored.
3. Older clients only: take the closer selfie.
4. Upload everything in one liveness call with `challengeId` and `challengeFrames`.

**What the server checks:** every frame must show the same single person who took the selfies. If the actions aren't seen in order, the response is `422 CHALLENGE_FAILED`; more than one frame without a face gives `422 FACE_NOT_VISIBLE`.

The web SDK does all of this. Native apps read `settings.livenessMode` in `/v2/capabilities`: `ACTIVE` = do a challenge, `PASSIVE` = skip it (the passive check is then required). Released mobile apps that do no challenge keep working while the back-office allows it for the mobile channel (`livenessChallengeRequired: false`); their uploads then need the passive check to pass.

---

### 4.15 `POST /v2/liveness-checks`: liveness check (selfie only)
Proves a real person is in front of the camera. No document and no face is registered. One call, one attempt.

**Request** (`multipart/form-data`): optional `subjectRef`, `normal`, optional `closer` and `deviceAntispoofScore`, and `challengeId` + `challengeFrames` from a challenge with `"flow": "LIVENESS_CHECK"` ([4.14](#414-post-v2liveness-challenges-active-liveness)). The flow is PASSIVE by default (no challenge); the tenant can switch it to ACTIVE in the portal.

**Response 200** (same shape as face authentication)
```json
{
  "sessionId": "5e7a…",
  "decision": "APPROVED",
  "reasonCode": null,
  "message": "Liveness confirmed.",
  "resultToken": "eyJhbGciOiJSUzI1NiIs…",
  "resultTokenExpiresAt": "2026-10-08T10:12:00Z"
}
```
A failed liveness returns `decision: "REJECTED"` with the liveness `reasonCode`. The result token has `flow: "LIVENESS_CHECK"` and no `sub` when no `subjectRef` was sent.

### 4.16 `POST /v2/face-enrollments`: face registration (selfie only)
Registers the user's face without a document, so face authentication can recognise them later. One call, one attempt. Always ACTIVE: a challenge with `"flow": "FACE_ENROLLMENT"` is required.

**Request** (`multipart/form-data`): `subjectRef` (required), `normal`, optional `closer` and `deviceAntispoofScore`, `challengeId` + `challengeFrames`.

**Response 200**: same shape as above.
- `APPROVED`: the face is registered.
- `REVIEW` with `reasonCode: "DUPLICATE_IDENTITY"`: the face already belongs to another person; it is registered only if a reviewer approves (webhook `REVIEW_DECIDED`). Without manual review this is `REJECTED`.
- `REJECTED` with a liveness `reasonCode`.

**Errors:** `400 VALIDATION_ERROR` without `subjectRef`; `409 FACE_ALREADY_ENROLLED` when the person already has a registered face (nothing is replaced; erase the person to start again); `403` / `429` as for every flow.

---

## 5. Errors and what the app should do

| HTTP | Code | App action |
|---|---|---|
| 422 | Liveness codes (`TOO_DARK`, `BLURRY`…) | Show `message`. If `nextStep = LIVENESS`, retake both selfies. |
| 422 | `ID_NUMBER_INVALID`, `MRZ_INVALID`, `ID_EXPIRED`, `PASSPORT_EXPIRED`, `NO_FACE` | Show `message`. If `nextStep = DOCUMENT`, rescan. |
| 409 | `LIVENESS_REQUIRED` | Go back to the liveness step |
| 409 | `LIVENESS_ALREADY_DONE`, `ALREADY_VERIFIED`, `SESSION_CLOSED` | Read the state (4.5) and continue from `nextStep` |
| 410 | `SESSION_EXPIRED` | Start a new verification |
| 404 | `SESSION_NOT_FOUND` | Start a new verification |
| 429 | `TOO_MANY_ATTEMPTS` | The verification is over; offer "Start again" |
| 429 | `QUOTA_EXCEEDED` | "Service busy, try later" |
| 401 | `CLIENT_AUTH_REQUIRED`, `CLIENT_AUTH_INVALID` | Configuration problem with the app credentials |
| 401 | `SESSION_TOKEN_INVALID` | Wrong or missing session token; start again |
| 403 | `FEATURE_NOT_ENABLED`, `FEATURE_NOT_ALLOWED` | Refresh `/v2/capabilities` and hide the feature |
| 403 | `ORIGIN_NOT_ALLOWED` | Web: the website origin isn't registered for this app |
| 401 | `SDK_TOKEN_INVALID`, `SDK_TOKEN_EXPIRED` | Ask your backend for a new SDK token and start again |
| 403 | `SDK_TOKEN_NOT_ALLOWED` | SDK tokens only work on the end-user endpoints (capabilities, branding, reason codes, selfie ID verification, liveness check, face authentication, document scan) |
| 403 | `SUBJECT_MISMATCH` | The SDK token was issued for another `subjectRef` |
| 403 | `TENANT_SUSPENDED` | The account is suspended; contact camtech |
| 413 | `FILE_TOO_LARGE` | Compress the image (see [section 9](#9-capture-tips)) |
| 502 / 503 | `FACE_SERVICE_ERROR`, `FACE_SERVICE_UNAVAILABLE`, `LIVENESS_UNAVAILABLE` | Retry after a few seconds (with a new challenge for liveness). The attempt is not lost. |
| 400 / 409 | `CHALLENGE_REQUIRED`, `CHALLENGE_INVALID`, `CHALLENGE_EXPIRED` | Ask for a new liveness challenge and redo it. The attempt is not lost. |
| 422 | `CHALLENGE_FAILED` | Show `message`; retake with a new challenge if `nextStep = LIVENESS` |

---

## 6. Trusting the result on your backend

The device can be tampered with, so **your backend should not accept "approved" from the app**. The app sends the `resultToken` to your backend, and your backend verifies it:

1. Fetch the public key from `GET /v2/.well-known/jwks.json` (cache it; `kid` = `camtech-1`).
2. Verify the RS256 signature, `iss = "camtech"`, and that `exp` has not passed.
3. Check `sid` (the session id) and `sub` (your `subjectRef`) match the user, then use `decision`.

Claims:
```json
{
  "iss": "camtech",
  "sub": "usr_8812",
  "sid": "3b6e1c0a-58d2-4f0e-9c1b-7a4e2c9d9f2d",
  "flow": "SELFIE_ID_VERIFICATION",
  "decision": "APPROVED",
  "decidedBy": "SYSTEM",
  "documentType": "EMIRATES_ID",
  "personId": "8f3a1d2e-…",
  "iat": 1791450138,
  "exp": 1791450738,
  "jti": "0b7c…"
}
```
Java (Nimbus JOSE):
```java
JWKSource<SecurityContext> keys = JWKSourceBuilder.create(new URL("https://<host>/camtech-service/v2/.well-known/jwks.json")).build();
ConfigurableJWTProcessor<SecurityContext> p = new DefaultJWTProcessor<>();
p.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keys));
JWTClaimsSet claims = p.process(resultToken, null);   // throws if invalid or expired
String decision = claims.getStringClaim("decision");
```
Node (jose):
```js
import { createRemoteJWKSet, jwtVerify } from 'jose';
const jwks = createRemoteJWKSet(new URL('https://<host>/camtech-service/v2/.well-known/jwks.json'));
const { payload } = await jwtVerify(resultToken, jwks, { issuer: 'camtech' });
```

---

## 7. Webhooks

Configured in the tenant portal (**Webhooks**) or the back-office (**Configuration → Webhooks**). camtech POSTs JSON to your URL for these events:

| Event | When |
|---|---|
| `SESSION_COMPLETED` | A verification got a decision, or ended without one (`status: FAILED` / `CANCELLED`) |
| `SESSION_EXPIRED` | A verification timed out |
| `REVIEW_OPENED` | A verification went to manual review |
| `REVIEW_DECIDED` | A reviewer approved or rejected it (the final answer for `REVIEW`). `decidedBy` is `TENANT` (your reviewer, named in `reviewer`) or `CAMTECH` |
| `SCAN_REVIEW_REQUIRED` | A document scan needs a person to check it (`scanId`, `documentType`, `subjectRef`, `reasons`) |
| `SCAN_REVIEW_DECIDED` | A scan was approved or rejected (`decision`, `decidedBy`, `correctedFields`) |
| `DOCUMENT_EXPIRING` | A document entered your warning period (`documentId`, `documentType`, `partyId`, `subjectRef`, `expiresOn`, `daysLeft`); sent once per document |
| `PARTY_ERASED` | A person's data was erased (`partyId`, `subjectRef`, `erasedAt`, `erasedBy`) |

```http
POST /hooks/camtech HTTP/1.1
Content-Type: application/json
X-Camtech-Event: SESSION_COMPLETED
X-Camtech-Delivery: 15051
X-Camtech-Signature: t=1791450138,v1=5d41402abc4b2a76b9719d911017c592ae0b5e3c1f…

{
  "eventType": "SESSION_COMPLETED",
  "occurredAt": "2026-10-08T09:02:18Z",
  "data": {
    "sessionId": "3b6e1c0a-…",
    "flow": "SELFIE_ID_VERIFICATION",
    "status": "COMPLETED",
    "decision": "APPROVED",
    "subjectRef": "usr_8812",
    "documentType": "EMIRATES_ID"
  }
}
```
**Verify the signature:** compute `HMAC-SHA256(secret, t + "." + rawBody)` and compare it with `v1` in constant time. Reject the request if `t` is more than 5 minutes old.

Reply with any `2xx` within 10 seconds. Otherwise camtech retries after 30 s, 2 min, 10 min, 30 min and 2 h, then marks the delivery failed (it can be retried from the back-office). The same event can arrive twice, so de-duplicate on `X-Camtech-Delivery` or `data.sessionId` + `eventType`.

---

## 8. Moving from /face-tech to /v2

| Old | New |
|---|---|
| `POST /face-tech/sessions` | `POST /v2/selfie-verifications` (send `subjectRef`; keep `sessionToken`) |
| `POST /face-tech/sessions/{id}/liveness` | `POST /v2/selfie-verifications/{id}/liveness` |
| `device_antispoof_score` | `deviceAntispoofScore` |
| `POST /face-tech/sessions/{id}/verify` | `POST /v2/selfie-verifications/{id}/document` |
| `document_type`, `document` / `id_front` | `documentType`, `document` |
| `id_number`, `id_expiry`, `mrz_line2` | `documentNumber`, `expiryDate`, `mrzLine2` |
| Response `decision` `MATCH` / `REVIEW` / `NO_MATCH` | `result` (same values) plus the session `decision` (`APPROVED` / `REVIEW` / `REJECTED`) and `nextStep` |
| `similarity`, `score`, `model_version` in the response | Not sent to the app any more (visible in the back-office) |
| `attempts_remaining` | `attemptsRemaining` |
| Error `{ "code", "detail" }` | `{ "code", "message", "step", "attemptsRemaining", "nextStep" }` |
| Result read from the response | `GET /{id}/result` → `resultToken` for your backend |

Checklist for the app release:
1. Add `X-Client-Id` / `X-Client-Secret` (ask the back-office admin for credentials) and the device headers.
2. Send `subjectRef`, and keep `sessionToken` as `Authorization: Bearer`.
3. Drive the screens from `nextStep` and show `message`.
4. Send `resultToken` to your backend and verify it there.
5. After the release has rolled out, the back-office admin turns on `CAMTECH_REQUIRE_CLIENT_CREDENTIALS` and `CAMTECH_REQUIRE_SESSION_TOKEN`.

---

## 9. Capture tips
- **Selfies:** front camera, at least 720 px on the short side, JPEG quality around 85. The face should be centred, eyes open, with no mask or sunglasses. Take the normal selfie first. When a closer selfie is sent (older clients) or `MOVE_CLOSER` is asked for, the closer face must be at least 10% larger.
- **Documents:** rear camera, the whole card inside the frame, no glare, at least 1200 px wide. For passports, keep both MRZ lines sharp.
- **Size:** keep each image under 2 MB. 10 MB is the hard limit.
- **Web:** ask for camera permission before starting. Use `getUserMedia` and send JPEG blobs. Uploading from the gallery is allowed only when `fileUploadAllowed` is `true` (it is `false` for web by default).
- **Do the OCR on the device** (Emirates ID number, expiry, MRZ). camtech checks the checksum, the MRZ check digits and the expiry before matching.

---

## 10. Legacy endpoints (still available)
These keep their old request and response shapes for existing app versions, but new work should use `/v2`.

| Endpoint | Purpose |
|---|---|
| `POST /face-tech/sessions`, `/{id}/liveness`, `/{id}/verify` | Previous name of selfie ID verification |
| `POST /onboarding/session`, `/onboarding/face/register`, `/onboarding/{userId}/emirates-id`, `/onboarding/session/{sessionId}/emirates-id`, `/onboarding/{userId}/passport`, `/onboarding/session/{sessionId}/passport` | Legacy onboarding (face poses and document data read by the app) |
| `POST /face/identify`, `/face/verify`, `/face/compare` | Legacy 1:N / 1:1 / pairwise face checks |
| `GET /user`, `GET /user/{id}`, `GET /user/image/{imageId}`, `DELETE /user/{id}` | Legacy user views (now people in the back-office) |
| `POST /api/v1/documents/scan`, `/scan-only`, `GET /scan/{scanId}`, `/user/{userId}`, `/supported-types`, `/health` | Server-side OCR |

---

## 11. Web SDK
For web apps, use the camtech web SDK ([`camtech-ui/apps/sdk`](../../camtech-ui/apps/sdk)) instead of calling the API from your own screens. It runs selfie ID verification, face authentication and document scanning.

**What the user sees:**
- live camera guidance: a face oval, and a card or passport frame, with hints about light, glare, blur, head position and holding still
- automatic capture, and the "bring the phone closer" step
- a screen to check the details read from the document
- the screens for every error code in [section 5](#5-errors-and-what-the-app-should-do)
- English and Arabic (right to left), and your branding from the tenant portal

**1. Your backend gets an SDK token** with its credentials ([4.12](#412-post-v2sdk-tokens-a-token-for-the-browser)), or starts a verification itself and keeps `sessionId` + `sessionToken`.

**2. The browser opens the SDK**, in one of these ways:

| Mode | How |
|---|---|
| Hosted page | Redirect to `https://<sdk-host>/?journey=SELFIE_ID_VERIFICATION&lang=ar&returnUrl=https://your.app/done#sdkToken=<token>`. Secrets go only in the `#hash`, and the SDK removes it from the address bar right away. At the end the browser returns to `returnUrl?camtechSessionId=…&camtechStatus=completed\|cancelled\|failed`. |
| Modal or inline embed | `<script src="https://<sdk-host>/camtech-sdk.js">`, then `Camtech.init({ mode: 'modal', apiBaseUrl, sdkToken, journey: [...], lang, onComplete, onCancel, onError }).open()` |
| iframe | `Camtech.init({ mode: 'iframe', hostedUrl: 'https://<sdk-host>/', ... })`. Secrets are passed by `postMessage` after a handshake, never in the URL. |
| npm | `import { mount } from '@camtech/sdk'; mount(element, { sdkToken, journey, onComplete })` |

`journey` lists `SELFIE_ID_VERIFICATION`, `FACE_AUTHENTICATION` and `DOCUMENT_SCAN`, which run in order. Other options are `subjectRef`, `documentType` and `scanTypes` (`EMIRATES_ID`, `PASSPORT`, `TRADE_LICENCE`).

`onComplete({ results })` gives one entry per flow:
- `{ flow, sessionId, status, decision, resultToken }` for the verification flows
- `{ flow: 'DOCUMENT_SCAN', documentType, scanId, scanIds, fields }` for document scans

**3. Send `resultToken` to your backend and verify it** ([section 6](#6-trusting-the-result-on-your-backend)). Never trust a decision that comes from the browser. For the hosted page, read the result from your backend instead (`GET /v2/selfie-verifications/{id}/result` with your credentials, or the webhook).

**Allowed origins** (tenant portal, **Apps & API keys**):
- inline, modal or npm: add your website's origin
- hosted page or iframe: add the SDK host's origin

The full options, events and `postMessage` protocol are in the [SDK README](../../camtech-ui/apps/sdk/README.md). You can try every flow with your own apps in the tenant portal's **Playground**.

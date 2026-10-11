# @camtech/sdk — end-user web SDK

Selfie liveness + Emirates ID / passport face match, liveness check, face registration, face authentication and
document scanning (server OCR), with on-device guidance (`@camtech/capture-core`, MediaPipe) and tenant branding.

```bash
npm run dev -w @camtech/sdk        # http://localhost:5175 against VITE_API_BASE_URL
npm run dev:mock -w @camtech/sdk   # in-memory API + simulated camera fallback
npm run build -w @camtech/sdk      # dist/ (hosted page) + dist-lib/camtech-sdk.js (IIFE) + camtech-sdk.mjs (ESM)
npm test -w @camtech/sdk
```

Mock demo: `http://localhost:5175/?journey=SELFIE_ID_VERIFICATION,FACE_AUTHENTICATION,DOCUMENT_SCAN&subjectRef=demo-user#sdkToken=mock`
(add `&simulateCamera=1` to force the simulated camera, `&mock=TOO_DARK,ID_EXPIRED,REVIEW,NO_MATCH,REJECTED,FACE_SERVICE_UNAVAILABLE,NO_ENROLLED_FACE,OCR_FAILED,SESSION_EXPIRED,QUOTA_EXCEEDED,…` for scenarios; see `src/mocks/server.ts`).

## Journeys and products
`journey` = the flows to run, in order (default `SELFIE_ID_VERIFICATION`). Flows the app may not use are skipped
(`error` FEATURE_NOT_ALLOWED, not fatal); `FACE_AUTHENTICATION` and `FACE_ENROLLMENT` without a `subjectRef` (option or
SDK token claim) are skipped with SUBJECT_REF_REQUIRED.

| Product | journey / options |
|---|---|
| Trade licence scan | `DOCUMENT_SCAN`, `scanTypes: ['TRADE_LICENCE']` |
| Emirates ID scan | `DOCUMENT_SCAN`, `scanTypes: ['EMIRATES_ID']` |
| Passport scan | `DOCUMENT_SCAN`, `scanTypes: ['PASSPORT']` |
| Liveness check (selfie only) | `LIVENESS_CHECK` |
| Selfie verification + Emirates ID / passport | `SELFIE_ID_VERIFICATION`, `enrollFace: false` |
| Face registration (selfie only) | `FACE_ENROLLMENT` + `subjectRef` |
| Face registration + Emirates ID / passport | `SELFIE_ID_VERIFICATION`, `enrollFace: true` + `subjectRef` (FACE_ENROLLMENT entitlement) |
| Face login | `FACE_AUTHENTICATION` + `subjectRef` (matches the face registered by either face registration) |

- `LIVENESS_CHECK`: selfies → `POST /v2/liveness-checks` → approved / rejected (try again). No document, nothing registered;
  `subjectRef` optional.
- `FACE_ENROLLMENT`: selfies → `POST /v2/face-enrollments` (always ACTIVE liveness) → approved (face registered) / review
  (`DUPLICATE_IDENTITY`: the face may belong to someone else, a reviewer decides; no polling) / rejected (liveness: try
  again; `DUPLICATE_IDENTITY`: done only). `409 FACE_ALREADY_ENROLLED` (on the challenge or the upload) ends the flow on
  "Face already registered" with no result (`error` event with that code).
- `enrollFace` (selfie verification only): `true` = register the face when approved (403 FEATURE_NOT_* without the
  entitlement), `false` = verify only, omitted = not sent (the server registers when the app may). When the face will be
  registered (`enrollFace`, else capabilities `faceEnrollmentAvailable`) the welcome screen says so.
- Mock scenarios: `ALREADY_ENROLLED`, `DUPLICATE` (review; with `REJECTED`: rejected), `NO_ENROLLED_FACE` (until a mock face
  registration or an approved selfie verification with `enrollFace` for the same `subjectRef`). Liveness scenarios
  (`TOO_DARK`…) reject the first liveness check / face registration with that reasonCode.

## Active liveness
The selfie capture (every flow but DOCUMENT_SCAN) runs: NORMAL selfie (the only fixed photo) →
server-issued challenge → upload. There is no separate closer selfie: moving closer is the `MOVE_CLOSER` challenge,
and the SDK uploads no `closer` part.
- A challenge (`POST /v2/liveness-challenges` with `{ sessionId }`, `{ subjectRef }` (face authentication),
  `{ subjectRef, flow: 'FACE_ENROLLMENT' }` or `{ [subjectRef,] flow: 'LIVENESS_CHECK' }`, and `supportedActions` = all seven
  actions; a challenge only works for its flow) is requested once the camera works, and a new one for every retake (single use, expires after about
  3 minutes). When the flow's `livenessMode` (capabilities) is `PASSIVE`, no challenge is requested and no challenge
  frames are sent: the NORMAL selfie only.
- Each action (`TURN_LEFT` = the user's own left, `TURN_RIGHT`, `LOOK_UP`, `LOOK_DOWN`, `BLINK`, `SMILE`, `MOVE_CLOSER`) is shown
  one at a time and recognised on the device (`capture-core/src/challenge-detector.ts`: nose offset → yaw, face
  matrix → pitch, blendshape blink + eye aspect ratio, blendshape smile, face area vs the opening frame → closer). Up
  to 16 unmirrored frames with exactly one face (≤ 640 px, JPEG ≈ 0.8, < 1 MB) are uploaded in order: frontal, peak
  turn / pitch / smile / closer or open-closed-open, frontal… Arrows point the way the user sees themselves move in the mirrored preview (also in Arabic).
- `CHALLENGE_REQUIRED` / `CHALLENGE_INVALID` / `CHALLENGE_EXPIRED` → new challenge and redo (no attempt used);
  `CHALLENGE_FAILED` → retake screen with the server message; `LIVENESS_UNAVAILABLE` → automatic retry.
- Without the face model the instructions are timed and frames are taken at fixed moments. If the challenge endpoint
  fails with a non-retryable error and `livenessChallengeRequired` is false, the SDK falls back to the normal selfie only.
- Mock scenarios: `mock=CHALLENGE_FAILED`, `CHALLENGE_EXPIRED`, `CHALLENGE_OPTIONAL`, `NO_CHALLENGE` (fallback),
  `PASSIVE` (face authentication without a challenge), `NEW_ACTIONS` (only look up / down, smile and move
  closer), `WITH_MOVE_CLOSER` (every challenge includes it), `FACE_NOT_VISIBLE`.

## Auth
Never put a client secret in the browser. Your backend either mints an SDK token (`POST /v2/sdk-tokens`) or starts a
verification itself and hands over `sessionId` + `sessionToken`.

## 1. Hosted page
`https://<sdk-host>/?journey=SELFIE_ID_VERIFICATION,DOCUMENT_SCAN&subjectRef=u1&lang=ar&returnUrl=https://app/done#sdkToken=…`

- Secrets only in the hash (`#sdkToken=…` or `#sessionId=…&sessionToken=…`); the hash is removed from the address bar at once.
- Query: `journey`, `subjectRef`, `lang=en|ar`, `documentType=EMIRATES_ID|PASSPORT`, `enrollFace=true|false`,
  `scanTypes=EMIRATES_ID,PASSPORT,TRADE_LICENCE`, `returnUrl`, `parentOrigin`, `debug=1`.
- At the end the browser goes to `returnUrl?camtechSessionId=…&camtechStatus=completed|cancelled|failed`. The result token
  is never put in a URL: your backend reads `GET /v2/selfie-verifications/{id}/result` (or the webhook).
- The hosted page always uses its build-time `VITE_API_BASE_URL` and model URLs (never values from the URL or postMessage).
- Preview for the portal: `?preview=1&screen=welcome|liveness|document|result-approved|result-review|result-rejected&lang=en`
  re-themes on `{ source: 'camtech-portal', type: 'branding', payload: Branding }` messages.

## 2. Embed (`dist-lib/camtech-sdk.js`, global `Camtech`)
```html
<script src="camtech-sdk.js"></script>
<script>
  const sdk = Camtech.init({
    mode: 'modal',                 // 'modal' | 'inline' (container) | 'iframe' (hostedUrl [+ container])
    sdkToken, journey: ['SELFIE_ID_VERIFICATION'], subjectRef: 'u1', lang: 'en', enrollFace: true,
    apiBaseUrl: 'https://host/camtech-service',
    onComplete: (r) => fetch('/api/kyc/done', { method: 'POST', body: JSON.stringify(r) }),
    onCancel: () => {}, onError: (e) => {}, onStep: (s) => {}, onReady: () => {}, onEvent: (e) => {},
  });
  sdk.open();       // also: close(), destroy(), setLang('ar')
</script>
```
- modal / inline render in a Shadow DOM root (style isolation). The modal makes the page behind it inert, traps focus,
  and Esc asks to cancel. Inline mounts immediately.
- iframe loads `hostedUrl?parentOrigin=<origin>&lang=…` with `allow="camera; fullscreen"`; after the iframe's `ready`
  handshake the options (with the secrets) are sent by postMessage to the hosted origin only.
- MediaPipe is loaded at runtime from jsDelivr in the library build (`@mediapipe/tasks-vision@1.0.1`).
- The embedding page's origin must be in the client app's allowed origins (`403 ORIGIN_NOT_ALLOWED` otherwise).

postMessage protocol (iframe ↔ host), always with an explicit target origin and `event.origin`/`event.source` checks:
- SDK → host: `{ source: 'camtech-sdk', version: 1, type, payload }`, `type` = `ready` (`{ phase: 'handshake'|'loaded' }`),
  `step`, `complete`, `cancel`, `error`, `event` (debug: `{ type: 'api', method, path, status, ms }` / `{ type: 'step', … }`), `resize` (`{ height }`).
- Host → SDK: `{ source: 'camtech-host', type: 'init' | 'setLang' | 'close', payload }`.

`complete` payload: `{ results: [ { flow: 'SELFIE_ID_VERIFICATION' | 'FACE_AUTHENTICATION' | 'LIVENESS_CHECK' | 'FACE_ENROLLMENT',
sessionId, status, decision, resultToken, resultTokenExpiresAt } | { flow: 'DOCUMENT_SCAN', documentType, scanId, scanIds, fields,
editedFields } ] }` (`decision` REVIEW for a face registration waiting for a reviewer).
Verify `resultToken` on your backend (JWKS); never trust the browser's decision.

## 3. npm
```ts
import { mount } from '@camtech/sdk';
const handle = mount(document.getElementById('kyc')!, { sdkToken, journey: ['DOCUMENT_SCAN'], onComplete });
handle.setLang('ar'); handle.unmount();
```

## Deployment notes
Serve the hosted page over https with a CSP such as
`default-src 'self'; script-src 'self' https://cdn.jsdelivr.net 'wasm-unsafe-eval'; connect-src 'self' <api> https://cdn.jsdelivr.net https://storage.googleapis.com; img-src 'self' data: blob:; media-src blob:; style-src 'self' 'unsafe-inline'; frame-ancestors <tenant origins>`
and `Permissions-Policy: camera=(self)`.

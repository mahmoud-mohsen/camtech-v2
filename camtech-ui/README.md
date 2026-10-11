# camtech-ui

The web front ends that tenants (the companies integrating camtech) and their end users see. The operators' back-office is separate, in [`../backoffice`](../backoffice).

| Folder | What it is | Dev port |
|---|---|---|
| [`apps/sdk`](apps/sdk) | **End-user web SDK.** Selfie ID verification, face authentication and document scanning, with live camera guidance and auto-capture, in English and Arabic. It can run as a hosted page, an embedded modal or inline Shadow DOM, an iframe, or an npm package (`@camtech/sdk`). | 5175 |
| [`apps/portal`](apps/portal) | **Tenant portal.** Overview, verifications, document scans, apps and API keys, webhooks, SDK branding with a live preview, a playground that runs the real SDK, an integration guide, the audit log and reason codes. | 5174 |
| [`packages/capture-core`](packages/capture-core) | **Camera engine** with no UI. It covers camera control, frame quality checks (light, glare, blur, motion), MediaPipe face tracking (head pose, eyes, face size), document alignment, best-frame capture and JPEG encoding. | — |
| [`packages/api-client`](packages/api-client) | Typed client for the public `/v2` API and the tenant API `/v2/tenant`. | — |

## Run

```bash
npm install
npm run dev:portal:mock   # portal with in-memory data, no backend (tenants NOQODI and DEMO)
npm run dev:sdk:mock      # SDK with a mock API and a simulated camera
```

To run against a backend, set `VITE_API_BASE_URL` (default `http://localhost:8080/camtech-service`) and run `npm run dev:portal` / `npm run dev:sdk`. The backend must have `CAMTECH_TENANT_PORTAL_ENABLED=true` for the portal.

```bash
npm run typecheck && npm test && npm run build
```

`.npmrc` sets `legacy-peer-deps=true` to work around an npm resolver bug with vitest's optional peer dependencies.

## How the pieces fit

1. **Signing in.** Portal users sign in with a username and password (`/v2/tenant/auth/login`) and every call sends `Authorization: Bearer <token>`; the tenant comes from the user. Roles (OWNER, DEVELOPER, REVIEWER, VIEWER) decide what can be changed. See `apps/portal/README.md` and [camtech/docs/tenant-portal-spec.md §3.1](../camtech/docs/tenant-portal-spec.md).
2. **SDK tokens.** The tenant's backend calls `POST /v2/sdk-tokens` with its client credentials and passes the short-lived token to the SDK. The browser never holds a client secret. The portal playground gets the same kind of token from `/v2/tenant/playground/sdk-token`.
3. **The SDK** reads the tenant's branding (`GET /v2/branding`) and capabilities, runs the flows, and hands the tenant the signed `resultToken`, which the tenant's backend verifies with the JWKS. See [camtech/docs/integration-guide.md §11](../camtech/docs/integration-guide.md#11-web-sdk).
4. **Branding preview.** The portal loads the SDK in `?preview=1` mode and sends branding over `postMessage` while you edit.

## Origins
For a `WEB` app with allowed origins, calls must come from one of those origins:
- **Hosted page and iframe:** the calls come from the SDK's own origin, so add that origin.
- **Inline or modal embed and npm:** the calls come from the tenant's website, so add the website's origin.

An app with no allowed origins accepts every origin.

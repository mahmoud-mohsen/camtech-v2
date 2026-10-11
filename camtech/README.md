# camtech-service

A standalone identity-verification service for mobile and web apps:

- **Selfie ID verification:** liveness, the Emirates ID front or passport photo page, and a face-to-document match (`FACE_DOC_MATCH`). Borderline matches go to manual review.
- **Liveness, active and passive:** two selfies (normal, then closer) plus a random challenge chosen by the server (turn left or right, blink), checked on the frames the user records; and an anti-spoof model (face-embedding `/liveness`) that rejects printed photos, screens and masks. Settings `liveness.*` in the back-office.
- **Face authentication:** a returning person's liveness selfies matched against the face enrolled at verification.
- **Document scanning:** server-side OCR of Emirates IDs, passports (MRZ) and UAE trade licences from 18 issuers, using Google Document AI (PaddleOCR optional), with Arabic text handling, confidence scores and field validation.
- **Back-office:** a separate web app in [`../backoffice`](../backoffice) for operators. It covers the dashboard, verifications with every attempt, the review queue, people and documents, tenants, tenant configuration, client apps, webhooks, retention, the audit log and users.
- **Tenant portal and web SDK:** [`../camtech-ui`](../camtech-ui). Tenants (the companies that integrate camtech) use the portal to see their verifications, manage apps, API keys, webhooks and branding, and try every flow. Their end users go through the web SDK: camera capture with live face and document guidance, in a hosted page, an embedded modal or iframe, or an npm package.

Every attempt, image, check, score and decision is stored, so you can always reconstruct what happened and why.

Face embeddings come from the [face-embedding](https://git.noqodi.com/noqodi-projects/cloud/face-embedding) service, which must be running for the face endpoints.

**Documentation**
- [docs/integration-guide.md](docs/integration-guide.md): for mobile and web integrators. Covers what changed, the flow, every API with request and response, errors, result tokens, webhooks, and moving off `/face-tech`.
- [docs/admin-api.md](docs/admin-api.md): the back-office API contract.
- [docs/tenant-api.md](docs/tenant-api.md): the tenant portal API contract.

## Tech stack
Java 21, Spring Boot 3.3 (Web, Data JPA, Validation, Security), Oracle, Liquibase, OCI Object Storage (S3 API, MinIO client), Google Cloud Document AI, OpenCV, metadata-extractor, Lombok, Maven.

## Project layout

| Package (`com.facetech.backend`) | Contents |
|---|---|
| `api` | Public `/v2` API: selfie ID verification, face authentication, capabilities, reason codes, JWKS, SDK tokens, branding |
| `controller` | Legacy endpoints with unchanged contracts (`/face-tech`, `/onboarding`, `/face`, `/user`, `/api/v1/documents`) |
| `verification` | The flows: sessions, liveness engine, face matching, decisions, people, devices, erasure |
| `admin` | Back-office API (`/v2/admin/**`): sign-in, roles, operations, records, tenants, configuration, webhooks, audit |
| `tenant` | Tenant portal API (`/v2/tenant/**`): the tenant's verifications, scans, apps and keys, webhooks, branding, playground |
| `platform` | Tenant, client authentication, settings (`config_param`), entitlements and quotas, capabilities, audit, outbox, webhook sender, result tokens, media storage |
| `platform.storage` | OCI Object Storage client and the bucket folder layout |
| `jobs` | Session expiry, webhook relay and retries, retention purge |
| `domain`, `repository` | JPA entities (one per table) and repositories |
| `service` | Face service, onboarding, document scan, OCR helpers |
| `ocr`, `parser`, `util` | OCR providers, document parsers, validators |

## Database

Oracle in every environment, local development included. **Liquibase owns the schema** (`src/main/resources/db/changelog`), and Hibernate never changes it (`ddl-auto: none`).

- `1.0.0/001…006`: tables by module: platform, reference data, party, documents and media, biometrics, verification.
- `1.0.0/007`: Oracle-only `IS JSON` checks.
- `1.1.0/001…002`: web SDK branding per tenant (`tenant_branding`), and the `TENANT` actor type in the audit log.
- `1.0.0/100…101`: seed data: countries, document types, the 18 trade licence issuers, field definitions, flows and steps, reason codes in English and Arabic, and the **NOQODI** tenant. NOQODI has every flow, document type and feature enabled and **no daily quota** (`quota_per_day = NULL` means unlimited), plus default settings and retention policies.

Every changeset has a rollback, and the release is tagged `1.0.0`. Never edit an applied changeset: add a new release folder instead. Liquibase runs at start-up (turn it off with `CAMTECH_LIQUIBASE_ENABLED=false` if a DBA applies changes separately).

The design, ERD and sample data are published as the "Camtech Data Model" page.

## Image storage

Images always go to **OCI Object Storage** through its S3-compatible API, never to the pod or local disk. Everything lives under the `camtech/` folder of the bucket, with one folder per case:
```
camtech/selfie-verifications/yyyy/MM/dd/<sessionId>/liveness/attempt-1-normal.jpg
camtech/selfie-verifications/yyyy/MM/dd/<sessionId>/document/attempt-1-front.jpg
camtech/face-authentications/yyyy/MM/dd/<sessionId>/liveness/…
camtech/liveness-checks/yyyy/MM/dd/<sessionId>/liveness/…
camtech/face-enrollments/yyyy/MM/dd/<sessionId>/liveness/…
camtech/document-scans/yyyy/MM/dd/<scanId>/document.jpg
camtech/onboarding/<personId>/{face,emirates-id,passport}/…
camtech/face-compare/…
```
Each image is recorded in `media_file` with its SHA-256, size, dimensions and purge date. A nightly job deletes images past their retention period (back-office: **Data retention**).

## Configuration

Service-level settings are in `src/main/resources/application.yml`. Tenant settings (thresholds, attempts, TTL, entitlements, quotas, messages) live in the database and are managed from the back-office.

| Variable | Default | Meaning |
|---|---|---|
| `DATASOURCE_URL` | Oracle `nqdev01` | JDBC URL |
| `CAMTECH_DATASOURCE_USERNAME` / `CAMTECH_DATASOURCE_PASSWORD` | `CAMTECH` / `CAMTECH` | Database credentials |
| `CAMTECH_PORT` | `8080` | HTTP port |
| `SERVER_SERVLET_CONTEXT_PATH` | `/camtech-service` | Path the service runs under, the same locally and on the servers, so only the host changes (e.g. `http://localhost:8080/camtech-service`, `https://dev.noqodi.com/camtech-service`) |
| `CAMTECH_FACE_MATCH_SERVICE_URL` | `http://localhost:8001` | face-embedding service |
| `CAMTECH_OCR_PROVIDER` | `google-documentai` | `google-documentai` or `paddleocr` |
| `CAMTECH_GOOGLE_APPLICATION_CREDENTIALS` | local path | Google service-account key file |
| `CAMTECH_OCI_BUCKET` | `noqodi-dev01` | Bucket |
| `CAMTECH_OCI_HOST` | Dubai compat endpoint | S3-compatible endpoint |
| `CAMTECH_OCI_REGION` | `me-dubai-1` | Region |
| `CAMTECH_OCI_ACCESS_KEY` / `CAMTECH_OCI_SECRET_KEY` | dev bucket key | Customer secret key for the bucket. Overridden by the deployment config (`cloud-kustoms/camtech-service`). |
| `CAMTECH_TENANT_CODE` | `NOQODI` | Tenant this instance serves |
| `CAMTECH_CORS_ALLOWED_ORIGINS` | `*` | Comma-separated origins (set it to the back-office and web-app origins) |
| `CAMTECH_REQUIRE_CLIENT_CREDENTIALS` | `false` | Require `X-Client-Id` / `X-Client-Secret` on the public API |
| `CAMTECH_REQUIRE_SESSION_TOKEN` | `false` | Require `Authorization: Bearer <sessionToken>` on session calls |
| `CAMTECH_DEFAULT_CLIENT_APP` | `MOBILE_APP` | App used for calls without credentials |
| `CAMTECH_RESULT_TOKEN_PRIVATE_KEY` | key in `application.yml` | PKCS#8 RSA key (base64) that signs result tokens. If set to empty, a key is generated at start-up and tokens stop verifying after a restart. |
| `CAMTECH_BACKOFFICE_ADMIN_PASSWORD` | value in `application.yml` | Password of the first back-office user `admin`, used only when the database has no back-office user yet. A change is forced at first sign-in. |
| `CAMTECH_SDK_TOKEN_TTL_MINUTES` / `CAMTECH_SDK_TOKEN_MAX_TTL_MINUTES` | `30` / `60` | Default and longest lifetime of SDK tokens (`POST /v2/sdk-tokens`) |
| `CAMTECH_SDK_TOKEN_SECRET` | empty | HMAC key for SDK tokens. Empty means it is derived from the result-token key, so every instance accepts the same tokens. |

The two security switches start `false`, so the released mobile app keeps working unchanged. Turn them on once the apps send credentials and session tokens (see the integration guide, section 8).

## Run locally
```bash
export CAMTECH_GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json
mvn spring-boot:run
```
The OCI bucket, the result-token key and the first admin password have defaults in `application.yml`. The service is then at `http://localhost:8080/camtech-service` (health: `/camtech-service/health`).

## Build and test
```bash
mvn -s .m2/settings.xml clean package
```
`.m2/settings.xml` routes all dependencies through Noqodi Nexus, as the pipeline does.

The tests that run from a clean checkout:
- `LiquibaseChangelogTest`: applies the whole changelog to an in-memory H2 database (Oracle mode), rolls it back and applies it again.
- `CamtechApiIntegrationTest`: runs end to end on that database with the face and OCR services mocked. It covers selfie ID verification, failed attempts, an outage not counting as an attempt, the legacy Face Tech contract, the review queue, entitlements and quotas, settings, capabilities, roles, signed result tokens and erasure.
- `FaceMatchScoringTest`, `EmiratesIdValidatorTest`, `PassportMrzValidatorTest`.

The parser tests and their OCR fixtures (`src/test/resources/`) stay out of the repository because the fixtures come from real documents.

## API overview

**Public (mobile and web)**: see [docs/integration-guide.md](docs/integration-guide.md)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/v2/capabilities` | What the calling app may use, and its limits |
| `POST` | `/v2/selfie-verifications` | Start a selfie ID verification |
| `POST` | `/v2/selfie-verifications/{id}/liveness` | Normal and closer selfies |
| `POST` | `/v2/selfie-verifications/{id}/document` | Emirates ID or passport, then the face-to-document match |
| `GET` | `/v2/selfie-verifications/{id}` | State and next step |
| `GET` | `/v2/selfie-verifications/{id}/result` | Decision and signed result token |
| `POST` | `/v2/selfie-verifications/{id}/cancel` | Cancel |
| `POST` | `/v2/face-authentications` | Face authentication for a returning person |
| `POST` | `/v2/liveness-checks` | Liveness check: liveness selfies only, nothing registered |
| `POST` | `/v2/face-enrollments` | Face registration without a document |
| `GET` | `/v2/reason-codes` | Messages in English or Arabic |
| `GET` | `/v2/.well-known/jwks.json` | Public key for result tokens |
| `POST` | `/v2/documents/scan`, `/v2/documents/scan-only` | Server-side OCR |
| `POST` | `/v2/sdk-tokens` | Short-lived token for the browser or app, asked for by your backend |
| `GET` | `/v2/branding` | The tenant's web SDK branding |

**Back-office**: `/v2/admin/**`, see [docs/admin-api.md](docs/admin-api.md).

**Tenant portal**: `/v2/tenant/**`, see [docs/tenant-api.md](docs/tenant-api.md).

**Legacy (unchanged contracts)**: `/face-tech/sessions/**`, `/onboarding/**`, `/face/identify|verify|compare`, `/user/**`, `/api/v1/documents/**`, `/health`.

## Docker
The Dockerfile packages the pre-built jar, so build it first:
```bash
mvn -s .m2/settings.xml clean package -DskipTests
docker build -t camtech-service .
docker run -p 8080:8080 \
  -e CAMTECH_DATASOURCE_USERNAME=... -e CAMTECH_DATASOURCE_PASSWORD=... \
  -e DATASOURCE_URL=jdbc:oracle:thin:@<host>:1521/<service> \
  -e CAMTECH_OCI_ACCESS_KEY=... -e CAMTECH_OCI_SECRET_KEY=... \
  -e CAMTECH_RESULT_TOKEN_PRIVATE_KEY="$(cat result-token-key.pk8.pem)" \
  -e CAMTECH_FACE_MATCH_SERVICE_URL=http://<face-embedding-host>:8001 \
  -e CAMTECH_GOOGLE_APPLICATION_CREDENTIALS=/app/credentials.json \
  -v /path/to/service-account.json:/app/credentials.json:ro \
  camtech-service
```
Create the result-token key once per environment and keep it in the secret store:
```bash
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out result-token-key.pk8.pem
```

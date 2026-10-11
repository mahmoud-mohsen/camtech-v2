// Copy-paste code samples, pre-filled for the tenant. Never includes a secret: placeholders read env variables.

export interface SnippetContext {
  baseUrl: string;
  sdkUrl: string;
  tenantCode: string;
  /** Public key id of one of the tenant's apps, or a placeholder. */
  keyId: string;
  journey: string[];
  lang: 'en' | 'ar';
  /** Selfie ID verification only: true = register the face, false = verify only, undefined = the app's default. */
  enrollFace?: boolean;
}

export type SnippetLang = 'bash' | 'javascript' | 'typescript' | 'tsx' | 'java' | 'python' | 'html' | 'json' | 'http' | 'swift' | 'kotlin' | 'dart' | 'xml' | 'yaml';

export interface Snippet {
  key: string;
  label: string;
  lang: SnippetLang;
  code: string;
}

const journeyJs = (c: SnippetContext) => `[${c.journey.map((j) => `'${j}'`).join(', ')}]`;

/** The enrollFace option line for the SDK options (commented out when the app's default applies), or nothing. */
function enrollFaceJs(c: SnippetContext, indent: string): string {
  if (!c.journey.includes('SELFIE_ID_VERIFICATION')) return '';
  return c.enrollFace === undefined
    ? `
${indent}// enrollFace: false, // verify only; true = also register the face (needs face registration)`
    : `
${indent}enrollFace: ${c.enrollFace}, // ${c.enrollFace ? 'also register the face for face authentication' : 'verify only, never register the face'}`;
}

// ---------------------------------------------------------------- (a) backend creates an SDK token
export function sdkTokenSnippets(c: SnippetContext): Snippet[] {
  return [
    {
      key: 'curl',
      label: 'cURL',
      lang: 'bash',
      code: `curl -X POST "${c.baseUrl}/v2/sdk-tokens" \\
  -H "Content-Type: application/json" \\
  -H "X-Client-Id: ${c.keyId}" \\
  -H "X-Client-Secret: $CAMTECH_CLIENT_SECRET" \\
  -d '{ "subjectRef": "usr_8812", "ttlMinutes": 30 }'

# 201 Created
# {
#   "sdkToken": "eyJhbGciOi…",
#   "expiresAt": "2026-10-08T09:45:00Z",
#   "tenantCode": "${c.tenantCode}",
#   "clientAppCode": "…",
#   "subjectRef": "usr_8812"
# }`,
    },
    {
      key: 'node',
      label: 'Node.js',
      lang: 'javascript',
      code: `// Runs on YOUR backend. The client secret never reaches the browser or the app.
const CAMTECH_URL = '${c.baseUrl}';

export async function createSdkToken(userId) {
  const res = await fetch(\`\${CAMTECH_URL}/v2/sdk-tokens\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': '${c.keyId}',
      'X-Client-Secret': process.env.CAMTECH_CLIENT_SECRET,
    },
    body: JSON.stringify({ subjectRef: userId, ttlMinutes: 30 }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(\`CamTech \${res.status}: \${err.code ?? ''} \${err.message ?? ''}\`);
  }
  const { sdkToken, expiresAt } = await res.json();
  return { sdkToken, expiresAt }; // hand sdkToken to your front end
}`,
    },
    {
      key: 'java',
      label: 'Java',
      lang: 'java',
      code: `// Runs on YOUR backend (Java 17+, java.net.http). The client secret never reaches the browser or the app.
HttpClient http = HttpClient.newHttpClient();

String body = """
    { "subjectRef": "%s", "ttlMinutes": 30 }
    """.formatted(userId);

HttpRequest request = HttpRequest.newBuilder(URI.create("${c.baseUrl}/v2/sdk-tokens"))
    .header("Content-Type", "application/json")
    .header("X-Client-Id", "${c.keyId}")
    .header("X-Client-Secret", System.getenv("CAMTECH_CLIENT_SECRET"))
    .POST(HttpRequest.BodyPublishers.ofString(body))
    .build();

HttpResponse<String> response = http.send(request, HttpResponse.BodyHandlers.ofString());
if (response.statusCode() != 201 && response.statusCode() != 200) {
    throw new IllegalStateException("CamTech " + response.statusCode() + ": " + response.body());
}
// Parse with your JSON library: { "sdkToken": "...", "expiresAt": "...", ... }
JsonNode json = new ObjectMapper().readTree(response.body());
String sdkToken = json.get("sdkToken").asText();`,
    },
    {
      key: 'python',
      label: 'Python',
      lang: 'python',
      code: `# Runs on YOUR backend (pip install requests). The client secret never reaches the browser or the app.
import os
import requests

CAMTECH_URL = "${c.baseUrl}"


def create_sdk_token(user_id: str) -> dict:
    res = requests.post(
        f"{CAMTECH_URL}/v2/sdk-tokens",
        headers={
            "X-Client-Id": "${c.keyId}",
            "X-Client-Secret": os.environ["CAMTECH_CLIENT_SECRET"],
        },
        json={"subjectRef": user_id, "ttlMinutes": 30},
        timeout=10,
    )
    if res.status_code != 201:
        err = res.json() if res.content else {}
        raise RuntimeError(f"CamTech {res.status_code}: {err.get('code')} {err.get('message')}")
    body = res.json()
    return {"sdkToken": body["sdkToken"], "expiresAt": body["expiresAt"]}  # hand sdkToken to your front end`,
    },
  ];
}

// ---------------------------------------------------------------- (a2) the two endpoints your backend exposes
export function backendRoutesSnippets(c: SnippetContext): Snippet[] {
  return [
    {
      key: 'express',
      label: 'Node.js (Express)',
      lang: 'javascript',
      code: `// npm install express jose
// The two routes your web page or mobile app calls. Both need YOUR user to be signed in.
import express from 'express';
import { createRemoteJWKSet, jwtVerify } from 'jose';

const CAMTECH_URL = '${c.baseUrl}';
const jwks = createRemoteJWKSet(new URL(\`\${CAMTECH_URL}/v2/.well-known/jwks.json\`));
const app = express();
app.use(express.json());

// 1. Front end → your backend: "give me an SDK token for the signed-in user".
app.post('/api/kyc/sdk-token', requireLogin, async (req, res) => {
  const r = await fetch(\`\${CAMTECH_URL}/v2/sdk-tokens\`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Client-Id': '${c.keyId}',
      'X-Client-Secret': process.env.CAMTECH_CLIENT_SECRET,
    },
    body: JSON.stringify({ subjectRef: req.user.id, ttlMinutes: 30 }),
  });
  if (r.status !== 201) return res.status(502).json({ error: 'Could not start the verification' });
  const { sdkToken, expiresAt } = await r.json();
  res.json({ sdkToken, expiresAt });
});

// 2. Front end → your backend: "here is what the SDK returned" (onComplete payload).
app.post('/api/kyc/result', requireLogin, async (req, res) => {
  const outcomes = [];
  for (const result of req.body.results ?? []) {
    if (result.flow === 'DOCUMENT_SCAN') {
      outcomes.push({ flow: result.flow, scanId: result.scanId, fields: result.fields }); // OCR fields, no token
      continue;
    }
    if (!result.resultToken) continue; // no decision yet
    // Never trust result.decision: read it from the signed token.
    const { payload } = await jwtVerify(result.resultToken, jwks, { issuer: 'camtech', algorithms: ['RS256'] });
    if (payload.sub !== undefined && payload.sub !== req.user.id) return res.status(403).end();
    outcomes.push({ flow: payload.flow, sessionId: payload.sid, decision: payload.decision });
    // APPROVED → mark the user verified · REVIEW → wait for the REVIEW_DECIDED webhook · REJECTED → offer a retry
  }
  await saveKycOutcome(req.user.id, outcomes);
  res.json({ outcomes });
});`,
    },
    {
      key: 'spring',
      label: 'Java (Spring Boot)',
      lang: 'java',
      code: `// com.nimbusds:nimbus-jose-jwt + spring-boot-starter-web
@RestController
@RequestMapping("/api/kyc")
class KycController {
    private static final String CAMTECH_URL = "${c.baseUrl}";
    private final RestClient camtech = RestClient.builder()
        .baseUrl(CAMTECH_URL)
        .defaultHeader("X-Client-Id", "${c.keyId}")
        .defaultHeader("X-Client-Secret", System.getenv("CAMTECH_CLIENT_SECRET"))
        .build();
    private final ConfigurableJWTProcessor<SecurityContext> jwt = new DefaultJWTProcessor<>();

    KycController() throws Exception {
        JWKSource<SecurityContext> keys = JWKSourceBuilder.create(new URL(CAMTECH_URL + "/v2/.well-known/jwks.json")).build();
        jwt.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keys));
        jwt.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(
            new JWTClaimsSet.Builder().issuer("camtech").build(), Set.of("sid", "decision", "exp")));
    }

    // 1. Front end → your backend: an SDK token for the signed-in user.
    @PostMapping("/sdk-token")
    Map<String, Object> sdkToken(@AuthenticationPrincipal User user) {
        Map<?, ?> body = camtech.post().uri("/v2/sdk-tokens")
            .contentType(MediaType.APPLICATION_JSON)
            .body(Map.of("subjectRef", user.getId(), "ttlMinutes", 30))
            .retrieve().body(Map.class);
        return Map.of("sdkToken", body.get("sdkToken"), "expiresAt", body.get("expiresAt"));
    }

    // 2. Front end → your backend: the SDK's onComplete payload.
    @PostMapping("/result")
    List<Map<String, Object>> result(@AuthenticationPrincipal User user, @RequestBody JsonNode payload) throws Exception {
        List<Map<String, Object>> outcomes = new ArrayList<>();
        for (JsonNode r : payload.path("results")) {
            if (r.path("resultToken").isMissingNode() || r.path("resultToken").isNull()) continue; // document scans
            JWTClaimsSet claims = jwt.process(r.get("resultToken").asText(), null); // throws if invalid or expired
            if (claims.getSubject() != null && !claims.getSubject().equals(user.getId())) {
                throw new ResponseStatusException(HttpStatus.FORBIDDEN);
            }
            outcomes.add(Map.of(
                "flow", claims.getStringClaim("flow"),
                "sessionId", claims.getStringClaim("sid"),
                "decision", claims.getStringClaim("decision"))); // APPROVED | REVIEW | REJECTED
        }
        return outcomes;
    }
}`,
    },
    {
      key: 'session',
      label: 'Alternative: start the session yourself',
      lang: 'javascript',
      code: `// Instead of an SDK token, your backend can start a selfie ID verification itself and hand the
// browser or app only that one session. Useful when you want to fix documentType or enrollFace server-side.
const r = await fetch(\`\${CAMTECH_URL}/v2/selfie-verifications\`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-Client-Id': '${c.keyId}',
    'X-Client-Secret': process.env.CAMTECH_CLIENT_SECRET,
  },
  body: JSON.stringify({ subjectRef: user.id, documentType: 'EMIRATES_ID', enrollFace: false }),
});
const { sessionId, sessionToken, expiresAt } = await r.json(); // 201; expires in 15 minutes by default

// Front end: pass both instead of sdkToken
//   Camtech.init({ ..., sessionId, sessionToken })            (embed / npm)
//   ${c.sdkUrl}/?lang=${c.lang}#sessionId=…&sessionToken=…    (hosted page)
// Only SELFIE_ID_VERIFICATION runs with a session; other journeys need an SDK token.`,
    },
  ];
}

// ---------------------------------------------------------------- (b) front end
/** Hosted-page query string for the journey, language and enrollFace. */
export function hostedQuery(c: SnippetContext): string {
  const enroll = c.journey.includes('SELFIE_ID_VERIFICATION') && c.enrollFace !== undefined ? `&enrollFace=${c.enrollFace}` : '';
  return `journey=${c.journey.join(',')}&lang=${c.lang}${enroll}`;
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url;
  }
}

const callbacksJs = (indent: string) => `${indent}onComplete: async (result) => {
${indent}  // One entry per flow. Send it to YOUR backend and verify the resultToken(s) there.
${indent}  await fetch('/api/kyc/result', {
${indent}    method: 'POST',
${indent}    headers: { 'Content-Type': 'application/json' },
${indent}    body: JSON.stringify(result),
${indent}  });
${indent}},
${indent}onCancel: (info) => console.log('User left at', info.step),
${indent}onError: (err) => {
${indent}  // err.fatal = the SDK cannot continue (expired token, flow not allowed, …): get a new token or hide the feature
${indent}  console.error(err.code, err.message);
${indent}},`;

export function frontendSnippets(c: SnippetContext): Snippet[] {
  const enrollParam =
    c.journey.includes('SELFIE_ID_VERIFICATION') && c.enrollFace !== undefined
      ? `
url.searchParams.set('enrollFace', '${c.enrollFace}'); // ${c.enrollFace ? 'also register the face' : 'verify only'}`
      : '';
  return [
    {
      key: 'redirect',
      label: 'Hosted page',
      lang: 'javascript',
      code: `// The simplest option: nothing to install. Send the user to the hosted CamTech page; it comes back to returnUrl.
const { sdkToken } = await fetch('/api/kyc/sdk-token', { method: 'POST' }).then((r) => r.json());

const url = new URL('${c.sdkUrl}/');
url.searchParams.set('journey', '${c.journey.join(',')}');
url.searchParams.set('lang', '${c.lang}');${enrollParam}
url.searchParams.set('returnUrl', 'https://your-app.example/kyc/done'); // http(s) only
url.hash = \`sdkToken=\${encodeURIComponent(sdkToken)}\`; // the fragment is never sent to any server

window.location.assign(url.toString());

// At the end the browser lands on:
//   https://your-app.example/kyc/done?camtechSessionId=…&camtechStatus=completed | cancelled | failed
// The result token is never put in a URL: your backend reads the result (see "Hosted page: handle the return").`,
    },
    {
      key: 'return',
      label: 'Hosted page: handle the return',
      lang: 'javascript',
      code: `// Your backend route for returnUrl. The query string only says which session ended and how:
// read the decision yourself, never from the URL.
app.get('/kyc/done', requireLogin, async (req, res) => {
  const { camtechSessionId, camtechStatus } = req.query;
  if (camtechStatus !== 'completed' || !camtechSessionId) return res.redirect('/kyc?retry=1');

  // Selfie ID verification: read the result with your credentials.
  const r = await fetch(\`${c.baseUrl}/v2/selfie-verifications/\${encodeURIComponent(camtechSessionId)}/result\`, {
    headers: { 'X-Client-Id': '${c.keyId}', 'X-Client-Secret': process.env.CAMTECH_CLIENT_SECRET },
  });
  const { resultToken } = await r.json();
  const claims = await verifyResult(resultToken, req.user.id); // see "Verify the result"
  await saveKycOutcome(req.user.id, claims.decision);           // APPROVED | REVIEW | REJECTED
  res.redirect(\`/kyc/status?decision=\${claims.decision}\`);
});

// Other journeys (face authentication, liveness check, face registration): rely on the
// SESSION_COMPLETED webhook, which carries sessionId, subjectRef and decision and is signed.`,
    },
    {
      key: 'script',
      label: 'Modal (script tag)',
      lang: 'html',
      code: `<script src="${c.sdkUrl}/camtech-sdk.js"></script>
<button id="verify">Verify my identity</button>

<script>
  document.getElementById('verify').addEventListener('click', async () => {
    // Ask YOUR backend for a short-lived SDK token (see "Backend").
    const { sdkToken } = await fetch('/api/kyc/sdk-token', { method: 'POST' }).then((r) => r.json());

    const sdk = Camtech.init({
      mode: 'modal',
      apiBaseUrl: '${c.baseUrl}',
      sdkToken,
      journey: ${journeyJs(c)},${enrollFaceJs(c, '      ')}
      lang: '${c.lang}',
${callbacksJs('      ')}
    });
    sdk.open(); // a modal only appears after open(); also close(), destroy(), setLang('ar')
  });
</script>`,
    },
    {
      key: 'inline',
      label: 'Inline (script tag)',
      lang: 'html',
      code: `<script src="${c.sdkUrl}/camtech-sdk.js"></script>
<!-- The SDK fills this element. Give it room: at least ~600 px high on desktop. -->
<div id="kyc" style="max-width: 480px; min-height: 600px; margin: 0 auto"></div>

<script>
  (async () => {
    const { sdkToken } = await fetch('/api/kyc/sdk-token', { method: 'POST' }).then((r) => r.json());

    const sdk = Camtech.init({
      mode: 'inline',          // mounts straight away, no open() needed
      container: '#kyc',       // element or CSS selector
      apiBaseUrl: '${c.baseUrl}',
      sdkToken,
      journey: ${journeyJs(c)},${enrollFaceJs(c, '      ')}
      lang: '${c.lang}',
${callbacksJs('      ')}
    });
    // sdk.destroy() when the user leaves the page
  })();
</script>`,
    },
    {
      key: 'iframe',
      label: 'iframe',
      lang: 'html',
      code: `<!-- Strongest isolation: the SDK runs on the CamTech origin inside an iframe.
     The token is sent by postMessage after a handshake, never in the URL.
     Allowed origins: add ${originOf(c.sdkUrl)} (the SDK host). -->
<script src="${c.sdkUrl}/camtech-sdk.js"></script>
<div id="kyc"></div>

<script>
  (async () => {
    const { sdkToken } = await fetch('/api/kyc/sdk-token', { method: 'POST' }).then((r) => r.json());

    Camtech.init({
      mode: 'iframe',
      hostedUrl: '${c.sdkUrl}/',
      container: '#kyc',       // omit for a full-screen iframe (then call .open())
      sdkToken,
      journey: ${journeyJs(c)},${enrollFaceJs(c, '      ')}
      lang: '${c.lang}',
${callbacksJs('      ')}
    });
  })();
</script>`,
    },
    {
      key: 'npm',
      label: 'npm',
      lang: 'typescript',
      code: `// npm install @camtech/sdk   (distributed by CamTech; use the script tag if you don't have access to the package)
import { mount, type CompletePayload } from '@camtech/sdk';

const { sdkToken } = await fetch('/api/kyc/sdk-token', { method: 'POST' }).then((r) => r.json());

const handle = mount(document.getElementById('kyc')!, {
  apiBaseUrl: '${c.baseUrl}',
  sdkToken,
  journey: ${journeyJs(c)},${enrollFaceJs(c, '  ')}
  lang: '${c.lang}',
  onComplete: (result: CompletePayload) => {
    void fetch('/api/kyc/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
  },
  onError: (err) => console.error(err.code, err.message),
});

handle.setLang('ar');   // switch language at any time
handle.unmount();       // when the user navigates away (also frees the camera)`,
    },
    {
      key: 'react',
      label: 'React',
      lang: 'tsx',
      code: `import { useEffect, useRef } from 'react';
import { mount, type CompletePayload } from '@camtech/sdk';

export function IdentityVerification({ onDone }: { onDone: (result: CompletePayload) => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let handle: { unmount: () => void } | undefined;
    let cancelled = false;
    (async () => {
      const { sdkToken } = await fetch('/api/kyc/sdk-token', { method: 'POST' }).then((r) => r.json());
      if (cancelled || !ref.current) return;
      handle = mount(ref.current, {
        apiBaseUrl: '${c.baseUrl}',
        sdkToken,
        journey: ${journeyJs(c)},${enrollFaceJs(c, '        ')}
        lang: '${c.lang}',
        onComplete: async (result) => {
          await fetch('/api/kyc/result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(result) });
          onDone(result);
        },
      });
    })();
    return () => {
      cancelled = true;
      handle?.unmount();
    };
  }, [onDone]);

  return <div ref={ref} style={{ minHeight: 600 }} />;
}`,
    },
  ];
}

// ---------------------------------------------------------------- (c) verify the result token
export function verifyTokenSnippets(c: SnippetContext): Snippet[] {
  return [
    {
      key: 'node',
      label: 'Node.js (jose)',
      lang: 'javascript',
      code: `import { createRemoteJWKSet, jwtVerify } from 'jose';

// Cached and refreshed by jose; the key id is in the token header (kid).
const jwks = createRemoteJWKSet(new URL('${c.baseUrl}/v2/.well-known/jwks.json'));

export async function verifyResult(resultToken, expectedUserId) {
  const { payload } = await jwtVerify(resultToken, jwks, {
    issuer: 'camtech',
    algorithms: ['RS256'],
  }); // throws when the signature is wrong or the token has expired (10 minutes)

  // sub is your subjectRef. It is missing only for a liveness check started without one.
  if (payload.sub !== undefined && payload.sub !== expectedUserId) throw new Error('Result belongs to another user');
  // payload.sid = session id, payload.flow = the journey, payload.decision = APPROVED | REVIEW | REJECTED
  return payload;
}`,
    },
    {
      key: 'java',
      label: 'Java (Nimbus)',
      lang: 'java',
      code: `// com.nimbusds:nimbus-jose-jwt
JWKSource<SecurityContext> keys = JWKSourceBuilder
    .create(new URL("${c.baseUrl}/v2/.well-known/jwks.json"))
    .build();

ConfigurableJWTProcessor<SecurityContext> processor = new DefaultJWTProcessor<>();
processor.setJWSKeySelector(new JWSVerificationKeySelector<>(JWSAlgorithm.RS256, keys));
processor.setJWTClaimsSetVerifier(new DefaultJWTClaimsVerifier<>(
    new JWTClaimsSet.Builder().issuer("camtech").build(),
    Set.of("sid", "flow", "decision", "exp"))); // sub is absent for a liveness check without subjectRef

JWTClaimsSet claims = processor.process(resultToken, null); // throws if invalid or expired
if (claims.getSubject() != null && !claims.getSubject().equals(expectedUserId)) {
    throw new SecurityException("Result belongs to another user");
}
String decision = claims.getStringClaim("decision"); // APPROVED | REVIEW | REJECTED`,
    },
    {
      key: 'python',
      label: 'Python (PyJWT)',
      lang: 'python',
      code: `# pip install "pyjwt[crypto]"
import jwt

jwks = jwt.PyJWKClient("${c.baseUrl}/v2/.well-known/jwks.json")  # caches the keys


def verify_result(result_token: str, expected_user_id: str) -> dict:
    key = jwks.get_signing_key_from_jwt(result_token)
    claims = jwt.decode(
        result_token,
        key.key,
        algorithms=["RS256"],
        issuer="camtech",
        options={"require": ["exp", "iss", "sid", "decision"]},
    )  # raises when the signature is wrong or the token has expired
    if "sub" in claims and claims["sub"] != expected_user_id:
        raise PermissionError("Result belongs to another user")
    return claims  # claims["decision"]: APPROVED | REVIEW | REJECTED`,
    },
    {
      key: 'claims',
      label: 'Claims',
      lang: 'json',
      code: `{
  "iss": "camtech",
  "sub": "usr_8812",                 // your subjectRef (absent for a liveness check started without one)
  "sid": "3b6e1c0a-58d2-4f0e-9c1b-7a4e2c9d9f2d", // session id
  "flow": "SELFIE_ID_VERIFICATION",  // or FACE_AUTHENTICATION, LIVENESS_CHECK, FACE_ENROLLMENT
  "decision": "APPROVED",            // APPROVED | REVIEW | REJECTED
  "decidedBy": "SYSTEM",             // selfie ID verification only
  "documentType": "EMIRATES_ID",     // selfie ID verification only
  "personId": "8f3a1d2e-…",          // selfie ID verification only
  "iat": 1791450138,
  "exp": 1791450738,                 // 10 minutes after iat
  "jti": "0b7c…"
}`,
    },
  ];
}

// ---------------------------------------------------------------- (d) webhooks: verify signatures
export function webhookSignatureSnippets(): Snippet[] {
  return [
    {
      key: 'node',
      label: 'Node.js',
      lang: 'javascript',
      code: `import crypto from 'node:crypto';
import express from 'express';

const SECRET = process.env.CAMTECH_WEBHOOK_SECRET;
const TOLERANCE_SECONDS = 5 * 60;
const app = express();

// Use the RAW body: re-serialised JSON will not match the signature.
app.post('/hooks/camtech', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('X-Camtech-Signature') ?? '';
  const parts = Object.fromEntries(header.split(',').map((p) => p.trim().split('=')));
  const t = Number(parts.t);
  if (!Number.isInteger(t) || Math.abs(Date.now() / 1000 - t) > TOLERANCE_SECONDS) {
    return res.status(400).send('stale or missing timestamp');
  }

  const expected = crypto.createHmac('sha256', SECRET).update(\`\${parts.t}.\`).update(req.body).digest();
  const given = Buffer.from(parts.v1 ?? '', 'hex');
  if (given.length !== expected.length || !crypto.timingSafeEqual(expected, given)) {
    return res.status(401).send('bad signature');
  }

  const event = JSON.parse(req.body.toString('utf8'));
  // The same event can arrive twice: de-duplicate on X-Camtech-Delivery.
  console.log(req.get('X-Camtech-Delivery'), event.eventType, event.data.sessionId, event.data.decision);
  res.sendStatus(204); // reply 2xx within 10 seconds
});`,
    },
    {
      key: 'java',
      label: 'Java',
      lang: 'java',
      code: `import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;

public final class CamtechSignature {
    private static final long TOLERANCE_SECONDS = 5 * 60;

    /** header = X-Camtech-Signature, rawBody = the exact bytes received. */
    public static boolean verify(String header, byte[] rawBody, String secret) throws Exception {
        String t = null, v1 = null;
        for (String part : header.split(",")) {
            String[] kv = part.trim().split("=", 2);
            if (kv.length != 2) continue;
            if (kv[0].equals("t")) t = kv[1];
            else if (kv[0].equals("v1")) v1 = kv[1];
        }
        if (t == null || v1 == null || !t.matches("\\\\d+")) return false;
        if (Math.abs(Instant.now().getEpochSecond() - Long.parseLong(t)) > TOLERANCE_SECONDS) return false;

        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        mac.update((t + ".").getBytes(StandardCharsets.UTF_8));
        byte[] expected = mac.doFinal(rawBody);

        byte[] given;
        try {
            given = HexFormat.of().parseHex(v1);
        } catch (IllegalArgumentException e) {
            return false;
        }
        return MessageDigest.isEqual(expected, given); // constant time
    }
}`,
    },
    {
      key: 'python',
      label: 'Python',
      lang: 'python',
      code: `import hashlib
import hmac
import time

TOLERANCE_SECONDS = 5 * 60


def verify(header: str, raw_body: bytes, secret: str) -> bool:
    """header = X-Camtech-Signature, raw_body = the exact bytes received."""
    parts = dict(p.strip().split("=", 1) for p in header.split(",") if "=" in p)
    t, v1 = parts.get("t"), parts.get("v1")
    if not t or not v1 or not t.isdigit():
        return False
    if abs(time.time() - int(t)) > TOLERANCE_SECONDS:
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)  # constant time


# Flask:
# @app.post("/hooks/camtech")
# def camtech_hook():
#     if not verify(request.headers.get("X-Camtech-Signature", ""), request.get_data(), SECRET):
#         abort(401)
#     event = request.get_json()
#     return "", 204`,
    },
  ];
}

export function webhookPayloadSample(): Snippet {
  return {
    key: 'payload',
    label: 'Request',
    lang: 'http',
    code: `POST /hooks/camtech HTTP/1.1
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
}`,
  };
}

/** REVIEW_DECIDED: decidedBy says who decided (your reviewer or CamTech); reviewer is set when your team decided. */
export function reviewDecidedPayloadSample(): Snippet {
  return {
    key: 'review-decided',
    label: 'REVIEW_DECIDED',
    lang: 'json',
    code: `{
  "eventType": "REVIEW_DECIDED",
  "occurredAt": "2026-10-08T10:41:07Z",
  "data": {
    "sessionId": "3b6e1c0a-…",
    "flow": "SELFIE_ID_VERIFICATION",
    "status": "COMPLETED",
    "decision": "APPROVED",
    "subjectRef": "usr_8812",
    "reviewCaseId": 812,
    "decidedBy": "TENANT",
    "reviewer": "sara.n"
  }
}`,
  };
}


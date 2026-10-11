// "Reference" tab of the integration guide: SDK options, callbacks, steps, error codes, troubleshooting and go-live checklist.
import { Checkbox, Col, Flex, Row, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { Code, RefTable, Section } from './parts';

const OPTIONS: [string, string, string][] = [
  ['apiBaseUrl', 'string', 'The CamTech API, e.g. https://<host>/camtech-service. Required for modal, inline and npm (the iframe and hosted page use their own).'],
  ['sdkToken', 'string', 'Short-lived token from your backend (POST /v2/sdk-tokens). Allows every flow of the app.'],
  ['sessionId + sessionToken', 'string', 'Instead of sdkToken: a selfie ID verification your backend already started.'],
  ['journey', 'JourneyFlow[]', 'Flows to run, in order. Default [SELFIE_ID_VERIFICATION]. Flows the app may not use are skipped.'],
  ['subjectRef', 'string', 'Your user id. Required for FACE_AUTHENTICATION and FACE_ENROLLMENT unless the SDK token carries it.'],
  ['lang', "'en' | 'ar'", "Default 'en'. Arabic is right to left. Change later with setLang()."],
  ['documentType', "'EMIRATES_ID' | 'PASSPORT'", 'Skip the document choice of the selfie ID verification.'],
  ['enrollFace', 'boolean', 'Selfie ID verification: true = also register the face, false = verify only, omitted = the app default.'],
  ['scanTypes', "('EMIRATES_ID' | 'PASSPORT' | 'TRADE_LICENCE')[]", 'Documents offered by DOCUMENT_SCAN. Default: all three.'],
  ['branding', 'Partial<Branding>', 'Overrides on top of the branding set on the Branding page.'],
  ['debug', 'boolean', 'Emit onEvent for every API call (method, path, status, duration).'],
  ['mode', "'modal' | 'inline' | 'iframe'", 'Script tag (Camtech.init) only. Default modal: call open().'],
  ['container', 'HTMLElement | string', 'inline (required) and iframe (optional): where to render.'],
  ['hostedUrl', 'string', 'iframe only: the hosted SDK page URL.'],
  ['autoClose', 'boolean', 'Close the modal after complete or cancel. Default true.'],
];

const CALLBACKS: [string, string][] = [
  ['onReady()', 'The SDK is loaded and showing its first screen.'],
  ['onStep({ flow, step })', 'The user moved to another screen (see the steps below). Useful for analytics.'],
  ['onComplete({ results })', 'The journey ended. One entry per flow: { flow, sessionId, status, decision, resultToken, resultTokenExpiresAt } or, for DOCUMENT_SCAN, { flow, documentType, scanId, scanIds, fields, editedFields }.'],
  ['onCancel({ flow, step, sessionId })', 'The user closed the SDK before the end.'],
  ['onError({ code, message, fatal, flow, status })', 'Something went wrong. fatal = the SDK cannot continue (configuration, expired token…); otherwise the SDK already shows a retry screen.'],
  ['onEvent(event)', 'Debug events (with debug: true).'],
];

const STEPS =
  'LOADING · WELCOME · CAMERA_PERMISSION · CAMERA_PROBLEM · LIVENESS · LIVENESS_UPLOAD · DOCUMENT_CHOICE · DOCUMENT_FORMAT · DOCUMENT_CAPTURE · DOCUMENT_READING · DOCUMENT_CONFIRM · DOCUMENT_UPLOAD · DOCUMENT_RESCAN · SCAN_RESULT · UNDER_REVIEW · RESULT · ERROR';

const ERRORS: [string, string, string][] = [
  ['401', 'CLIENT_AUTH_REQUIRED, CLIENT_AUTH_INVALID', 'Your backend sent no or wrong X-Client-Id / X-Client-Secret. Check the key is active.'],
  ['401', 'SDK_TOKEN_INVALID, SDK_TOKEN_EXPIRED', 'Get a new SDK token from your backend and start again (tokens last 30 minutes by default, 60 at most).'],
  ['401', 'SESSION_TOKEN_INVALID', 'Wrong or missing session token: start again.'],
  ['403', 'ORIGIN_NOT_ALLOWED', 'The page origin is not in the app’s allowed origins (web apps).'],
  ['403', 'SDK_TOKEN_NOT_ALLOWED', 'SDK tokens only work on the end-user endpoints; call the others from your backend.'],
  ['403', 'SUBJECT_MISMATCH', 'The SDK token was issued for another subjectRef.'],
  ['403', 'FEATURE_NOT_ENABLED, FEATURE_NOT_ALLOWED', 'The flow is not in your plan or not allowed for this app: check the app permissions.'],
  ['403', 'TENANT_SUSPENDED', 'The account is suspended: contact CamTech.'],
  ['404', 'NO_ENROLLED_FACE', 'Face authentication for a user who never registered a face.'],
  ['404 / 410', 'SESSION_NOT_FOUND, SESSION_EXPIRED', 'Start a new verification (sessions last 15 minutes by default).'],
  ['409', 'FACE_ALREADY_ENROLLED', 'Face registration for a user who already has a face.'],
  ['409', 'LIVENESS_REQUIRED, ALREADY_VERIFIED, SESSION_CLOSED', 'Read the session state and continue from nextStep.'],
  ['400 / 409', 'CHALLENGE_REQUIRED, CHALLENGE_INVALID, CHALLENGE_EXPIRED', 'Ask for a new liveness challenge; no attempt is used.'],
  ['413', 'FILE_TOO_LARGE', 'Compress the image (10 MB per image, 25 MB per request).'],
  ['422', 'TOO_DARK, TOO_BRIGHT, BLURRY, FACE_TOO_SMALL, MULTIPLE_FACES, HEAD_TURNED, HEAD_TILTED, NO_FACE, FACE_CHANGED, SPOOF_SUSPECTED, CHALLENGE_FAILED, FACE_NOT_VISIBLE', 'Selfie problem: show message, retake if nextStep = LIVENESS.'],
  ['422', 'ID_NUMBER_INVALID, MRZ_INVALID, ID_EXPIRED, PASSPORT_EXPIRED', 'Document problem: show message, rescan if nextStep = DOCUMENT.'],
  ['429', 'TOO_MANY_ATTEMPTS', 'No attempts left: offer to start again.'],
  ['429', 'QUOTA_EXCEEDED', 'Daily quota reached: try later.'],
  ['502 / 503', 'FACE_SERVICE_ERROR, FACE_SERVICE_UNAVAILABLE, LIVENESS_UNAVAILABLE', 'Temporary: retry after a few seconds; the attempt is not lost.'],
  ['SDK', 'SUBJECT_REF_REQUIRED', 'FACE_AUTHENTICATION or FACE_ENROLLMENT without a subjectRef (option or SDK token): the flow is skipped.'],
];

const TROUBLESHOOTING: [string, string][] = [
  ['The modal does not appear', 'Camtech.init() returns a handle: call .open() on it. Inline and iframe-with-container open by themselves.'],
  ['Calls go to localhost or the wrong server', 'Pass apiBaseUrl (not baseUrl) to Camtech.init / mount.'],
  ['403 ORIGIN_NOT_ALLOWED', 'Add the exact origin (scheme + host + port, no path) to the app on the Apps page. Hosted page and iframe: add the SDK host instead of your site.'],
  ['401 CLIENT_AUTH_INVALID on /v2/sdk-tokens', 'The key id and secret do not belong together, the key was revoked, or the secret has spaces or line breaks from copying.'],
  ['The camera never starts', 'The page must be https (or localhost), the browser permission granted, and no other app using the camera. In an iframe the SDK adds allow="camera".'],
  ['SDK_TOKEN_EXPIRED mid-journey', 'Create the token when the user clicks Verify, not when the page loads. ttlMinutes can go up to 60.'],
  ['Blocked by Content-Security-Policy', 'Allow script-src for the SDK host, cdn.jsdelivr.net and \'wasm-unsafe-eval\'; connect-src for the API, cdn.jsdelivr.net and storage.googleapis.com; media-src blob:; img-src data: blob:.'],
  ['The result token fails verification', 'Check iss = "camtech", RS256, the JWKS URL of the same environment, and that the token is less than 10 minutes old. Do not require sub for a liveness check started without subjectRef.'],
  ['The webhook signature never matches', 'Compute the HMAC over the raw request bytes, not re-serialised JSON, with the secret of that endpoint.'],
];

const GO_LIVE = [
  'The client secret lives only in your backend’s secret store, never in a web page, app bundle or repository',
  'Your backend creates one SDK token per verification, bound to your user id (subjectRef)',
  'Your backend verifies every resultToken (signature, issuer, expiry, sub) before trusting the decision',
  'REVIEW decisions wait for the REVIEW_DECIDED webhook; the webhook endpoint checks the signature and de-duplicates',
  'Allowed origins list only your production origins (web apps)',
  'Errors are handled: expired token, flow not allowed, user cancelled, camera denied',
  'Tested on real devices: iOS Safari, Android Chrome and your WebView screens, in English and Arabic',
  'API base URL, SDK URL and keys switched from the test to the production environment',
];

export function ReferenceTab() {
  return (
    <Flex vertical gap={28}>
      <Section title="SDK options (Camtech.init / mount / hosted page)">
        <RefTable columns={['Option', 'Type', 'Meaning']} rows={OPTIONS.map(([o, t, m]) => [o, <Typography.Text type="secondary" key={o} style={{ fontSize: 12 }}>{t}</Typography.Text>, m])} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Hosted page query parameters: <Code>journey</Code> (comma-separated), <Code>subjectRef</Code>, <Code>lang</Code>, <Code>documentType</Code>, <Code>enrollFace</Code>, <Code>scanTypes</Code>,{' '}
          <Code>returnUrl</Code>, <Code>debug=1</Code>. Secrets only in the fragment: <Code>#sdkToken=…</Code> or <Code>#sessionId=…&amp;sessionToken=…</Code>.
        </Typography.Text>
      </Section>

      <Row gutter={[24, 24]}>
        <Col xs={24} xl={14}>
          <Section title="Callbacks">
            <RefTable columns={['Callback', 'When']} rows={CALLBACKS.map(([c, w]) => [c, w])} />
          </Section>
        </Col>
        <Col xs={24} xl={10}>
          <Section title="Handle methods">
            <RefTable
              columns={['Method', 'What it does']}
              rows={[
                ['open()', 'Show the SDK (modal), or mount it again after close()'],
                ['close()', 'Remove the UI; opening again in the same tab resumes'],
                ['destroy()', 'Free everything (listeners, face models)'],
                ['setLang(lang)', "Switch between 'en' and 'ar'"],
                ['unmount()', 'npm mount() only: remove and free the camera'],
              ]}
            />
          </Section>
          <Section title="Steps (onStep)">
            <Typography.Text type="secondary" style={{ fontSize: 12.5, lineHeight: 1.8 }}>
              {STEPS}
            </Typography.Text>
          </Section>
        </Col>
      </Row>

      <Row gutter={[24, 24]}>
        <Col xs={24} xl={12}>
          <Section title="Session status">
            <RefTable
              columns={['status', 'Meaning']}
              rows={[
                ['CREATED', 'Started, nothing uploaded yet'],
                ['IN_PROGRESS', 'At least one upload done'],
                ['COMPLETED', 'A decision exists'],
                ['FAILED', 'Attempts used up, no decision'],
                ['EXPIRED', 'Not finished in time (15 minutes by default)'],
                ['CANCELLED', 'Cancelled by the user or an operator'],
              ]}
            />
          </Section>
        </Col>
        <Col xs={24} xl={12}>
          <Section title="Decision">
            <RefTable
              columns={['decision', 'What to show']}
              rows={[
                ['APPROVED', 'Verified'],
                ['REVIEW', '“We are checking your verification.” A reviewer decides: REVIEW_DECIDED webhook.'],
                ['REJECTED', 'Not verified. The user can start a new verification.'],
              ]}
            />
          </Section>
        </Col>
      </Row>

      <Section title="Error codes">
        <RefTable codeFirst={false} columns={['HTTP', 'Code', 'What to do']} rows={ERRORS.map(([h, c, w]) => [h, <Typography.Text code key={c} style={{ whiteSpace: 'normal' }}>{c}</Typography.Text>, w])} />
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          Every error body is <Code>{'{ code, message, step, attemptsRemaining, nextStep }'}</Code>. Drive your logic from <Code>code</Code>; <Code>message</Code> is ready to show, in the requested language.
          All texts are on the <Link to="/guide?tab=reasons">Reason codes</Link> tab.
        </Typography.Text>
      </Section>

      <Row gutter={[24, 24]}>
        <Col xs={24} xl={14}>
          <Section title="Troubleshooting">
            <RefTable codeFirst={false} columns={['Symptom', 'Fix']} rows={TROUBLESHOOTING.map(([s, f]) => [<Typography.Text strong key={s}>{s}</Typography.Text>, f])} />
          </Section>
        </Col>
        <Col xs={24} xl={10}>
          <Section title="Go-live checklist">
            <Flex vertical gap={8}>
              {GO_LIVE.map((item) => (
                <Checkbox key={item}>{item}</Checkbox>
              ))}
            </Flex>
          </Section>
        </Col>
      </Row>
    </Flex>
  );
}

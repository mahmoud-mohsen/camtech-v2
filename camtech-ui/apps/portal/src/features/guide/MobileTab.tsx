// "Mobile apps" tab of the integration guide: the web SDK in a WebView (bridge page or hosted page), or the native API.
import { AndroidOutlined, AppleOutlined, MobileOutlined } from '@ant-design/icons';
import { Alert, Col, Flex, Row, Segmented, Typography } from 'antd';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { CodeBlock, SnippetTabs } from '../../components/CodeBlock';
import { bridgePageSnippet, MOBILE_ALLOWED_ORIGINS, nativeApiSnippets, webViewSnippets, webViewUrls, type MobilePlatform } from '../../lib/mobileSnippets';
import type { SnippetContext } from '../../lib/snippets';
import { useSearchState } from '../../lib/useSearchState';
import { Code, Muted, RefTable, Section, Step } from './parts';

const PLATFORMS: { value: MobilePlatform; label: string; icon: ReactNode }[] = [
  { value: 'ios', label: 'iOS (Swift)', icon: <AppleOutlined /> },
  { value: 'android', label: 'Android (Kotlin)', icon: <AndroidOutlined /> },
  { value: 'react-native', label: 'React Native', icon: <MobileOutlined /> },
  { value: 'flutter', label: 'Flutter', icon: <MobileOutlined /> },
];

export function MobileTab({ ctx, appChannel }: { ctx: SnippetContext; appChannel?: string }) {
  const { values, set } = useSearchState(['mobile', 'platform'] as const);
  const approach = values.mobile === 'native' ? 'native' : 'webview';
  const platform = (PLATFORMS.find((p) => p.value === values.platform)?.value ?? 'ios') as MobilePlatform;
  const origins = MOBILE_ALLOWED_ORIGINS(ctx);
  const urls = webViewUrls(ctx);

  return (
    <Flex vertical gap={24}>
      <Alert
        type="info"
        showIcon
        title="One SDK for web and mobile"
        description={
          <>
            CamTech does not ship separate iOS or Android libraries. Mobile apps run the same web SDK inside a WebView: the camera guidance, active liveness, document capture, Arabic and your
            branding all work as on the web, and SDK updates reach your app without a new release. Apps that want their own screens can call the REST API directly instead.
          </>
        }
      />

      <Segmented
        value={approach}
        onChange={(v) => set({ mobile: v === 'native' ? 'native' : null })}
        options={[
          { value: 'webview', label: 'WebView + web SDK (recommended)' },
          { value: 'native', label: 'Native screens + REST API' },
        ]}
        style={{ alignSelf: 'flex-start' }}
        aria-label="Mobile integration approach"
      />

      {approach === 'webview' ? (
        <>
          <Row gutter={[24, 16]}>
            <Col xs={24} lg={12}>
              <Flex vertical gap={14}>
                <Step n={1} title="Your app asks your backend for an SDK token">
                  The same <Code>POST /api/kyc/sdk-token</Code> route as the web (see <Link to="/guide?tab=backend">Backend</Link>). Use the API key of a <b>mobile</b> app. The client secret never goes in
                  the app bundle.
                </Step>
                <Step n={2} title="It opens a WebView on the verification page">
                  Your small bridge page, or the hosted CamTech page, with the token in the URL fragment.
                </Step>
                <Step n={3} title="The SDK runs the journey and the WebView reports back">
                  <Code>complete</Code>, <Code>cancel</Code> or a fatal <Code>error</Code> arrive in native code; the WebView is closed.
                </Step>
                <Step n={4} title="Your backend verifies the result">
                  The app forwards the payload; your backend checks each <Code>resultToken</Code> (see <Link to="/guide?tab=verify">Verify the result</Link>).
                </Step>
              </Flex>
            </Col>
            <Col xs={24} lg={12}>
              <Section title="1. Choose what the WebView loads">
                <RefTable
                  codeFirst={false}
                  columns={['', 'Bridge page (recommended)', 'Hosted page']}
                  rows={[
                    ['You host', 'One static HTML page on your website', 'Nothing'],
                    ['The app receives', 'Every SDK event, with the signed resultToken, for every journey', <>Only <Code>camtechSessionId</Code> and <Code>camtechStatus</Code> on the return URL</>],
                    ['Your backend gets the decision', 'From the resultToken the app forwards', <>Selfie ID verification: <Code>GET …/result</Code>. Other journeys: the webhook.</>],
                    [
                      'Allowed origins (web apps)',
                      <Typography.Text code key="o1">{origins.bridge}</Typography.Text>,
                      <Typography.Text code key="o2">{origins.sdk}</Typography.Text>,
                    ],
                  ]}
                />
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  Origins are checked only for apps on the web channel{appChannel === 'MOBILE' ? ' (the selected app is a mobile app, so nothing to add)' : ''}.
                </Typography.Text>
              </Section>
            </Col>
          </Row>

          <Section title="2. Put the bridge page on your website">
            <Muted>
              Skip this step with the hosted page. The page must be served over <b>https</b> (the camera only works on secure pages). It replaces the token in the address bar as soon as it is read.
            </Muted>
            <CodeBlock code={bridgePageSnippet(ctx).code} lang="html" title="mobile.html" maxHeight={420} />
            <Muted>The WebView opens one of these URLs (replace the placeholder hosts with yours):</Muted>
            <CodeBlock code={`# Bridge page\n${urls.bridge}\n\n# Hosted page\n${urls.hosted}`} lang="bash" title="URLs" />
          </Section>

          <Section
            title="3. Add the WebView screen"
            extra={
              <Segmented
                size="small"
                value={platform}
                onChange={(v) => set({ platform: v === 'ios' ? null : String(v) })}
                options={PLATFORMS.map((p) => ({ value: p.value, label: p.label, icon: p.icon }))}
                aria-label="Mobile platform"
              />
            }
          >
            <Muted>
              Three pieces: the camera permission, a screen that hosts the WebView (camera granted only to your page and the SDK host, the bridge messages, the return URL), and the code that opens it.
              The same screen works for both the bridge page and the hosted page.
            </Muted>
            <SnippetTabs snippets={webViewSnippets(ctx, platform)} maxHeight={560} />
          </Section>

          <Row gutter={[24, 16]}>
            <Col xs={24} lg={12}>
              <Section title="4. Handle how it ended">
                <RefTable
                  columns={['type', 'payload', 'What to do']}
                  rows={[
                    ['complete', <><Code>{'{ results: [...] }'}</Code>, one entry per flow</>, 'POST it to your backend; show the decision your backend returns'],
                    ['cancel', <Code key="c">{'{ flow, step, sessionId }'}</Code>, 'The user closed it: offer to try again'],
                    ['error', <><Code>{'{ code, message, fatal }'}</Code> (fatal only)</>, <>Expired token: get a new one and reopen. <Code>FEATURE_NOT_ALLOWED</Code>: hide the feature.</>],
                    ['return', <Code key="r">{'{ sessionId, status }'}</Code>, 'Hosted page: ask your backend for the result'],
                  ]}
                />
              </Section>
            </Col>
            <Col xs={24} lg={12}>
              <Section title="WebView checklist">
                <ul style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.9 }}>
                  <li>
                    <b>Black or missing camera:</b> camera permission declared (Info.plist / manifest), runtime permission granted, inline media playback on, page on https.
                  </li>
                  <li>
                    <b>iOS:</b> WKWebView needs iOS 14.3+ for the camera; iOS 15+ lets the app grant it without a second prompt.
                  </li>
                  <li>
                    <b>Android:</b> the camera in a WebView depends on an up-to-date Android System WebView. Grant <Code>RESOURCE_VIDEO_CAPTURE</Code> in <Code>onPermissionRequest</Code>.
                  </li>
                  <li>
                    <b>Never</b> put the token in the query string, and never load other sites in the verification WebView (the JS bridge is exposed to every page it loads).
                  </li>
                  <li>
                    The SDK downloads its face model from <Code>cdn.jsdelivr.net</Code> and <Code>storage.googleapis.com</Code>: allow them if your app restricts network domains.
                  </li>
                  <li>
                    Alternative without a WebView: open the hosted page in <Code>SFSafariViewController</Code> / Chrome Custom Tabs with a universal (app) link as <Code>returnUrl</Code>.
                  </li>
                </ul>
              </Section>
            </Col>
          </Row>
        </>
      ) : (
        <>
          <Alert
            type="warning"
            showIcon
            title="You build the capture experience"
            description="With the REST API your app draws the camera screens, runs the active-liveness challenge (detecting head turns, blinks, smiles…), reads the document number, expiry and MRZ on the device, and handles every error code. The WebView approach gives you all of that ready-made."
          />
          <Row gutter={[24, 16]}>
            <Col xs={24} xl={10}>
              <Section title="Flow">
                <Flex vertical gap={12}>
                  <Step n={1} title="SDK token from your backend">
                    Same route as the web. The app sends it as <Code>X-Sdk-Token</Code> on every call (it only allows the end-user endpoints).
                  </Step>
                  <Step n={2} title={<><Code>GET /v2/capabilities</Code></>}>
                    Which flows and documents this app may use, attempt limits and <Code>livenessMode</Code>. Build your screens from it; cache it with the ETag.
                  </Step>
                  <Step n={3} title="Start, then follow nextStep">
                    Every response says what to do next: <Code>LIVENESS</Code> (retake), <Code>DOCUMENT</Code> (scan or rescan) or <Code>DONE</Code>. Show <Code>message</Code> to the user as it is.
                  </Step>
                  <Step n={4} title="Active liveness">
                    When <Code>livenessMode</Code> is <Code>ACTIVE</Code>, ask for a new challenge before every attempt, guide the user through its actions, and upload up to 16 frames with the selfie.
                  </Step>
                  <Step n={5} title="Send the resultToken to your backend">
                    Never decide in the app: your backend verifies the token.
                  </Step>
                </Flex>
              </Section>
            </Col>
            <Col xs={24} xl={14}>
              <SnippetTabs snippets={nativeApiSnippets(ctx)} maxHeight={560} />
            </Col>
          </Row>
          <Section title="Headers">
            <RefTable
              columns={['Header', 'Value']}
              rows={[
                ['X-Sdk-Token', 'The SDK token from your backend (required)'],
                ['Authorization', <><Code>Bearer &lt;sessionToken&gt;</Code> on every call of one selfie ID verification. Keep it in memory only.</>],
                ['X-Platform', <><Code>IOS</Code> or <Code>ANDROID</Code></>],
                ['X-Device-Id', 'A stable id generated per install (not the IMEI)'],
                ['X-OS-Version, X-App-Version, X-Device-Model', 'Shown in the portal to help investigate problems'],
                ['Accept-Language', <><Code>ar</Code> or <Code>en</Code>: the language of every <Code>message</Code></>],
              ]}
            />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              Capture: selfies from the front camera, at least 720 px on the short side, JPEG quality about 85; documents from the rear camera, at least 1200 px wide, without glare. Keep images under
              2 MB (10 MB maximum). Error codes are in <Link to="/guide?tab=reference">Reference</Link>.
            </Typography.Text>
          </Section>
        </>
      )}
    </Flex>
  );
}

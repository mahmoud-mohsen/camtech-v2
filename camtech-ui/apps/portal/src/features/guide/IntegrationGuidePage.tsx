import { ApiOutlined, CloudServerOutlined, DesktopOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { Lang } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Card, Col, Descriptions, Flex, Row, Segmented, Select, Table, Tabs, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { SnippetTabs } from '../../components/CodeBlock';
import { PageHeader } from '../../components/PageHeader';
import { API_BASE_URL, JWKS_URL, SDK_ORIGIN, SDK_URL } from '../../env';
import { qk, useClientApps } from '../../lib/hooks';
import { flowLabel } from '../../lib/labels';
import {
  backendRoutesSnippets,
  frontendSnippets,
  originOf,
  sdkTokenSnippets,
  verifyTokenSnippets,
  reviewDecidedPayloadSample, webhookPayloadSample,
  webhookSignatureSnippets,
  type SnippetContext,
} from '../../lib/snippets';
import { useSearchState } from '../../lib/useSearchState';
import { api } from '../../api/client';
import { useTenantInfo } from '../../auth/useAuth';
import { MobileTab } from './MobileTab';
import { Code, Muted, RefTable, Section, Step, Value } from './parts';
import { ReasonCodesTab } from './ReasonCodesTab';
import { ReferenceTab } from './ReferenceTab';

const KEY_PLACEHOLDER = 'ck_your_key_id';
const TABS = ['overview', 'setup', 'backend', 'web', 'mobile', 'verify', 'webhooks', 'reference', 'reasons'] as const;
/** Old tab keys still linked from elsewhere. */
const TAB_ALIASES: Record<string, string> = { frontend: 'web' };
const JOURNEYS = ['SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT', 'FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'DOCUMENT_SCAN'];

/** Which journey (and enrollFace option) builds each product. */
const PRODUCTS: { product: string; journey: string; options: string }[] = [
  { product: 'Trade licence, Emirates ID or passport scan', journey: 'DOCUMENT_SCAN', options: 'scanTypes picks the documents' },
  { product: 'Liveness check (selfie only, no document)', journey: 'LIVENESS_CHECK', options: '—' },
  { product: 'Selfie verification with Emirates ID or passport', journey: 'SELFIE_ID_VERIFICATION', options: 'enrollFace: false (verify only)' },
  { product: 'Face registration (selfie only)', journey: 'FACE_ENROLLMENT', options: 'subjectRef required' },
  { product: 'Face registration with Emirates ID or passport', journey: 'SELFIE_ID_VERIFICATION', options: 'enrollFace: true (needs Face registration)' },
  { product: 'Face login', journey: 'FACE_AUTHENTICATION', options: 'subjectRef required; matches the face registered by either face registration' },
];

/** The ways to show the SDK, for the overview. */
const PATHS: { channel: string; option: string; effort: string; tab: string; when: string }[] = [
  { channel: 'Web', option: 'Hosted page (redirect)', effort: 'Lowest', tab: 'web', when: 'Fastest start: no script to load, the user leaves your site and comes back.' },
  { channel: 'Web', option: 'Modal or inline (script tag)', effort: 'Low', tab: 'web', when: 'The user stays on your page; you get the result in a callback.' },
  { channel: 'Web', option: 'iframe', effort: 'Low', tab: 'web', when: 'Strongest isolation from your page’s scripts and styles.' },
  { channel: 'Web', option: 'npm / React', effort: 'Low', tab: 'web', when: 'Single-page apps that bundle their dependencies.' },
  { channel: 'Mobile', option: 'WebView + bridge page', effort: 'Medium', tab: 'mobile', when: 'iOS, Android, React Native, Flutter: the full SDK in your app, result in native code.' },
  { channel: 'Mobile', option: 'Native screens + REST API', effort: 'High', tab: 'mobile', when: 'You want to draw every screen yourself.' },
];

export default function IntegrationGuidePage() {
  const info = useTenantInfo();
  const apps = useClientApps();
  const { values, set } = useSearchState(['tab', 'app', 'lang', 'journey', 'enroll'] as const);
  const rawTab = TAB_ALIASES[values.tab ?? ''] ?? values.tab ?? '';
  const tab = (TABS as readonly string[]).includes(rawTab) ? rawTab : 'overview';
  const lang: Lang = values.lang === 'ar' ? 'ar' : 'en';
  const usable = (apps.data ?? []).filter((a) => a.channel !== 'ADMIN');
  const app = usable.find((a) => a.code === values.app) ?? usable.find((a) => a.channel === 'WEB' && a.status === 'ACTIVE') ?? usable[0];
  const creds = useQuery({ queryKey: qk.credentials(app?.id ?? 0), queryFn: () => api.credentials(app?.id ?? 0), enabled: !!app });
  const keyId = creds.data?.find((c) => c.status === 'ACTIVE')?.keyId ?? KEY_PLACEHOLDER;
  const journey = JOURNEYS.filter(
    (c) => info.flows.some((f) => f.code === c && f.enabled) && (!app || app.permissions.some((p) => p.featureCode === c && p.allowed)),
  );
  const sample = journey.find((j) => j === values.journey) ?? journey[0] ?? 'SELFIE_ID_VERIFICATION';
  const enrollFace = values.enroll === 'yes' ? true : values.enroll === 'no' ? false : undefined;
  const ctx: SnippetContext = { baseUrl: API_BASE_URL, sdkUrl: SDK_URL, tenantCode: info.code, keyId, journey: [sample], lang, enrollFace };
  const goTab = (k: string) => set({ tab: k === 'overview' ? null : k });
  const tabLink = (k: string, label: string) => (
    <Typography.Link onClick={() => goTab(k)}>{label}</Typography.Link>
  );

  return (
    <>
      <PageHeader
        title="Integration guide"
        help="Everything your developers need, filled in for your account. Secrets are never shown here."
      />
      <Card style={{ marginBottom: 16 }}>
        <Row gutter={[24, 12]} align="middle">
          <Col xs={24} lg={10}>
            <Flex vertical gap={8}>
              <Flex gap={8} align="center" wrap>
                <Typography.Text type="secondary">Samples for</Typography.Text>
                <Select
                  style={{ minWidth: 220 }}
                  loading={apps.isPending}
                  value={app?.code}
                  placeholder="No apps yet"
                  onChange={(v: string) => set({ app: v })}
                  options={usable.map((a) => ({ value: a.code, label: `${a.name} (${a.channel === 'WEB' ? 'web' : 'mobile'})` }))}
                  aria-label="App for the samples"
                />
                <Segmented size="small" value={lang} onChange={(v) => set({ lang: v === 'ar' ? 'ar' : null })} options={[{ value: 'en', label: 'EN' }, { value: 'ar', label: 'AR' }]} aria-label="Language" />
              </Flex>
              <Flex gap={8} align="center" wrap>
                <Typography.Text type="secondary">Journey</Typography.Text>
                <Select
                  style={{ minWidth: 220 }}
                  value={sample}
                  onChange={(v: string) => set({ journey: v })}
                  options={(journey.length ? journey : [sample]).map((j) => ({ value: j, label: flowLabel(j) }))}
                  aria-label="Journey for the samples"
                />
                {sample === 'SELFIE_ID_VERIFICATION' && (
                  <Select
                    style={{ minWidth: 200 }}
                    value={values.enroll === 'yes' || values.enroll === 'no' ? values.enroll : 'default'}
                    onChange={(v: string) => set({ enroll: v === 'default' ? null : v })}
                    options={[
                      { value: 'default', label: 'App default' },
                      { value: 'yes', label: 'Register the face', disabled: !journey.includes('FACE_ENROLLMENT') },
                      { value: 'no', label: 'Verify only' },
                    ]}
                    aria-label="Register the face (enrollFace)"
                  />
                )}
              </Flex>
              {!app && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  <Link to="/apps?new=1">Create an app</Link> to fill in your key id.
                </Typography.Text>
              )}
              {app && keyId === KEY_PLACEHOLDER && !creds.isPending && (
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {app.name} has no active API key. <Link to={`/apps/${app.id}?tab=credentials`}>Create one</Link>.
                </Typography.Text>
              )}
            </Flex>
          </Col>
          <Col xs={24} lg={14}>
            <Descriptions
              size="small"
              column={{ xs: 1, md: 2 }}
              items={[
                { label: 'Tenant', children: <Value label="Tenant code" value={info.code} /> },
                { label: 'Key id', children: <Value label="Key id" value={keyId} /> },
                { label: 'API base URL', children: <Value label="API base URL" value={API_BASE_URL} /> },
                { label: 'SDK URL', children: <Value label="SDK URL" value={SDK_URL} /> },
              ]}
            />
          </Col>
        </Row>
      </Card>

      <Card>
        <Tabs
          activeKey={tab}
          onChange={goTab}
          items={[
            {
              key: 'overview',
              label: 'How it fits together',
              children: (
                <Row gutter={[24, 24]}>
                  <Col xs={24} lg={13}>
                    <Flex vertical gap={18}>
                      <Step n={1} icon={<CloudServerOutlined />} title="Your backend asks for an SDK token">
                        With the app's API key (never in a browser or app bundle) it calls <Code>POST /v2/sdk-tokens</Code> for the user who is about to verify. The token is short-lived and bound to
                        that user's <Code>subjectRef</Code>.
                      </Step>
                      <Step n={2} icon={<DesktopOutlined />} title="Your web page or mobile app opens the SDK">
                        Redirect to the hosted page, open it as a modal, embed it inline or in an iframe, mount it from npm, or show it in a WebView in your mobile app. It handles the camera, the
                        guidance and the retries.
                      </Step>
                      <Step n={3} icon={<SafetyCertificateOutlined />} title="Your backend verifies the result">
                        The SDK hands back a signed <Code>resultToken</Code> (JWT, RS256). Verify it with the public keys before trusting the decision.
                      </Step>
                      <Step n={4} icon={<ApiOutlined />} title="Webhooks tell you what happens later">
                        A verification that goes to manual review gets its final answer from a reviewer (your team, or CamTech when you hand reviews to CamTech): <Code>REVIEW_DECIDED</Code>.
                      </Step>
                    </Flex>
                  </Col>
                  <Col xs={24} lg={11}>
                    <Flex vertical gap={12}>
                      <Alert
                        type="info"
                        showIcon
                        title="Flows available to this app"
                        description={journey.length ? journey.map((j) => flowLabel(j)).join(' · ') : 'None yet: check the app permissions and your plan.'}
                      />
                      <Alert
                        type="warning"
                        showIcon
                        title="The secret stays on your server"
                        description="Web pages and app bundles can be read by anyone. Only your backend holds X-Client-Secret; the browser or app gets an SDK token that expires in minutes."
                      />
                      <Typography.Text type="secondary">
                        New here? Follow the tabs from left to right: {tabLink('setup', 'Setup')}, {tabLink('backend', 'Backend')}, {tabLink('web', 'Web')} or {tabLink('mobile', 'Mobile')},{' '}
                        {tabLink('verify', 'Verify')}, {tabLink('webhooks', 'Webhooks')}. Try the whole loop without code in the <Link to="/playground">playground</Link>.
                      </Typography.Text>
                    </Flex>
                  </Col>
                  <Col span={24}>
                    <Section title="Pick how to show the SDK">
                      <Table
                        size="small"
                        rowKey="option"
                        pagination={false}
                        scroll={{ x: 'max-content' }}
                        dataSource={PATHS}
                        columns={[
                          { title: 'Channel', dataIndex: 'channel' },
                          { title: 'Option', dataIndex: 'option', render: (v: string, r) => <Typography.Link onClick={() => goTab(r.tab)}>{v}</Typography.Link> },
                          { title: 'Effort', dataIndex: 'effort' },
                          { title: 'Best for', dataIndex: 'when', render: (v: string) => <Typography.Text type="secondary">{v}</Typography.Text> },
                        ]}
                      />
                    </Section>
                  </Col>
                  <Col span={24}>
                    <Section title="Which journey for which product">
                      <Table
                        size="small"
                        rowKey="product"
                        pagination={false}
                        scroll={{ x: 'max-content' }}
                        dataSource={PRODUCTS}
                        columns={[
                          { title: 'Product', dataIndex: 'product' },
                          {
                            title: 'Journey',
                            dataIndex: 'journey',
                            render: (v: string) => (
                              <span>
                                {flowLabel(v)} <Typography.Text code style={{ fontSize: 12 }}>{v}</Typography.Text>
                              </span>
                            ),
                          },
                          { title: 'Options', dataIndex: 'options', render: (v: string) => <Typography.Text type="secondary">{v}</Typography.Text> },
                        ]}
                      />
                      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                        <Code>journey</Code> can list several flows; they run one after the other. Without <Code>enrollFace</Code>, a selfie ID verification registers the face when the app is allowed
                        Face registration, and then also counts one Face registration use.
                      </Typography.Text>
                    </Section>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'setup',
              label: 'Setup',
              children: (
                <Row gutter={[32, 24]}>
                  <Col xs={24} xl={13}>
                    <Section title="Before you write code">
                      <Flex vertical gap={16}>
                        <Step n={1} title="Create an app for each channel">
                          On <Link to="/apps?new=1">Apps &amp; API keys</Link>: a <b>web</b> app for your website, a <b>mobile</b> app for your iOS / Android app. Each has its own keys, permissions and
                          statistics.
                          {app && (
                            <>
                              {' '}
                              Selected: <b>{app.name}</b> ({app.channel === 'WEB' ? 'web' : 'mobile'}, {app.status === 'ACTIVE' ? 'active' : 'disabled'}).
                            </>
                          )}
                        </Step>
                        <Step n={2} title="Create an API key and store the secret on your server">
                          On the app's <i>Credentials</i> tab. The secret is shown <b>once</b>: put it in your backend's secret store as <Code>CAMTECH_CLIENT_SECRET</Code> (the samples read it from
                          there). The key id ({keyId === KEY_PLACEHOLDER ? 'none yet' : <Code>{keyId}</Code>}) is not secret.
                          {app && (
                            <>
                              {' '}
                              <Link to={`/apps/${app.id}?tab=credentials`}>Open the credentials</Link>.
                            </>
                          )}
                        </Step>
                        <Step n={3} title="Web apps: list the allowed origins">
                          The pages allowed to run the SDK; calls from anywhere else get <Code>403 ORIGIN_NOT_ALLOWED</Code>. Mobile apps are not checked.
                          <div style={{ marginTop: 8 }}>
                            <RefTable
                              codeFirst={false}
                              columns={['How you show the SDK', 'Origin to add']}
                              rows={[
                                ['Modal, inline, npm / React', <Code key="a">https://your-site.example</Code>],
                                ['Hosted page, iframe', <Code key="b">{SDK_ORIGIN}</Code>],
                                ['Mobile WebView with a bridge page', <Code key="c">origin of the bridge page</Code>],
                              ]}
                            />
                          </div>
                        </Step>
                        <Step n={4} title="Check the flows the app may use">
                          {journey.length ? journey.map((j) => flowLabel(j)).join(' · ') : 'None yet'}. Change them on the app's <i>Permissions</i> tab; flow settings (attempts, liveness mode) are on{' '}
                          <Link to="/flows">Flows</Link>.
                        </Step>
                        <Step n={5} title="Optional: brand the SDK">
                          Colours, logo, font and texts on <Link to="/branding">Branding</Link>. The SDK applies them automatically, on web and in WebViews.
                        </Step>
                        <Step n={6} title="Add a webhook endpoint">
                          On <Link to="/webhooks">Webhooks</Link>, to receive final decisions after manual review. Store its signing secret as <Code>CAMTECH_WEBHOOK_SECRET</Code>.
                        </Step>
                        <Step n={7} title="Try it">
                          The <Link to="/playground">playground</Link> runs every journey with your own apps, and decodes the result token.
                        </Step>
                      </Flex>
                    </Section>
                  </Col>
                  <Col xs={24} xl={11}>
                    <Flex vertical gap={20}>
                      <Section title="Values for this environment">
                        <RefTable
                          codeFirst={false}
                          columns={['', 'Value']}
                          rows={[
                            ['API base URL', <Value key="a" label="API base URL" value={API_BASE_URL} />],
                            ['SDK URL (hosted page, script)', <Value key="s" label="SDK URL" value={SDK_URL} />],
                            ['Script tag', <Value key="j" label="Script URL" value={`${SDK_URL}/camtech-sdk.js`} />],
                            ['Public keys (JWKS)', <Value key="k" label="JWKS URL" value={JWKS_URL} />],
                            ['Tenant code', <Value key="t" label="Tenant code" value={info.code} />],
                          ]}
                        />
                      </Section>
                      <Section title="What you build">
                        <RefTable
                          codeFirst={false}
                          columns={['Where', 'What']}
                          rows={[
                            ['Your backend', <><Code>POST /api/kyc/sdk-token</Code>: creates an SDK token for the signed-in user</>],
                            ['Your backend', <><Code>POST /api/kyc/result</Code>: verifies the result token(s) and saves the decision</>],
                            ['Your backend', <><Code>POST /hooks/camtech</Code>: receives webhooks (signed)</>],
                            ['Web page or app', 'A button that gets a token and opens the SDK'],
                          ]}
                        />
                        <Muted>The route names are only examples; complete code for each is in the next tabs.</Muted>
                      </Section>
                      <Alert
                        type="info"
                        showIcon
                        title="Browser and device support"
                        description="Recent Chrome, Edge, Firefox and Safari on desktop, Android and iOS (14.3+ in a WebView), on https pages (localhost works for development). The SDK needs a camera."
                      />
                    </Flex>
                  </Col>
                </Row>
              ),
            },
            {
              key: 'backend',
              label: 'Backend',
              children: (
                <Flex vertical gap={28}>
                  <Section title="1. Create an SDK token for each verification">
                    <Muted>
                      <Code>POST {API_BASE_URL}/v2/sdk-tokens</Code> with <Code>X-Client-Id</Code> / <Code>X-Client-Secret</Code> and body <Code>{'{ "subjectRef": "…", "ttlMinutes": 30 }'}</Code>.
                      Use your own stable user id as <Code>subjectRef</Code> (max 200 characters): the face is registered under it, and face authentication later matches against it. A token
                      lives 30 minutes by default (1–60).
                    </Muted>
                    <SnippetTabs snippets={sdkTokenSnippets(ctx)} />
                  </Section>
                  <Section title="2. The routes your web page or app calls">
                    <Muted>
                      One route hands out tokens, the other receives what the SDK returned and verifies it. Both must require your own sign-in, so a token is only ever created for the user
                      who is signed in.
                    </Muted>
                    <SnippetTabs snippets={backendRoutesSnippets(ctx)} maxHeight={560} />
                  </Section>
                </Flex>
              ),
            },
            {
              key: 'web',
              label: 'Web',
              children: (
                <Flex vertical gap={28}>
                  <Row gutter={[24, 16]}>
                    <Col xs={24} lg={12}>
                      <Section title="Load the SDK">
                        <Muted>
                          <b>Script tag</b> (no build step): <Code>{`<script src="${SDK_URL}/camtech-sdk.js"></script>`}</Code> defines <Code>window.Camtech</Code>. <b>npm</b>:{' '}
                          <Code>import {'{ mount }'} from '@camtech/sdk'</Code>. The hosted page needs neither. The SDK renders in a Shadow DOM, so your CSS and its CSS never clash.
                        </Muted>
                      </Section>
                    </Col>
                    <Col xs={24} lg={12}>
                      <Section title="Rules">
                        <ul style={{ margin: 0, paddingInlineStart: 18, lineHeight: 1.8 }}>
                          <li>Get the token from your backend when the user clicks, not on page load.</li>
                          <li>
                            The token travels in code or the URL fragment (<Code>#sdkToken=</Code>), never in a query string or a log.
                          </li>
                          <li>The page must be https and one of the app's allowed origins (see Setup).</li>
                          <li>
                            Pass <Code>apiBaseUrl</Code> to <Code>Camtech.init</Code> and <Code>mount</Code>; a modal opens only after <Code>.open()</Code>.
                          </li>
                        </ul>
                      </Section>
                    </Col>
                  </Row>
                  <Section title="Open the SDK: pick one">
                    <SnippetTabs snippets={frontendSnippets(ctx)} maxHeight={560} />
                  </Section>
                  <Section title="Content-Security-Policy">
                    <Muted>If your site sends a CSP, allow the SDK, its face model and the API:</Muted>
                    <SnippetTabs
                      snippets={[
                        {
                          key: 'csp',
                          label: 'CSP',
                          lang: 'http',
                          code: `Content-Security-Policy:
  script-src 'self' ${SDK_ORIGIN} https://cdn.jsdelivr.net 'wasm-unsafe-eval';
  connect-src 'self' ${originOf(API_BASE_URL)} https://cdn.jsdelivr.net https://storage.googleapis.com;
  img-src 'self' data: blob:;
  media-src blob:;
  style-src 'self' 'unsafe-inline';
  frame-src ${SDK_ORIGIN};            # iframe mode only
Permissions-Policy: camera=(self "${SDK_ORIGIN}")`,
                        },
                      ]}
                    />
                  </Section>
                </Flex>
              ),
            },
            {
              key: 'mobile',
              label: 'Mobile apps',
              children: <MobileTab ctx={ctx} appChannel={app?.channel} />,
            },
            {
              key: 'verify',
              label: 'Verify the result',
              children: (
                <Section title="Trust the decision only after checking the signature">
                  <Muted>
                    Public keys: <Typography.Text code copyable>{JWKS_URL}</Typography.Text>. Check the RS256 signature, <Code>iss = "camtech"</Code>, <Code>exp</Code> (tokens last 10 minutes), and
                    that <Code>sub</Code> is the user you started the verification for. Then use <Code>decision</Code>: <Code>APPROVED</Code>, <Code>REVIEW</Code> (wait for the webhook) or{' '}
                    <Code>REJECTED</Code>. Document scans return the read fields instead of a token.
                  </Muted>
                  <SnippetTabs snippets={verifyTokenSnippets(ctx)} />
                </Section>
              ),
            },
            {
              key: 'webhooks',
              label: 'Webhooks',
              children: (
                <Flex vertical gap={20}>
                  <Section title="Receive events">
                    <Muted>
                      Add your endpoint on the <Link to="/webhooks">Webhooks</Link> page; the signing secret is shown once. Reply 2xx within 10 seconds; failed deliveries are retried after 30 s, 2
                      min, 10 min, 30 min and 2 h. The same event can arrive twice: de-duplicate on <Code>X-Camtech-Delivery</Code>.
                    </Muted>
                    <RefTable
                      columns={['Event', 'When']}
                      rows={[
                        ['SESSION_COMPLETED', 'A verification got a decision, or ended without one (status FAILED / CANCELLED)'],
                        ['SESSION_EXPIRED', 'A verification timed out'],
                        ['REVIEW_OPENED', 'A verification went to manual review'],
                        ['REVIEW_DECIDED', 'A reviewer approved or rejected it: the final answer for REVIEW. decidedBy is TENANT (with reviewer = the username) or CAMTECH'],
                        ['SCAN_REVIEW_REQUIRED', 'A document scan failed a check and waits for review (scanId, documentType, createdAt)'],
                        ['SCAN_REVIEW_DECIDED', 'A held document scan was approved or rejected (scanId, decision, decidedBy TENANT / CAMTECH)'],
                        ['DOCUMENT_EXPIRING', 'Daily: a document expires within your warning period, sent once per document (documentId, partyId, expiresOn)'],
                        ['PARTY_ERASED', 'A person and their data were erased (partyId, subjectRef, erasedAt, erasedBy)'],
                      ]}
                    />
                  </Section>
                  <Row gutter={[16, 16]}>
                    <Col xs={24} xxl={14}>
                      <SnippetTabs snippets={webhookSignatureSnippets()} />
                    </Col>
                    <Col xs={24} xxl={10}>
                      <SnippetTabs snippets={[webhookPayloadSample(), reviewDecidedPayloadSample()]} />
                    </Col>
                  </Row>
                </Flex>
              ),
            },
            {
              key: 'reference',
              label: 'Reference',
              children: <ReferenceTab />,
            },
            {
              key: 'reasons',
              label: 'Reason codes',
              children: <ReasonCodesTab />,
            },
          ]}
        />
      </Card>
    </>
  );
}

import { CaretRightOutlined, CheckCircleFilled, ExportOutlined, GlobalOutlined, MobileOutlined, ReloadOutlined, SyncOutlined } from '@ant-design/icons';
import type { ClientApp, Lang, SdkTokenResponse } from '@camtech/api-client';
import { Alert, Button, Card, Checkbox, Col, Collapse, Empty, Flex, Form, Input, Row, Segmented, Select, Tag, theme, Tooltip, Typography } from 'antd';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { DataState } from '../../components/DataState';
import { JsonBlock } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { SDK_ORIGIN, SDK_URL, USE_MOCKS } from '../../env';
import { useApiMutation, useClientApps } from '../../lib/hooks';
import { docTypeLabel, FLOW_HELP, flowLabel, SCAN_TYPES } from '../../lib/labels';
import { findResultTokens, parseSdkMessage, summarize, type FoundToken } from '../../lib/sdkMessages';
import { api } from '../../api/client';
import { useNoPermissionText, usePermissions, useTenantInfo } from '../../auth/useAuth';
import { ReadOnlyNotice } from '../../components/ReadOnlyNotice';
import { EventLog, type LogEntry } from './EventLog';
import { JwtDecoder } from './JwtDecoder';

const JOURNEY_ORDER = ['SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT', 'FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'DOCUMENT_SCAN'] as const;

/** enrollFace for a selfie ID verification: the app's default (omitted), true or false. */
type EnrollChoice = 'default' | 'yes' | 'no';

interface Config {
  appCode: string;
  journey: string[];
  subjectRef: string;
  lang: Lang;
  scanTypes: string[];
  enrollFace: EnrollChoice;
}

interface Run {
  config: Config;
  token: SdkTokenResponse;
  url: string;
  key: number;
}

const randomRef = () => `playground-${Math.random().toString(36).slice(2, 8)}`;

/** The SDK URL for a run: settings in the query, the token in the fragment (never sent to a server). */
function buildSdkUrl(c: Config, sdkToken: string, parentOrigin: string): string {
  const params = new URLSearchParams({ journey: c.journey.join(','), subjectRef: c.subjectRef, lang: c.lang, parentOrigin, debug: '1' });
  if (c.journey.includes('DOCUMENT_SCAN') && c.scanTypes.length) params.set('scanTypes', c.scanTypes.join(','));
  if (c.journey.includes('SELFIE_ID_VERIFICATION') && c.enrollFace !== 'default') params.set('enrollFace', String(c.enrollFace === 'yes'));
  return `${SDK_URL}/?${params.toString()}#sdkToken=${encodeURIComponent(sdkToken)}`;
}

function appAllows(app: ClientApp | undefined, code: string): boolean {
  return !!app?.permissions.find((p) => p.featureCode === code)?.allowed;
}

function Setup({ apps, onStart, starting, initial }: { apps: ClientApp[]; onStart: (c: Config) => void; starting: boolean; initial: Config | null }) {
  const info = useTenantInfo();
  const navigate = useNavigate();
  const { canBuild } = usePermissions();
  const noPermission = useNoPermissionText();
  // ?flow=CODE (from "Try it" on Verification flows) preselects that flow.
  const [params] = useSearchParams();
  const usable = apps.filter((a) => a.channel !== 'ADMIN');
  const wanted = params.get('flow') ?? 'SELFIE_ID_VERIFICATION';
  // An active app, web first, preferably one that may run the requested flow.
  const preferred =
    usable.find((a) => a.status === 'ACTIVE' && a.channel === 'WEB' && appAllows(a, wanted)) ??
    usable.find((a) => a.status === 'ACTIVE' && appAllows(a, wanted)) ??
    usable.find((a) => a.status === 'ACTIVE' && a.channel === 'WEB') ??
    usable.find((a) => a.status === 'ACTIVE');
  const tenantFlows = JOURNEY_ORDER.filter((c) => info.flows.some((f) => f.code === c && f.enabled));
  const [form] = Form.useForm<Config>();
  const appCode = Form.useWatch('appCode', form);
  const journey = Form.useWatch('journey', form) ?? [];
  const app = usable.find((a) => a.code === appCode);
  const canRegister = tenantFlows.includes('FACE_ENROLLMENT') && appAllows(app, 'FACE_ENROLLMENT');
  // No allowed origins (or "*") means the server accepts every origin.
  const webOriginMissing =
    app?.channel === 'WEB' && app.allowedOrigins.length > 0 && !app.allowedOrigins.some((o) => o === '*' || o.toLowerCase() === SDK_ORIGIN.toLowerCase());

  // Drop flows the newly picked app can't run.
  useEffect(() => {
    if (!app) return;
    const current = (form.getFieldValue('journey') as string[] | undefined) ?? [];
    const kept = current.filter((j) => appAllows(app, j));
    if (kept.length !== current.length) form.setFieldValue('journey', kept);
    if (!appAllows(app, 'FACE_ENROLLMENT') && form.getFieldValue('enrollFace') === 'yes') form.setFieldValue('enrollFace', 'default');
  }, [app, form]);

  const initialValues: Config = initial ?? {
    appCode: preferred?.code ?? '',
    journey: tenantFlows.filter((f) => f === wanted && appAllows(preferred, f)).slice(0, 1),
    subjectRef: randomRef(),
    lang: 'en',
    scanTypes: ['EMIRATES_ID'],
    enrollFace: 'default',
  };

  if (!usable.length) {
    return (
      <Card>
        <Empty description="Create an app first: the playground runs the flows as one of your apps.">
          {canBuild && (
            <Button type="primary" onClick={() => navigate('/apps?new=1')}>
              Create app
            </Button>
          )}
        </Empty>
      </Card>
    );
  }

  return (
    <Card title="Run a verification" size="small">
      <Form<Config> form={form} layout="vertical" initialValues={initialValues} onFinish={(v) => onStart({ ...v, journey: JOURNEY_ORDER.filter((j) => v.journey.includes(j)), enrollFace: v.enrollFace ?? 'default' })} requiredMark={false}>
        <Row gutter={20}>
          <Col xs={24} lg={12}>
            <Form.Item name="appCode" label="Run as app" rules={[{ required: true, message: 'Pick an app' }]} extra="Web apps match how the SDK runs in a browser.">
              <Select
                options={[...usable]
                  .sort((a, b) => (a.channel === b.channel ? 0 : a.channel === 'WEB' ? -1 : 1))
                  .map((a) => ({
                    value: a.code,
                    disabled: a.status !== 'ACTIVE',
                    label: (
                      <Flex gap={8} align="center">
                        {a.channel === 'WEB' ? <GlobalOutlined /> : <MobileOutlined />}
                        <span>{a.name}</span>
                        <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                          {a.code}
                        </Typography.Text>
                        {a.status !== 'ACTIVE' && <Tag>Disabled</Tag>}
                      </Flex>
                    ),
                  }))}
              />
            </Form.Item>
            {webOriginMissing && app && (
              <Alert
                type="warning"
                showIcon
                style={{ marginBottom: 16 }}
                title={
                  <span>
                    <Typography.Text code>{SDK_ORIGIN}</Typography.Text> isn't an allowed origin of {app.name}
                  </span>
                }
                description="The SDK may be refused with ORIGIN_NOT_ALLOWED. Add the origin to the app if you see that error."
                action={<Button size="small" onClick={() => navigate(`/apps/${app.id}`)}>Open app</Button>}
              />
            )}
            {app?.channel === 'MOBILE' && (
              <Alert type="info" showIcon style={{ marginBottom: 16 }} title="This is a mobile app: the flow runs in your browser with that app's permissions and limits." />
            )}
            <Form.Item
              name="subjectRef"
              label="Your user reference (subjectRef)"
              extra="Face authentication needs the same reference as an earlier approved face registration (or a selfie ID verification that registered the face)."
              rules={[{ required: true, whitespace: true, message: 'Enter a reference' }, { max: 100 }]}
            >
              <Input
                style={{ fontFamily: 'monospace' }}
                suffix={
                  <Tooltip title="New random reference">
                    <Button type="text" size="small" icon={<SyncOutlined />} aria-label="New random reference" onClick={() => form.setFieldValue('subjectRef', randomRef())} />
                  </Tooltip>
                }
              />
            </Form.Item>
            <Form.Item name="lang" label="Language">
              <Segmented options={[{ value: 'en', label: 'English' }, { value: 'ar', label: 'العربية' }]} />
            </Form.Item>
          </Col>
          <Col xs={24} lg={12}>
            <Form.Item name="journey" label="Journey" rules={[{ required: true, type: 'array', min: 1, message: 'Pick at least one flow' }]} extra="Flows run in this order.">
              <Checkbox.Group style={{ display: 'grid', gap: 10 }}>
                {JOURNEY_ORDER.map((code) => {
                  const inPlan = tenantFlows.includes(code);
                  const allowed = appAllows(app, code);
                  const reason = !inPlan ? 'Not in your plan' : !allowed ? `Not allowed for ${app?.name ?? 'this app'}` : null;
                  return (
                    <Checkbox key={code} value={code} disabled={!!reason}>
                      <span>
                        {flowLabel(code)} {reason && <Tag style={{ marginInlineStart: 4 }}>{reason}</Tag>}
                        <br />
                        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                          {FLOW_HELP[code]}
                        </Typography.Text>
                      </span>
                    </Checkbox>
                  );
                })}
              </Checkbox.Group>
            </Form.Item>
            {journey.includes('SELFIE_ID_VERIFICATION') && (
              <Form.Item
                name="enrollFace"
                label="Register the face (enrollFace)"
                extra={canRegister ? 'App default: the face is registered, since this app is allowed face registration.' : 'This app is not allowed face registration: the face is never registered.'}
              >
                <Segmented
                  options={[
                    { value: 'default', label: 'App default' },
                    { value: 'yes', label: 'Register', disabled: !canRegister },
                    { value: 'no', label: 'Verify only' },
                  ]}
                />
              </Form.Item>
            )}
            {journey.includes('DOCUMENT_SCAN') && (
              <Form.Item name="scanTypes" label="Documents to scan" rules={[{ required: true, type: 'array', min: 1, message: 'Pick at least one document' }]}>
                <Select
                  mode="multiple"
                  options={SCAN_TYPES.filter((t) => info.documentTypes.some((d) => d.enabled && t.startsWith(d.code))).map((t) => ({ value: t, label: docTypeLabel(t) }))}
                />
              </Form.Item>
            )}
          </Col>
        </Row>
        <Flex justify="flex-end">
          <Tooltip title={canBuild ? undefined : noPermission}>
            <Button type="primary" size="large" htmlType="submit" icon={<CaretRightOutlined />} loading={starting} disabled={!canBuild}>
              Start
            </Button>
          </Tooltip>
        </Flex>
      </Form>
    </Card>
  );
}

function TokenDecoderTool() {
  const [token, setToken] = useState('');
  return (
    <Collapse
      size="small"
      items={[
        {
          key: 'decode',
          label: 'Decode a result token',
          children: (
            <Flex vertical gap={12}>
              <Input.TextArea
                value={token}
                onChange={(e) => setToken(e.target.value.trim())}
                placeholder="Paste a resultToken (eyJhbGciOi…)"
                autoSize={{ minRows: 2, maxRows: 6 }}
                style={{ fontFamily: 'monospace', fontSize: 12 }}
                aria-label="Token to decode"
              />
              {token && <JwtDecoder token={token} />}
            </Flex>
          ),
        },
      ]}
    />
  );
}

function Results({ payload, tokens }: { payload: unknown; tokens: FoundToken[] }) {
  return (
    <Card
      size="small"
      title={
        <Flex gap={8} align="center">
          <CheckCircleFilled style={{ color: '#2fb36d' }} /> Journey complete
        </Flex>
      }
    >
      <Flex vertical gap={20}>
        {tokens.length === 0 ? (
          <Alert type="info" showIcon title="The SDK reported completion without a result token." description="Tokens are issued only once a decision exists (not for an open review or a cancelled flow)." />
        ) : (
          tokens.map((t, i) => <JwtDecoder key={`${t.path}-${i}`} token={t.token} title={t.flow ? `${flowLabel(t.flow)} result` : `Result token ${i + 1}`} />)
        )}
        <Collapse size="small" items={[{ key: 'raw', label: 'Raw completion message', children: <JsonBlock value={payload} maxHeight={400} /> }]} />
      </Flex>
    </Card>
  );
}

export default function PlaygroundPage() {
  const { token: tk } = theme.useToken();
  const apps = useClientApps();
  const iframe = useRef<HTMLIFrameElement>(null);
  const [run, setRun] = useState<Run | null>(null);
  const [lastConfig, setLastConfig] = useState<Config | null>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [height, setHeight] = useState(720);
  const [completion, setCompletion] = useState<{ payload: unknown; tokens: FoundToken[] } | null>(null);
  const seq = useRef(0);
  const { canBuild } = usePermissions();

  const push = useCallback((type: LogEntry['type'], summary: string, payload: unknown) => {
    setLog((l) => [...l.slice(-499), { id: ++seq.current, at: Date.now(), type, summary, payload }]);
  }, []);

  const start = useApiMutation((c: Config) => api.playgroundToken({ clientAppCode: c.appCode, subjectRef: c.subjectRef.trim() }), {
    onSuccess: (token, c) => {
      const url = buildSdkUrl(c, token.sdkToken, window.location.origin);
      setLastConfig(c);
      setLog([]);
      setCompletion(null);
      setHeight(720);
      setRun({ config: c, token, url, key: Date.now() });
      push('portal', `SDK token issued for ${token.clientAppCode} (expires ${new Date(token.expiresAt).toLocaleTimeString()})`, { ...token, sdkToken: `${token.sdkToken.slice(0, 12)}…` });
    },
  });

  // Messages from the SDK: only from its origin AND from our iframe.
  useEffect(() => {
    if (!run) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== SDK_ORIGIN || e.source !== iframe.current?.contentWindow) return;
      const msg = parseSdkMessage(e.data);
      if (!msg) return;
      push(msg.type, summarize(msg), msg.payload);
      if (msg.type === 'resize' && typeof msg.payload === 'object' && msg.payload !== null && 'height' in msg.payload) {
        const h = Number((msg.payload as { height: unknown }).height);
        if (Number.isFinite(h)) setHeight(Math.min(1100, Math.max(480, Math.round(h))));
      }
      if (msg.type === 'complete') setCompletion({ payload: msg.payload, tokens: findResultTokens(msg.payload) });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [run, push]);

  const restart = () => {
    setRun(null);
    setCompletion(null);
    setLog([]);
  };

  const rerun = () => {
    if (run) start.mutate({ ...run.config });
  };

  const tokenNote = useMemo(() => (run?.token.sdkToken === 'mock' ? 'mock token' : null), [run]);

  return (
    <>
      <PageHeader
        title="Playground"
        help="Try the real flows as one of your apps and watch every step and API call."
        extra={
          run && (
            <>
              <Button icon={<ExportOutlined />} href={run.url} target="_blank" rel="noopener noreferrer">
                Open in new tab
              </Button>
              <Button icon={<ReloadOutlined />} onClick={rerun} loading={start.isPending}>
                Run again
              </Button>
              <Button onClick={restart}>Change settings</Button>
            </>
          )
        }
      />
      {!canBuild && <ReadOnlyNotice />}
      {USE_MOCKS && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16 }}
          title="Demo data: the playground token is “mock”. Run the SDK in mock mode (npm run dev:sdk:mock) to try the flow end to end."
        />
      )}
      <DataState query={apps} rows={8}>
        {(list) =>
          !run ? (
            <Flex vertical gap={16}>
              <Setup apps={list} onStart={(c) => start.mutate(c)} starting={start.isPending} initial={lastConfig} />
              <TokenDecoderTool />
            </Flex>
          ) : (
            <Flex vertical gap={16}>
              <Row gutter={[16, 16]}>
                <Col xs={24} xl={14}>
                  <Card
                    size="small"
                    title={
                      <Flex gap={8} align="center" wrap>
                        <span>SDK</span>
                        {run.config.journey.map((j) => (
                          <Tag key={j}>{flowLabel(j)}</Tag>
                        ))}
                        {tokenNote && <Tag color="purple">{tokenNote}</Tag>}
                      </Flex>
                    }
                    extra={<Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>{run.config.subjectRef}</Typography.Text>}
                    styles={{ body: { padding: 0, background: tk.colorFillQuaternary } }}
                  >
                    <iframe
                      key={run.key}
                      ref={iframe}
                      src={run.url}
                      title="CamTech SDK"
                      allow="camera; fullscreen"
                      style={{ width: '100%', height, border: 0, display: 'block', transition: 'height .2s' }}
                    />
                  </Card>
                </Col>
                <Col xs={24} xl={10}>
                  <Flex vertical gap={8} style={{ position: 'sticky', top: 76 }}>
                    <Typography.Text strong>Event log</Typography.Text>
                    <EventLog entries={log} onClear={() => setLog([])} height={Math.min(height, 720)} />
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      Messages are accepted only from <Typography.Text code style={{ fontSize: 12 }}>{SDK_ORIGIN}</Typography.Text>. A run opened in a new tab isn't logged here.
                    </Typography.Text>
                  </Flex>
                </Col>
              </Row>
              {completion && <Results payload={completion.payload} tokens={completion.tokens} />}
            </Flex>
          )
        }
      </DataState>
    </>
  );
}

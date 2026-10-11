import { ApiOutlined, DeleteOutlined, EditOutlined, PlusOutlined, RedoOutlined, SendOutlined, SyncOutlined } from '@ant-design/icons';
import type { Webhook, WebhookDelivery, WebhookEvent, WebhookRequest } from '@camtech/api-client';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, Checkbox, Col, Empty, Flex, Form, Input, Modal, Radio, Row, Table, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SnippetTabs } from '../../components/CodeBlock';
import { DataState, ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { RowActions } from '../../components/RowActions';
import { SectionTitle, TableFrame } from '../../components/ui';
import { SecretModal } from '../../components/SecretModal';
import { ActiveTag, DeliveryStatusTag } from '../../components/Tags';
import { qk, useApiMutation, useWebhooks } from '../../lib/hooks';
import { WEBHOOK_EVENT_HELP, WEBHOOK_EVENTS, webhookEventLabel } from '../../lib/labels';
import { reviewDecidedPayloadSample, webhookPayloadSample, webhookSignatureSnippets } from '../../lib/snippets';
import { api } from '../../api/client';
import { usePermissions, useTenantInfo } from '../../auth/useAuth';
import { t } from '../../i18n';

/** An endpoint as host (bold) and path, each cut with "…" when long; the full URL is in the tooltip and copy button. */
function EndpointCell({ url }: { url: string }) {
  let host = url;
  let path = '';
  try {
    const u = new URL(url);
    host = u.host;
    path = `${u.pathname}${u.search}`;
  } catch {
    /* not a URL: show it as is */
  }
  return (
    <Flex vertical style={{ minWidth: 0, maxWidth: 320 }}>
      <Typography.Text strong ellipsis={{ tooltip: url }} copyable={{ text: url }}>
        {host}
      </Typography.Text>
      {path && path !== '/' && (
        <Typography.Text type="secondary" className="ct-mono" ellipsis={{ tooltip: url }}>
          {path}
        </Typography.Text>
      )}
    </Flex>
  );
}

interface FormValues {
  url: string;
  events: WebhookEvent[];
  status: Webhook['status'];
}

function WebhookForm({ initial, onClose, onCreated }: { initial: Webhook | null; onClose: () => void; onCreated: (w: Webhook, secret: string) => void }) {
  const [form] = Form.useForm<FormValues>();
  const save = useApiMutation(
    async (v: FormValues) => {
      const body: WebhookRequest = { url: v.url.trim(), events: v.events, status: v.status };
      if (initial) return { kind: 'updated' as const, w: await api.updateWebhook(initial.id, body) };
      const r = await api.createWebhook(body);
      return { kind: 'created' as const, w: r.webhook, secret: r.secret };
    },
    {
      success: (r) => (r.kind === 'created' ? 'Webhook created' : 'Webhook saved'),
      invalidate: [qk.webhooks],
      onSuccess: (r) => {
        onClose();
        if (r.kind === 'created') onCreated(r.w, r.secret);
      },
    },
  );
  return (
    <Modal
      open
      title={initial ? 'Edit webhook' : 'New webhook'}
      okText={initial ? 'Save' : 'Create webhook'}
      onCancel={onClose}
      onOk={() => form.submit()}
      okButtonProps={{ loading: save.isPending }}
      destroyOnHidden
      width={600}
    >
      <Typography.Paragraph type="secondary">CamTech POSTs a signed JSON message to this URL when the selected events happen.</Typography.Paragraph>
      <Form<FormValues>
        form={form}
        layout="vertical"
        initialValues={initial ? { url: initial.url, events: initial.events, status: initial.status } : { url: '', events: [...WEBHOOK_EVENTS], status: 'ACTIVE' }}
        onFinish={(v) => save.mutate(v)}
      >
        <Form.Item
          name="url"
          label="Endpoint URL"
          rules={[
            { required: true, message: 'Enter the URL' },
            { type: 'url', message: 'Enter a full URL (https://…)' },
            { pattern: /^https?:\/\//i, message: 'The URL must start with https://' },
          ]}
          extra="Use https in production. Reply with any 2xx within 10 seconds."
        >
          <Input placeholder="https://api.example.com/hooks/camtech" style={{ fontFamily: 'monospace' }} />
        </Form.Item>
        <Form.Item name="events" label="Events" rules={[{ required: true, type: 'array', min: 1, message: 'Pick at least one event' }]}>
          <Checkbox.Group style={{ display: 'grid', gap: 8 }}>
            {WEBHOOK_EVENTS.map((e) => (
              <Checkbox key={e} value={e}>
                <span>
                  {webhookEventLabel(e)}{' '}
                  <Typography.Text type="secondary" className="ct-mono" style={{ fontSize: 12 }}>
                    {e}
                  </Typography.Text>
                  <br />
                  <span className="ct-meta">{WEBHOOK_EVENT_HELP[e]}</span>
                </span>
              </Checkbox>
            ))}
          </Checkbox.Group>
        </Form.Item>
        <Form.Item name="status" label="Status">
          <Radio.Group
            optionType="button"
            options={[
              { value: 'ACTIVE', label: 'Active' },
              { value: 'DISABLED', label: 'Disabled (nothing is sent)' },
            ]}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function Deliveries({ webhook }: { webhook: Webhook }) {
  const [page, setPage] = useState(0);
  const size = 10;
  const q = useQuery({ queryKey: qk.deliveries(webhook.id, page), queryFn: () => api.deliveries(webhook.id, { page, size }), placeholderData: keepPreviousData });
  const { canBuild } = usePermissions();
  const retry = useApiMutation((d: WebhookDelivery) => api.retryDelivery(d.id), {
    success: (d) => (d.status === 'DELIVERED' ? 'Delivered' : `Retry ${d.status.toLowerCase()}${d.error ? `: ${d.error}` : ''}`),
    invalidate: [['deliveries', webhook.id], qk.webhooks],
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  return (
    <Table<WebhookDelivery>
      size="small"
      rowKey="id"
      loading={q.isPending ? true : q.isFetching ? { delay: 300 } : false}
      dataSource={q.data?.items}
      scroll={{ x: 820 }}
      locale={{ emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Nothing sent yet. Use “Send test”." /> }}
      pagination={{ current: page + 1, pageSize: size, total: q.data?.total ?? 0, onChange: (p) => setPage(p - 1), showTotal: (t) => `${t.toLocaleString('en')} deliveries`, showSizeChanger: false }}
      columns={[
        {
          title: 'When',
          dataIndex: 'createdAt',
          width: 130,
          render: (v: string) => (
            <span className="ct-meta">
              <DateText value={v} relative />
            </span>
          ),
        },
        {
          title: 'Event',
          dataIndex: 'eventType',
          render: (v: string) => (
            <span title={v} style={{ fontWeight: 600 }}>
              {webhookEventLabel(v)}
            </span>
          ),
        },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v: string) => <DeliveryStatusTag value={v} /> },
        {
          title: 'HTTP',
          dataIndex: 'httpStatus',
          width: 70,
          render: (v: number | null) => <Typography.Text className="tabular" type={v === null ? 'secondary' : v >= 400 ? 'danger' : undefined}>{v ?? '—'}</Typography.Text>,
        },
        { title: 'Attempt', dataIndex: 'attempt', width: 80, align: 'right', render: (v: number) => <span className="tabular">{v}</span> },
        {
          title: 'Error / next retry',
          render: (_, d) => (
            <span>
              {d.error && <Typography.Text type="danger">{d.error}</Typography.Text>}
              {d.nextRetryAt && (
                <Typography.Text type="secondary">
                  {d.error ? ' · ' : ''}next retry <DateText value={d.nextRetryAt} relative />
                </Typography.Text>
              )}
              {!d.error && !d.nextRetryAt && <Typography.Text type="secondary">—</Typography.Text>}
            </span>
          ),
        },
        {
          title: '',
          width: 90,
          align: 'right',
          render: (_, d) =>
            canBuild && (d.status === 'FAILED' || d.status === 'RETRYING') ? (
              <Button size="small" icon={<RedoOutlined />} loading={retry.isPending && retry.variables?.id === d.id} onClick={() => retry.mutate(d)}>
                Retry
              </Button>
            ) : null,
        },
      ]}
    />
  );
}

function VerifySignatures() {
  return (
    <Card id="verify">
      <SectionTitle title="Verify signatures" />
      <Typography.Paragraph type="secondary">
        Every request carries <Typography.Text code>X-Camtech-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</Typography.Text>. Compute{' '}
        <Typography.Text code>HMAC-SHA256(secret, t + "." + rawBody)</Typography.Text>, compare it with <Typography.Text code>v1</Typography.Text> in constant time, and
        reject requests whose <Typography.Text code>t</Typography.Text> is more than 5 minutes old. Retries arrive after 30 s, 2 min, 10 min, 30 min and 2 h; de-duplicate
        on <Typography.Text code>X-Camtech-Delivery</Typography.Text>.
      </Typography.Paragraph>
      <Row gutter={[24, 24]}>
        <Col xs={24} xxl={14}>
          <SnippetTabs snippets={webhookSignatureSnippets()} maxHeight={420} />
        </Col>
        <Col xs={24} xxl={10}>
          <SnippetTabs snippets={[webhookPayloadSample(), reviewDecidedPayloadSample()]} maxHeight={420} />
        </Col>
      </Row>
    </Card>
  );
}

export default function WebhooksPage() {
  const info = useTenantInfo();
  const q = useWebhooks();
  const [params, setParams] = useSearchParams();
  const [editing, setEditing] = useState<Webhook | null | undefined>(undefined);
  const [secret, setSecret] = useState<{ url: string; secret: string } | null>(null);
  const [testResult, setTestResult] = useState<{ webhook: Webhook; delivery: WebhookDelivery } | null>(null);
  const enabled = info.features.some((f) => f.code === 'WEBHOOKS' && f.enabled);
  const { canBuild } = usePermissions();

  const selectedId = Number(params.get('webhook')) || null;
  const select = (id: number) =>
    setParams((p) => {
      const n = new URLSearchParams(p);
      n.set('webhook', String(id));
      return n;
    }, { replace: true });

  useEffect(() => {
    if (params.get('new') === '1') {
      if (canBuild) setEditing(null);
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.delete('new');
        return n;
      }, { replace: true });
    }
  }, [params, setParams, canBuild]);

  const test = useApiMutation((w: Webhook) => api.testWebhook(w.id), {
    invalidate: [['deliveries'], qk.webhooks],
    onSuccess: (d, w) => {
      setTestResult({ webhook: w, delivery: d });
      select(w.id);
    },
  });
  const rotate = useApiMutation((w: Webhook) => api.rotateWebhookSecret(w.id), {
    success: 'Signing secret rotated',
    invalidate: [qk.webhooks],
    onSuccess: (r) => setSecret({ url: r.webhook.url, secret: r.secret }),
  });
  const remove = useApiMutation((w: Webhook) => api.deleteWebhook(w.id), { success: 'Webhook deleted', invalidate: [qk.webhooks] });

  const current = q.data?.find((w) => w.id === selectedId) ?? q.data?.[0];
  const newButton = canBuild ? (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)} disabled={!enabled}>
      New webhook
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Webhooks"
        help="Your backend gets a signed message when something happens: a verification finishes, a review is decided, a document is about to expire…"
        extra={newButton}
      />
      {q.data?.some((w) => w.failing && w.status === 'ACTIVE') && <Alert type="error" showIcon style={{ marginBottom: 16 }} title={t('webhooks.failing.alert')} />}
      {!enabled && <Alert type="warning" showIcon style={{ marginBottom: 16 }} title="Webhooks are not in your plan. Ask CamTech to enable them for your tenant." />}
      <Flex vertical gap={24}>
        <DataState
          query={q}
          isEmpty={(d) => d.length === 0}
          empty={
            <Card>
              <Empty image={<ApiOutlined style={{ fontSize: 44, opacity: 0.35 }} />} description="No webhooks yet. Add your backend's endpoint to be told about results.">
                {newButton}
              </Empty>
            </Card>
          }
        >
          {(list) => (
            <Flex vertical gap={24}>
              <TableFrame>
              <Table<Webhook>
                rowKey="id"
                pagination={false}
                dataSource={list}
                scroll={{ x: 980 }}
                rowClassName={(w) => `clickable-row ${current?.id === w.id ? 'ant-table-row-selected' : ''}`}
                onRow={(w) => ({ onClick: () => select(w.id) })}
                columns={[
                  {
                    title: 'Endpoint',
                    dataIndex: 'url',
                    width: 340,
                    render: (v: string) => <EndpointCell url={v} />,
                  },
                  {
                    title: 'Events',
                    dataIndex: 'events',
                    render: (v: string[]) => {
                      const text = v.length === WEBHOOK_EVENTS.length ? 'All events' : v.map(webhookEventLabel).join(', ');
                      return (
                        <Typography.Text type="secondary" ellipsis={{ tooltip: text }} style={{ maxWidth: 260 }}>
                          {text}
                        </Typography.Text>
                      );
                    },
                  },
                  {
                    title: 'Status',
                    width: 170,
                    render: (_, w) => (
                      <Flex gap={4} wrap>
                        <ActiveTag value={w.status} />
                        {w.failing && (
                          <Tooltip title={t('webhooks.failing.tooltip', { n: w.consecutiveFailures })}>
                            <Tag color="red" variant="filled" className="ct-pill">
                              {t('webhooks.failing')}
                            </Tag>
                          </Tooltip>
                        )}
                      </Flex>
                    ),
                  },
                  {
                    title: 'Last delivery',
                    width: 190,
                    render: (_, w) =>
                      w.lastDeliveryAt ? (
                        <Flex gap={6} align="center">
                          <span className="ct-meta">
                            <DateText value={w.lastDeliveryAt} relative />
                          </span>{' '}
                          {w.lastStatus && <DeliveryStatusTag value={w.lastStatus} />}
                        </Flex>
                      ) : (
                        <span className="ct-meta">Never</span>
                      ),
                  },
                  {
                    key: 'actions',
                    width: 150,
                    align: 'right',
                    render: (_, w) =>
                      canBuild && (
                        <RowActions
                          label="Webhook actions"
                          primary={
                            <Tooltip title={w.status === 'ACTIVE' ? 'Send a TEST event now' : 'Enable the webhook to send a test'}>
                              <Button size="small" icon={<SendOutlined />} disabled={w.status !== 'ACTIVE'} loading={test.isPending && test.variables?.id === w.id} onClick={() => test.mutate(w)}>
                                Send test
                              </Button>
                            </Tooltip>
                          }
                          items={[
                            { key: 'edit', label: 'Edit', icon: <EditOutlined />, onClick: () => setEditing(w) },
                            {
                              key: 'rotate',
                              label: 'Rotate secret',
                              icon: <SyncOutlined />,
                              onClick: () => rotate.mutateAsync(w),
                              confirm: {
                                title: 'Rotate the signing secret?',
                                description: 'A new secret is generated and the old one stops working immediately. Update your receiver right away, or it will reject the messages.',
                                okText: 'Rotate',
                              },
                            },
                            {
                              key: 'delete',
                              label: 'Delete',
                              icon: <DeleteOutlined />,
                              danger: true,
                              onClick: () => remove.mutateAsync(w),
                              confirm: {
                                title: 'Delete this webhook?',
                                description: <>Nothing will be sent to <Typography.Text code>{w.url}</Typography.Text> any more. Its delivery history is removed.</>,
                                okText: 'Delete',
                              },
                            },
                          ]}
                        />
                      ),
                  },
                ]}
              />
              </TableFrame>
              {testResult && (
                <Alert
                  type={testResult.delivery.status === 'DELIVERED' ? 'success' : 'error'}
                  showIcon
                  closable={{ onClose: () => setTestResult(null), 'aria-label': 'Dismiss' }}
                  title={
                    testResult.delivery.status === 'DELIVERED'
                      ? `Test delivered: your endpoint answered HTTP ${testResult.delivery.httpStatus ?? ''}`
                      : `Test not delivered${testResult.delivery.httpStatus ? ` (HTTP ${testResult.delivery.httpStatus})` : ''}`
                  }
                  description={
                    <span>
                      <Typography.Text code>{testResult.webhook.url}</Typography.Text>
                      {testResult.delivery.error && <> · {testResult.delivery.error}</>}
                    </span>
                  }
                />
              )}
              {current && (
                <Card>
                  <SectionTitle title="Deliveries" sub={<span className="ct-mono">{current.url}</span>} />
                  <Deliveries key={current.id} webhook={current} />
                </Card>
              )}
            </Flex>
          )}
        </DataState>
        <VerifySignatures />
      </Flex>
      {editing !== undefined && canBuild && (
        <WebhookForm
          initial={editing}
          onClose={() => setEditing(undefined)}
          onCreated={(w, s) => {
            select(w.id);
            setSecret({ url: w.url, secret: s });
          }}
        />
      )}
      <SecretModal
        open={!!secret}
        title="Webhook signing secret"
        what="signing secret"
        fields={secret ? [{ label: 'Signing secret', value: secret.secret, secret: true }] : []}
        envText={secret ? `CAMTECH_WEBHOOK_SECRET=${secret.secret}` : undefined}
        extra={secret ? <Typography.Paragraph type="secondary">For <Typography.Text code>{secret.url}</Typography.Text>. Use it to verify the X-Camtech-Signature header.</Typography.Paragraph> : undefined}
        onClose={() => setSecret(null)}
      />
    </>
  );
}

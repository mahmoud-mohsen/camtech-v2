import { DeleteOutlined, EditOutlined, PlusOutlined, RedoOutlined, SendOutlined, SyncOutlined } from '@ant-design/icons';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { App, Button, Card, Checkbox, Empty, Flex, Form, Input, Modal, Select, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { webhooksApi } from '../../api/configuration';
import type { Webhook, WebhookDelivery } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { ConfirmAction } from '../../components/ConfirmAction';
import { DataState, ErrorState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { ReadOnlyHint } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { SecretModal } from '../../components/SecretModal';
import { ActiveTag, DeliveryStatusTag } from '../../components/Tags';
import { useApiMutation } from '../../lib/hooks';
import { WEBHOOK_EVENT_HELP, WEBHOOK_EVENTS, webhookEventLabel } from '../../lib/labels';

/** Red tag when the last deliveries all failed. */
function FailingTag({ webhook }: { webhook: Webhook }) {
  if (!webhook.failing) return null;
  return (
    <Tooltip title={`The last ${webhook.consecutiveFailures} deliveries failed`}>
      <Tag variant="filled" className="ct-pill" color="error">Failing</Tag>
    </Tooltip>
  );
}

interface FormValues {
  url: string;
  events: string[];
  status?: Webhook['status'];
}

function WebhookForm({ initial, onClose, onCreated }: { initial: Webhook | null; onClose: () => void; onCreated: (secret: string) => void }) {
  const [form] = Form.useForm<FormValues>();
  const save = useApiMutation(
    async (v: FormValues) => {
      if (initial) return { kind: 'updated' as const, w: await webhooksApi.update(initial.id, { url: v.url.trim(), events: v.events, status: v.status ?? initial.status }) };
      const r = await webhooksApi.create(v.url.trim(), v.events);
      return { kind: 'created' as const, w: r.webhook, secret: r.secret };
    },
    {
      success: (r) => (r.kind === 'created' ? 'Webhook created' : 'Webhook saved'),
      invalidate: [['webhooks']],
      onSuccess: (r) => {
        onClose();
        if (r.kind === 'created') onCreated(r.secret);
      },
    },
  );
  return (
    <Modal open title={initial ? 'Edit webhook' : 'New webhook'} okText={initial ? 'Save' : 'Create'} onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} destroyOnHidden>
      <Typography.Paragraph type="secondary">CamTech will POST a signed JSON message to this URL when the selected events happen.</Typography.Paragraph>
      <Form form={form} layout="vertical" initialValues={initial ?? { events: [...WEBHOOK_EVENTS] }} onFinish={(v) => save.mutate(v)}>
        <Form.Item name="url" label="URL" rules={[{ required: true, message: 'Enter the URL' }, { type: 'url', message: 'Enter a valid URL (https://…)' }]}>
          <Input placeholder="https://example.com/camtech/events" />
        </Form.Item>
        <Form.Item name="events" label="Events" rules={[{ required: true, type: 'array', min: 1, message: 'Pick at least one event' }]}>
          <Checkbox.Group
            options={WEBHOOK_EVENTS.map((e) => ({
              value: e,
              label: (
                <span>
                  {webhookEventLabel(e)} <span className="ct-meta">{e}</span>
                  <br />
                  <span className="ct-meta">{WEBHOOK_EVENT_HELP[e]}</span>
                </span>
              ),
            }))}
            style={{ display: 'grid', gap: 8 }}
          />
        </Form.Item>
        {initial && (
          <Form.Item name="status" label="Status">
            <Select options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled (nothing is sent)' }]} />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

function Deliveries({ webhook }: { webhook: Webhook }) {
  const { isAdmin } = usePermissions();
  const [page, setPage] = useState(0);
  const q = useQuery({ queryKey: ['deliveries', webhook.id, page], queryFn: () => webhooksApi.deliveries(webhook.id, page, 10), placeholderData: keepPreviousData });
  const retry = useApiMutation((d: WebhookDelivery) => webhooksApi.retry(d.id), {
    success: (d) => (d.status === 'DELIVERED' ? 'Delivered' : `Retry queued (${d.status.toLowerCase()})`),
    invalidate: [['deliveries', webhook.id], ['webhooks']],
  });
  if (q.isError) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  return (
    <Table<WebhookDelivery>
      size="small"
      rowKey="id"
      loading={q.isPending}
      dataSource={q.data?.items}
      scroll={{ x: 800 }}
      locale={{ emptyText: 'Nothing sent yet' }}
      pagination={{ current: page + 1, pageSize: 10, total: q.data?.total ?? 0, onChange: (p) => setPage(p - 1), showTotal: (t) => `${t} deliveries` }}
      columns={[
        { title: 'When', dataIndex: 'createdAt', width: 130, render: (v: string) => <DateText value={v} relative /> },
        { title: 'Event', dataIndex: 'eventType', render: (v: string) => <span title={v}>{webhookEventLabel(v)}</span> },
        { title: 'Status', dataIndex: 'status', width: 110, render: (v: string) => <DeliveryStatusTag value={v} /> },
        { title: 'HTTP', dataIndex: 'httpStatus', width: 70, render: (v: number | null) => <span className="tabular">{v ?? '—'}</span> },
        { title: 'Attempt', dataIndex: 'attempt', width: 80, align: 'right', render: (v: number) => <span className="tabular">{v}</span> },
        {
          title: 'Error / next retry',
          render: (_, d) => (
            <span>
              {d.error && <Typography.Text type="danger">{d.error}</Typography.Text>}
              {d.nextRetryAt && <Typography.Text type="secondary"> · next retry <DateText value={d.nextRetryAt} relative /></Typography.Text>}
            </span>
          ),
        },
        {
          title: '',
          width: 90,
          align: 'right',
          render: (_, d) =>
            isAdmin && d.eventType !== 'WEBHOOK_TEST' && d.eventType !== 'TEST' && (d.status === 'FAILED' || d.status === 'RETRYING') ? (
              <Button size="small" icon={<RedoOutlined />} loading={retry.isPending && retry.variables?.id === d.id} onClick={() => retry.mutate(d)}>
                Retry
              </Button>
            ) : null,
        },
      ]}
    />
  );
}

export default function WebhooksPage() {
  const { isAdmin } = usePermissions();
  const { message } = App.useApp();
  const q = useQuery({ queryKey: ['webhooks'], queryFn: webhooksApi.list });
  const [editing, setEditing] = useState<Webhook | null | undefined>(undefined);
  const [selected, setSelected] = useState<number | null>(null);
  const [secret, setSecret] = useState<string | null>(null);
  const test = useApiMutation((w: Webhook) => webhooksApi.test(w.id), {
    invalidate: [['deliveries'], ['webhooks']],
    onSuccess: (d) => {
      if (d.status === 'DELIVERED') message.success(`Test delivered (HTTP ${d.httpStatus})`);
      else message.warning(`Test not delivered: ${d.error ?? d.status}`);
    },
  });
  const rotate = useApiMutation((w: Webhook) => webhooksApi.rotateSecret(w.id), { success: 'Secret rotated', invalidate: [['webhooks']], onSuccess: (r) => setSecret(r.secret) });
  const remove = useApiMutation((w: Webhook) => webhooksApi.remove(w.id), {
    success: 'Webhook deleted',
    invalidate: [['webhooks']],
    onSuccess: (_, w) => selected === w.id && setSelected(null),
  });
  const current = q.data?.find((w) => w.id === (selected ?? q.data?.[0]?.id));

  return (
    <>
      <PageHeader
        title="Webhooks"
        help="Your systems get notified when a verification completes or expires, when a review is opened or decided, when a document scan needs or gets a review, when a document is about to expire, and when a person's data is erased."
        extra={isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>New webhook</Button>}
      />
      <ReadOnlyHint what="webhooks" />
      <DataState query={q} isEmpty={(d) => d.length === 0} empty={<Empty description="No webhooks yet" />}>
        {(list) => (
          <Flex vertical gap={16}>
            <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
              <Table<Webhook>
                rowKey="id"
                pagination={false}
                dataSource={list}
                scroll={{ x: 900 }}
                rowClassName={(w) => `clickable-row ${current?.id === w.id ? 'ant-table-row-selected' : ''}`}
                onRow={(w) => ({ onClick: () => setSelected(w.id) })}
                columns={[
                  { title: 'URL', dataIndex: 'url', render: (v: string) => <Typography.Text copyable={{ text: v }} style={{ wordBreak: 'break-all' }}>{v}</Typography.Text> },
                  {
                    title: 'Events',
                    dataIndex: 'events',
                    render: (v: string[]) => (
                      <span className="ct-meta">{v.map(webhookEventLabel).join(', ')}</span>
                    ),
                  },
                  {
                    title: 'Status',
                    dataIndex: 'status',
                    width: 130,
                    render: (v: string, w) => (
                      <Flex gap={4} wrap>
                        <ActiveTag value={v} />
                        <FailingTag webhook={w} />
                      </Flex>
                    ),
                  },
                  {
                    title: 'Last delivery',
                    width: 170,
                    render: (_, w) =>
                      w.lastDeliveryAt ? (
                        <Flex gap={6} align="center">
                          <DateText value={w.lastDeliveryAt} relative /> {w.lastStatus && <DeliveryStatusTag value={w.lastStatus} />}
                        </Flex>
                      ) : (
                        <Typography.Text type="secondary">Never</Typography.Text>
                      ),
                  },
                  {
                    title: '',
                    width: 260,
                    align: 'right',
                    render: (_, w) =>
                      isAdmin && (
                        <Flex gap={4} justify="flex-end" onClick={(e) => e.stopPropagation()} wrap>
                          <Tooltip title="Edit">
                            <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(w)} aria-label="Edit" />
                          </Tooltip>
                          <Tooltip title="Send a test event">
                            <Button size="small" icon={<SendOutlined />} loading={test.isPending && test.variables?.id === w.id} onClick={() => test.mutate(w)}>Test</Button>
                          </Tooltip>
                          <ConfirmAction
                            label="Rotate secret"
                            buttonProps={{ size: 'small', icon: <SyncOutlined /> }}
                            title="Rotate the signing secret?"
                            description="A new secret is generated. Your receiver must start using it to verify signatures, otherwise it will reject the messages."
                            okText="Rotate"
                            onConfirm={() => rotate.mutateAsync(w)}
                          />
                          <ConfirmAction
                            danger
                            label={<DeleteOutlined />}
                            buttonProps={{ size: 'small', 'aria-label': 'Delete' }}
                            title="Delete this webhook?"
                            description={`Nothing will be sent to ${w.url} any more.`}
                            okText="Delete"
                            onConfirm={() => remove.mutateAsync(w)}
                          />
                        </Flex>
                      ),
                  },
                ]}
              />
            </div>
            {current && (
              <Card title={<span>Deliveries · <Typography.Text type="secondary" style={{ fontWeight: 400 }}>{current.url}</Typography.Text></span>}>
                <Deliveries webhook={current} />
              </Card>
            )}
          </Flex>
        )}
      </DataState>
      {editing !== undefined && <WebhookForm initial={editing} onClose={() => setEditing(undefined)} onCreated={setSecret} />}
      <SecretModal open={!!secret} title="Webhook signing secret" what="signing secret" value={secret} onClose={() => setSecret(null)} />
    </>
  );
}

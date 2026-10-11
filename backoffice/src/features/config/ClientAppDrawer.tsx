import { KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Card, DatePicker, Descriptions, Drawer, Empty, Flex, Form, Grid, Input, Modal, Select, Skeleton, Switch, Table, Tabs, Tag, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { clientAppsApi, tenantApi } from '../../api/configuration';
import type { ClientApp, ClientAppUpdate, Credential } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { ConfirmAction } from '../../components/ConfirmAction';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { JsonBlock } from '../../components/Misc';
import { SecretModal } from '../../components/SecretModal';
import { ActiveTag, CodeLabel } from '../../components/Tags';
import { useApiMutation } from '../../lib/hooks';
import { channelLabel, docTypeLabel, FEATURE_HELP, featureLabel, flowLabel, stepLabel } from '../../lib/labels';
import type { Dayjs } from 'dayjs';

function DetailsForm({ app }: { app: ClientApp }) {
  const { isAdmin } = usePermissions();
  const [form] = Form.useForm<ClientAppUpdate & { origins: string }>();
  useEffect(() => {
    form.setFieldsValue({ ...app, origins: app.allowedOrigins.join('\n') });
  }, [app, form]);
  const save = useApiMutation(
    (v: ClientAppUpdate & { origins: string }) =>
      clientAppsApi.update(app.id, {
        name: v.name.trim(),
        platform: v.platform?.trim() || null,
        appIdentifier: v.appIdentifier?.trim() || null,
        allowedOrigins: (v.origins ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
        status: v.status,
      }),
    { success: 'Client app saved', invalidate: [['client-apps'], ['capabilities', app.id]] },
  );
  return (
    <Form form={form} layout="vertical" disabled={!isAdmin} onFinish={(v) => save.mutate(v)}>
      <Descriptions size="small" column={2} style={{ marginBottom: 16 }} items={[
        { label: 'Code', children: <Typography.Text code>{app.code}</Typography.Text> },
        { label: 'Channel', children: channelLabel(app.channel) },
      ]} />
      <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Enter a name' }]}>
        <Input />
      </Form.Item>
      <Form.Item name="platform" label="Platform">
        <Input />
      </Form.Item>
      <Form.Item name="appIdentifier" label="App identifier" extra="Bundle id / package name for mobile apps.">
        <Input />
      </Form.Item>
      <Form.Item name="origins" label="Allowed origins" extra="One per line. Browsers may only call the API from these origins.">
        <Input.TextArea rows={3} />
      </Form.Item>
      <Form.Item name="status" label="Status" extra="A disabled app can't start new verifications.">
        <Select options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }]} />
      </Form.Item>
      {isAdmin && (
        <Button type="primary" htmlType="submit" loading={save.isPending}>
          Save changes
        </Button>
      )}
    </Form>
  );
}

function Permissions({ app }: { app: ClientApp }) {
  const { isAdmin } = usePermissions();
  const ents = useQuery({ queryKey: ['entitlements'], queryFn: tenantApi.entitlements });
  const [pendingCode, setPendingCode] = useState<string | null>(null);
  const save = useApiMutation((perms: { featureCode: string; allowed: boolean }[]) => clientAppsApi.setPermissions(app.id, perms), {
    success: 'Permissions saved',
    invalidate: [['client-apps'], ['capabilities', app.id]],
  });
  // Every flow / feature the tenant has, plus anything already on the app.
  const codes = [...new Set([...(ents.data ?? []).filter((e) => e.featureType !== 'DOCUMENT').map((e) => e.featureCode), ...app.permissions.map((p) => p.featureCode)])];
  const allowed = (c: string) => app.permissions.find((p) => p.featureCode === c)?.allowed ?? false;
  const entitlement = (c: string) => ents.data?.find((e) => e.featureCode === c);
  if (ents.isPending) return <Skeleton active />;
  return (
    <>
      <Typography.Paragraph type="secondary">
        What this app may use. A feature also has to be enabled for the tenant (Tenant &amp; entitlements) to work.
      </Typography.Paragraph>
      <Table
        size="small"
        rowKey={(c) => c}
        pagination={false}
        dataSource={codes}
        columns={[
          {
            title: 'Feature',
            render: (_, c: string) => (
              <div>
                <CodeLabel label={featureLabel(c)} code={c} />
                {FEATURE_HELP[c] && (
                  <div>
                    <span className="ct-meta">{FEATURE_HELP[c]}</span>
                  </div>
                )}
              </div>
            ),
          },
          {
            title: 'Tenant',
            width: 110,
            render: (_, c: string) => {
              const e = entitlement(c);
              return e?.enabled ? <Tag variant="filled" className="ct-pill" color="success">Enabled</Tag> : <Tag variant="filled" className="ct-pill">Not enabled</Tag>;
            },
          },
          {
            title: 'Allowed',
            width: 90,
            render: (_, c: string) => (
              <Switch
                checked={allowed(c)}
                disabled={!isAdmin}
                loading={save.isPending && pendingCode === c}
                onChange={(v) => {
                  setPendingCode(c);
                  // PUT replaces the whole list, so always send every feature.
                  save.mutate(codes.map((x) => ({ featureCode: x, allowed: x === c ? v : allowed(x) })));
                }}
              />
            ),
          },
        ]}
      />
    </>
  );
}

function Credentials({ app }: { app: ClientApp }) {
  const { isAdmin } = usePermissions();
  const q = useQuery({ queryKey: ['credentials', app.id], queryFn: () => clientAppsApi.credentials(app.id) });
  const [creating, setCreating] = useState(false);
  const [expires, setExpires] = useState<Dayjs | null>(null);
  const [secret, setSecret] = useState<{ keyId: string; secret: string } | null>(null);
  const create = useApiMutation(() => clientAppsApi.createCredential(app.id, expires ? expires.endOf('day').toISOString() : null), {
    success: 'Credential created',
    invalidate: [['credentials', app.id], ['client-apps']],
    onSuccess: (r) => {
      setCreating(false);
      setExpires(null);
      setSecret({ keyId: r.credential.keyId, secret: r.secret });
    },
  });
  const revoke = useApiMutation((c: Credential) => clientAppsApi.revokeCredential(c.id), {
    success: 'Credential revoked',
    invalidate: [['credentials', app.id], ['client-apps']],
  });
  return (
    <>
      <Flex justify="space-between" align="center" style={{ marginBottom: 12 }} gap={8} wrap>
        <Typography.Text type="secondary">The app signs in to the API with a key id and a secret.</Typography.Text>
        {isAdmin && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            New credential
          </Button>
        )}
      </Flex>
      <DataState query={q} isEmpty={(d) => d.length === 0} empty={<Empty description="No credentials yet" />}>
        {(list) => (
          <Table<Credential>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={list}
            scroll={{ x: 600 }}
            columns={[
              { title: 'Key id', dataIndex: 'keyId', render: (v: string) => <Typography.Text code copyable>{v}</Typography.Text> },
              { title: 'Status', dataIndex: 'status', render: (v: string) => <ActiveTag value={v} /> },
              { title: 'Created', dataIndex: 'createdAt', render: (v: string) => <DateText value={v} dateOnly /> },
              { title: 'Expires', dataIndex: 'expiresAt', render: (v: string | null) => (v ? <DateText value={v} dateOnly /> : 'Never') },
              { title: 'Last used', dataIndex: 'lastUsedAt', render: (v: string | null) => (v ? <DateText value={v} relative /> : 'Never') },
              {
                title: '',
                align: 'right',
                render: (_, c) =>
                  isAdmin && c.status === 'ACTIVE' ? (
                    <ConfirmAction
                      danger
                      label="Revoke"
                      buttonProps={{ size: 'small' }}
                      title="Revoke this credential?"
                      description={`Any app using ${c.keyId} will immediately stop working. This can't be undone.`}
                      okText="Revoke"
                      onConfirm={() => revoke.mutateAsync(c)}
                    />
                  ) : null,
              },
            ]}
          />
        )}
      </DataState>
      <Modal open={creating} title="New credential" okText="Create" onCancel={() => setCreating(false)} onOk={() => create.mutate(undefined)} okButtonProps={{ loading: create.isPending }}>
        <Typography.Paragraph>A new key id and secret will be generated. The secret is shown only once.</Typography.Paragraph>
        <Form layout="vertical">
          <Form.Item label="Expires on" extra="Optional. Leave empty for a credential that doesn't expire.">
            <DatePicker value={expires} onChange={setExpires} disabledDate={(d) => d.isBefore(new Date(), 'day')} />
          </Form.Item>
        </Form>
      </Modal>
      <SecretModal
        open={!!secret}
        title="Credential created"
        what="client secret"
        value={secret?.secret ?? null}
        extra={<Typography.Paragraph>Key id: <Typography.Text code copyable>{secret?.keyId}</Typography.Text></Typography.Paragraph>}
        onClose={() => setSecret(null)}
      />
    </>
  );
}

function CapabilitiesPreview({ app }: { app: ClientApp }) {
  const q = useQuery({ queryKey: ['capabilities', app.id], queryFn: () => clientAppsApi.capabilities(app.id) });
  const [raw, setRaw] = useState(false);
  return (
    <DataState query={q}>
      {(c) => (
        <Flex vertical gap={12}>
          <Flex justify="space-between" align="center" gap={8} wrap>
            <Typography.Text type="secondary">Exactly what this app receives from <Typography.Text code>GET /v2/capabilities</Typography.Text>.</Typography.Text>
            <Flex gap={6} align="center">
              <Switch size="small" checked={raw} onChange={setRaw} /> JSON
            </Flex>
          </Flex>
          {raw ? (
            <JsonBlock value={c} maxHeight={520} />
          ) : (
            <>
              <Descriptions size="small" column={2} items={[
                { label: 'Tenant', children: c.tenant },
                { label: 'Channel', children: channelLabel(c.channel) },
                { label: 'Features', span: 2, children: c.features.length ? <Flex gap={4} wrap>{c.features.map((f) => <Tag variant="filled" className="ct-pill" key={f} title={f}>{featureLabel(f)}</Tag>)}</Flex> : 'None' },
                { label: 'Languages', span: 2, children: c.locales.join(', ') || '—' },
              ]} />
              {c.flows.length === 0 && <Alert type="warning" showIcon title="This app can't run any flow (check status, permissions and entitlements)." />}
              {c.flows.map((f) => (
                <Card key={f.code} size="small" title={<CodeLabel label={flowLabel(f.code)} code={f.code} />}>
                  <Descriptions
                    size="small"
                    column={{ xs: 1, sm: 2 }}
                    items={[
                      { label: 'Steps', span: 2, children: f.steps.map(stepLabel).join(' → ') },
                      { label: 'Documents', span: 2, children: f.documents.length ? f.documents.map(docTypeLabel).join(', ') : 'None' },
                      { label: 'Selfie attempts', children: f.settings.livenessMaxAttempts },
                      { label: 'Document attempts', children: f.settings.documentMaxAttempts },
                      { label: 'Session time', children: `${f.settings.sessionTtlMinutes} min` },
                      { label: 'Device anti-spoof', children: f.settings.deviceAntispoofRequired ? 'Required' : 'Not required' },
                      { label: 'File upload', children: f.settings.fileUploadAllowed ? 'Allowed' : 'Camera only' },
                      ...(f.settings.faceEnrollmentAvailable !== undefined
                        ? [{ label: 'Face registration', children: f.settings.faceEnrollmentAvailable ? 'Available (the face can be registered)' : 'Not available (verify only)' }]
                        : []),
                      {
                        label: 'Quota',
                        children: f.quota.perDay === null ? <Tag variant="filled" className="ct-pill" color="blue">Unlimited</Tag> : `${f.quota.remainingToday ?? '?'} of ${f.quota.perDay} left today`,
                      },
                    ]}
                  />
                </Card>
              ))}
            </>
          )}
        </Flex>
      )}
    </DataState>
  );
}

export function ClientAppDrawer({ app, open, onClose }: { app: ClientApp | null; open: boolean; onClose: () => void }) {
  const screens = Grid.useBreakpoint();
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={screens.md ? 720 : '100%'}
      title={app ? <Flex gap={8} align="center">{app.name} <ActiveTag value={app.status} /></Flex> : 'Client app'}
      destroyOnHidden
    >
      {!app ? (
        <Skeleton active />
      ) : (
        <Tabs
          items={[
            { key: 'details', label: 'Details', children: <DetailsForm app={app} /> },
            { key: 'permissions', label: 'Permissions', children: <Permissions app={app} /> },
            { key: 'credentials', label: <span><KeyOutlined /> Credentials ({app.credentialsCount})</span>, children: <Credentials app={app} /> },
            { key: 'capabilities', label: 'Preview capabilities', children: <CapabilitiesPreview app={app} /> },
          ]}
        />
      )}
    </Drawer>
  );
}

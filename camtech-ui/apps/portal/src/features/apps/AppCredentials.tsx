import { KeyOutlined, PlusOutlined } from '@ant-design/icons';
import type { ClientApp, Credential } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, DatePicker, Empty, Flex, Form, Modal, Radio, Table, Tooltip, Typography } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { ConfirmAction } from '../../components/ConfirmAction';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { SecretModal } from '../../components/SecretModal';
import { ActiveTag } from '../../components/Tags';
import { dayjs } from '../../lib/format';
import { qk, useApiMutation } from '../../lib/hooks';
import { api } from '../../api/client';
import { usePermissions } from '../../auth/useAuth';
import { WebSecretWarning } from './WebSecretWarning';

type ExpiryChoice = 'never' | '90' | '365' | 'custom';

function NewKeyModal({ app, onClose, onCreated }: { app: ClientApp; onClose: () => void; onCreated: (keyId: string, secret: string) => void }) {
  const [choice, setChoice] = useState<ExpiryChoice>('365');
  const [custom, setCustom] = useState<Dayjs | null>(null);
  const expiresAt = (): string | undefined => {
    if (choice === 'never') return undefined;
    if (choice === 'custom') return custom ? custom.endOf('day').toISOString() : undefined;
    return dayjs().add(Number(choice), 'day').endOf('day').toISOString();
  };
  const create = useApiMutation(() => api.createCredential(app.id, expiresAt()), {
    invalidate: [qk.credentials(app.id), qk.clientApps],
    onSuccess: (r) => {
      onClose();
      onCreated(r.credential.keyId, r.secret);
    },
  });
  return (
    <Modal
      open
      title={`New API key for ${app.name}`}
      okText="Create key"
      onCancel={onClose}
      onOk={() => create.mutate(undefined)}
      okButtonProps={{ loading: create.isPending, disabled: choice === 'custom' && !custom }}
      destroyOnHidden
    >
      <Typography.Paragraph>A key id and a secret are generated. The secret is shown only once, right after this.</Typography.Paragraph>
      <Form layout="vertical">
        <Form.Item label="Expires" extra="Rotate keys regularly: create a new one, deploy it, then revoke the old one.">
          <Radio.Group
            value={choice}
            onChange={(e) => setChoice(e.target.value as ExpiryChoice)}
            options={[
              { value: '90', label: 'In 90 days' },
              { value: '365', label: 'In 1 year' },
              { value: 'never', label: 'Never' },
              { value: 'custom', label: 'On a date' },
            ]}
          />
        </Form.Item>
        {choice === 'custom' && (
          <Form.Item label="Expiry date">
            <DatePicker value={custom} onChange={setCustom} disabledDate={(d) => !d.isAfter(dayjs(), 'day')} autoFocus />
          </Form.Item>
        )}
      </Form>
      {app.channel === 'WEB' && <WebSecretWarning compact />}
    </Modal>
  );
}

export function AppCredentials({ app }: { app: ClientApp }) {
  const q = useQuery({ queryKey: qk.credentials(app.id), queryFn: () => api.credentials(app.id) });
  const [creating, setCreating] = useState(false);
  const [secret, setSecret] = useState<{ keyId: string; secret: string } | null>(null);
  const { canBuild } = usePermissions();
  const revoke = useApiMutation((c: Credential) => api.revokeCredential(c.id), {
    success: 'API key revoked',
    invalidate: [qk.credentials(app.id), qk.clientApps],
  });

  return (
    <Flex vertical gap={12}>
      <Flex justify="space-between" align="center" gap={8} wrap>
        <Typography.Text type="secondary" style={{ maxWidth: 460 }}>
          Your backend sends <Typography.Text code>X-Client-Id</Typography.Text> and <Typography.Text code>X-Client-Secret</Typography.Text> to create SDK tokens.
        </Typography.Text>
        {canBuild && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)} disabled={app.status !== 'ACTIVE'}>
            New API key
          </Button>
        )}
      </Flex>
      {canBuild && app.status !== 'ACTIVE' && <Alert type="warning" showIcon title="Enable the app to create keys." />}
      {app.channel === 'WEB' && <WebSecretWarning />}
      <DataState
        query={q}
        isEmpty={(d) => d.length === 0}
        empty={<Empty image={<KeyOutlined style={{ fontSize: 40, opacity: 0.3 }} />} description="No API keys yet" />}
      >
        {(list) => (
          <Table<Credential>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={list}
            scroll={{ x: 640 }}
            rowClassName={(c) => (c.status === 'REVOKED' ? 'row-muted' : '')}
            columns={[
              { title: 'Key id', dataIndex: 'keyId', render: (v: string) => <Typography.Text code copyable style={{ fontSize: 12 }}>{v}</Typography.Text> },
              { title: 'Status', dataIndex: 'status', width: 100, render: (v: string) => <ActiveTag value={v} /> },
              {
                title: 'Created',
                dataIndex: 'createdAt',
                width: 120,
                render: (v: string) => (
                  <span className="ct-meta">
                    <DateText value={v} dateOnly />
                  </span>
                ),
              },
              {
                title: 'Expires',
                dataIndex: 'expiresAt',
                width: 130,
                render: (v: string | null) => {
                  if (!v) return <span className="ct-meta">Never</span>;
                  const days = dayjs(v).diff(dayjs(), 'day');
                  return (
                    <Tooltip title={dayjs(v).format('D MMM YYYY HH:mm')}>
                      <Typography.Text type={days < 0 ? 'danger' : days < 30 ? 'warning' : undefined}>{days < 0 ? 'Expired' : dayjs(v).format('D MMM YYYY')}</Typography.Text>
                    </Tooltip>
                  );
                },
              },
              { title: 'Last used', dataIndex: 'lastUsedAt', width: 130, render: (v: string | null) => <span className="ct-meta">{v ? <DateText value={v} relative /> : 'Never'}</span> },
              {
                title: '',
                align: 'right',
                width: 100,
                render: (_, c) =>
                  c.status === 'ACTIVE' && canBuild ? (
                    <ConfirmAction
                      danger
                      label="Revoke"
                      buttonProps={{ size: 'small' }}
                      title="Revoke this API key?"
                      description={
                        <>
                          Every call using <Typography.Text code>{c.keyId}</Typography.Text> fails immediately with CLIENT_AUTH_INVALID. This can't be undone.
                        </>
                      }
                      typeToConfirm="REVOKE"
                      okText="Revoke key"
                      onConfirm={() => revoke.mutateAsync(c)}
                    />
                  ) : null,
              },
            ]}
          />
        )}
      </DataState>
      {creating && canBuild && <NewKeyModal app={app} onClose={() => setCreating(false)} onCreated={(keyId, s) => setSecret({ keyId, secret: s })} />}
      <SecretModal
        open={!!secret}
        title="API key created"
        what="secret"
        fields={secret ? [{ label: 'Key id (X-Client-Id)', value: secret.keyId }, { label: 'Secret (X-Client-Secret)', value: secret.secret, secret: true }] : []}
        envText={secret ? `CAMTECH_CLIENT_ID=${secret.keyId}\nCAMTECH_CLIENT_SECRET=${secret.secret}` : undefined}
        extra={app.channel === 'WEB' ? <div style={{ marginBottom: 16 }}><WebSecretWarning compact /></div> : undefined}
        onClose={() => setSecret(null)}
      />
    </Flex>
  );
}

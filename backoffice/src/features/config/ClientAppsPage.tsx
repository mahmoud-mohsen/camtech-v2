import { PlusOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Form, Input, Modal, Select, Table, Typography } from 'antd';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { clientAppsApi } from '../../api/configuration';
import type { ClientApp, ClientAppCreate } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { ReadOnlyHint } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { ActiveTag } from '../../components/Tags';
import { useApiMutation, useClientApps } from '../../lib/hooks';
import { CHANNEL_LABELS, channelLabel } from '../../lib/labels';
import { ClientAppDrawer } from './ClientAppDrawer';

function CreateAppModal({ onClose }: { onClose: () => void }) {
  const [form] = Form.useForm<ClientAppCreate & { origins: string }>();
  const navigate = useNavigate();
  const create = useApiMutation(
    (v: ClientAppCreate & { origins: string }) =>
      clientAppsApi.create({
        code: v.code.trim().toUpperCase(),
        name: v.name.trim(),
        channel: v.channel,
        platform: v.platform?.trim() || null,
        appIdentifier: v.appIdentifier?.trim() || null,
        allowedOrigins: (v.origins ?? '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean),
      }),
    {
      success: 'Client app created',
      invalidate: [['client-apps']],
      onSuccess: (app) => {
        onClose();
        navigate(`/config/client-apps/${app.id}`);
      },
    },
  );
  return (
    <Modal open title="New client app" okText="Create" onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: create.isPending }} destroyOnHidden>
      <Typography.Paragraph type="secondary">A client app is a mobile app, website or system that calls the verification API with its own credentials.</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)} initialValues={{ channel: 'MOBILE' }}>
        <Form.Item name="code" label="Code" extra="Upper-case letters, digits and underscores, e.g. PARTNER_APP. Can't be changed later." rules={[{ required: true, pattern: /^[A-Za-z][A-Za-z0-9_]{1,39}$/, message: 'Letters, digits and underscores (2-40)' }]}>
          <Input style={{ textTransform: 'uppercase' }} />
        </Form.Item>
        <Form.Item name="name" label="Name" rules={[{ required: true, message: 'Enter a name' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="channel" label="Channel" rules={[{ required: true }]}>
          <Select options={Object.entries(CHANNEL_LABELS).map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <Form.Item name="platform" label="Platform">
          <Input placeholder="e.g. iOS / Android" />
        </Form.Item>
        <Form.Item name="appIdentifier" label="App identifier" extra="Bundle id / package name for mobile apps.">
          <Input placeholder="com.example.app" />
        </Form.Item>
        <Form.Item name="origins" label="Allowed origins" extra="For web apps: one origin per line, e.g. https://portal.example.com">
          <Input.TextArea rows={2} />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export default function ClientAppsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { isAdmin } = usePermissions();
  const q = useClientApps();
  const [creating, setCreating] = useState(false);
  const selected = q.data?.find((a) => String(a.id) === id) ?? null;

  return (
    <>
      <PageHeader
        title="Client apps"
        help="The apps and systems allowed to call the verification API. Each has its own permissions and credentials."
        extra={isAdmin && <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>New client app</Button>}
      />
      <ReadOnlyHint what="client apps" />
      <DataState query={q} isEmpty={(d) => d.length === 0}>
        {(apps) => (
          <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
            <Table<ClientApp>
              rowKey="id"
              dataSource={apps}
              pagination={false}
              scroll={{ x: 800 }}
              rowClassName={() => 'clickable-row'}
              onRow={(a) => ({ onClick: () => navigate(`/config/client-apps/${a.id}`) })}
              columns={[
                {
                  title: 'App',
                  render: (_, a) => (
                    <div>
                      <div className="ct-strong">{a.name}</div>
                      <span className="ct-mono">{a.code}</span>
                    </div>
                  ),
                },
                { title: 'Channel', dataIndex: 'channel', render: (v: string) => channelLabel(v) },
                { title: 'Platform', dataIndex: 'platform', render: (v: string | null) => v ?? '—' },
                {
                  title: 'Permissions',
                  render: (_, a) => {
                    const n = a.permissions.filter((p) => p.allowed).length;
                    return <span className="tabular">{n} of {a.permissions.length} allowed</span>;
                  },
                },
                { title: 'Credentials', dataIndex: 'credentialsCount', align: 'right', render: (v: number) => <span className="tabular">{v}</span> },
                { title: 'Status', dataIndex: 'status', render: (v: string) => <ActiveTag value={v} /> },
                { title: 'Created', dataIndex: 'createdAt', render: (v: string) => <span className="ct-meta tabular"><DateText value={v} dateOnly /></span> },
                { key: 'open', width: 48, align: 'right', render: () => <RightOutlined style={{ color: 'var(--ct-text-tertiary)' }} /> },
              ]}
            />
          </div>
        )}
      </DataState>
      <ClientAppDrawer app={selected} open={!!id} onClose={() => navigate('/config/client-apps')} />
      {creating && <CreateAppModal onClose={() => setCreating(false)} />}
    </>
  );
}

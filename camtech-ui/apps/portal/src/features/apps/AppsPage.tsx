import { AppstoreAddOutlined, GlobalOutlined, KeyOutlined, MobileOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { CamtechApiError, type ClientApp, type ClientAppCreate } from '@camtech/api-client';
import { AutoComplete, Button, Drawer, Empty, Flex, Form, Grid, Input, Modal, Segmented, Skeleton, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { ActiveTag } from '../../components/Tags';
import { IconTile, TableFrame } from '../../components/ui';
import { qk, useApiMutation, useClientApps } from '../../lib/hooks';
import { channelLabel, PLATFORM_OPTIONS } from '../../lib/labels';
import { api } from '../../api/client';
import { usePermissions } from '../../auth/useAuth';
import { AppCapabilities } from './AppCapabilities';
import { AppCredentials } from './AppCredentials';
import { AppDetails } from './AppDetails';
import { AppPermissions } from './AppPermissions';
import { OriginsEditor } from './OriginsEditor';
import { WebSecretWarning } from './WebSecretWarning';

interface CreateValues {
  code: string;
  name: string;
  channel: 'MOBILE' | 'WEB';
  platform?: string;
  appIdentifier?: string;
  allowedOrigins: string[];
}

function CreateAppModal({ onClose }: { onClose: () => void }) {
  const [form] = Form.useForm<CreateValues>();
  const navigate = useNavigate();
  const channel = Form.useWatch('channel', form) ?? 'WEB';
  const create = useApiMutation(
    (v: CreateValues) => {
      const body: ClientAppCreate = {
        code: v.code.trim().toUpperCase(),
        name: v.name.trim(),
        channel: v.channel,
        platform: v.platform?.trim() || null,
        appIdentifier: v.channel === 'MOBILE' ? v.appIdentifier?.trim() || null : null,
        allowedOrigins: v.channel === 'WEB' ? (v.allowedOrigins ?? []) : [],
      };
      return api.createClientApp(body);
    },
    {
      success: 'App created',
      invalidate: [qk.clientApps],
      onSuccess: (app) => {
        onClose();
        navigate(`/apps/${app.id}?tab=credentials`);
      },
      onError: (err) => {
        if (err instanceof CamtechApiError && err.code === 'CODE_TAKEN') {
          form.setFields([{ name: 'code', errors: ['An app with this code already exists'] }]);
          return true;
        }
        return false;
      },
    },
  );
  return (
    <Modal open title="New app" okText="Create app" onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: create.isPending }} destroyOnHidden width={600}>
      <Typography.Paragraph type="secondary">One app per mobile app or website that runs verifications. Each has its own permissions and API keys.</Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)} initialValues={{ channel: 'WEB', allowedOrigins: [] }} requiredMark="optional">
        <Form.Item name="channel" label="Channel" rules={[{ required: true }]}>
          <Segmented
            block
            options={[
              { value: 'WEB', label: <Flex gap={6} justify="center" align="center" style={{ padding: 4 }}><GlobalOutlined /> Website</Flex> },
              { value: 'MOBILE', label: <Flex gap={6} justify="center" align="center" style={{ padding: 4 }}><MobileOutlined /> Mobile app</Flex> },
            ]}
          />
        </Form.Item>
        <Flex gap={16} wrap>
          <Form.Item
            name="name"
            label="Name"
            rules={[{ required: true, whitespace: true, message: 'Enter a name' }, { max: 100 }]}
            style={{ flex: '1 1 220px' }}
          >
            <Input placeholder={channel === 'WEB' ? 'Customer website' : 'Wallet app'} />
          </Form.Item>
          <Form.Item
            name="code"
            label="Code"
            normalize={(v: string) => v.toUpperCase().replace(/[^A-Z0-9_]/g, '_')}
            extra="Can't be changed later."
            rules={[
              { required: true, message: 'Enter a code' },
              { pattern: /^[A-Z][A-Z0-9_]{1,39}$/, message: '2-40 letters, digits and _, starting with a letter' },
            ]}
            style={{ flex: '1 1 200px' }}
          >
            <Input placeholder={channel === 'WEB' ? 'CUSTOMER_WEB' : 'WALLET_APP'} style={{ fontFamily: 'monospace' }} />
          </Form.Item>
        </Flex>
        <Flex gap={16} wrap>
          <Form.Item name="platform" label="Platform" style={{ flex: '1 1 200px' }}>
            <AutoComplete options={(PLATFORM_OPTIONS[channel] ?? []).map((value) => ({ value }))} placeholder={channel === 'WEB' ? 'Browser' : 'iOS / Android'} />
          </Form.Item>
          {channel === 'MOBILE' && (
            <Form.Item name="appIdentifier" label="App identifier" extra="Bundle id / package name." style={{ flex: '1 1 200px' }}>
              <Input placeholder="com.example.app" style={{ fontFamily: 'monospace' }} />
            </Form.Item>
          )}
        </Flex>
        {channel === 'WEB' && (
          <>
            <Form.Item
              name="allowedOrigins"
              label="Allowed origins"
              extra="The websites that will show the verification. You can change them later."
              rules={[{ validator: (_, v: string[] | undefined) => (v && v.length ? Promise.resolve() : Promise.reject(new Error('Add at least one origin'))) }]}
            >
              <OriginsEditor />
            </Form.Item>
            <WebSecretWarning compact />
          </>
        )}
      </Form>
    </Modal>
  );
}

function AppDrawer({ app, loading, open, onClose }: { app: ClientApp | null; loading: boolean; open: boolean; onClose: () => void }) {
  const screens = Grid.useBreakpoint();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') ?? 'details';
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={screens.md ? 760 : '100%'}
      title={
        app ? (
          <Flex gap={8} align="center" wrap>
            {app.name} <ActiveTag value={app.status} />
            <Tag variant="filled" className="ct-pill">
              {channelLabel(app.channel)}
            </Tag>
          </Flex>
        ) : (
          'App'
        )
      }
      destroyOnHidden
    >
      {!app ? (
        loading ? <Skeleton active /> : <Empty description="This app doesn't exist (or belongs to another tenant)." />
      ) : (
        <Tabs
          activeKey={tab}
          onChange={(k) => setParams((p) => {
            const n = new URLSearchParams(p);
            n.set('tab', k);
            return n;
          }, { replace: true })}
          items={[
            { key: 'details', label: 'Details', children: <AppDetails app={app} /> },
            { key: 'permissions', label: 'Permissions', children: <AppPermissions app={app} /> },
            { key: 'credentials', label: <span><KeyOutlined /> API keys ({app.credentialsCount})</span>, children: <AppCredentials app={app} /> },
            { key: 'capabilities', label: 'Capabilities', children: <AppCapabilities app={app} /> },
          ]}
        />
      )}
    </Drawer>
  );
}

export default function AppsPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const q = useClientApps();
  const [creating, setCreating] = useState(false);
  const { canBuild } = usePermissions();
  const selected = q.data?.find((a) => String(a.id) === id) ?? null;

  // Deep link from "Get started": /apps?new=1 (ignored for roles that can't create apps)
  useEffect(() => {
    if (params.get('new') === '1') {
      if (canBuild) setCreating(true);
      setParams((p) => {
        const n = new URLSearchParams(p);
        n.delete('new');
        return n;
      }, { replace: true });
    }
  }, [params, setParams, canBuild]);

  const newButton = canBuild ? (
    <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
      New app
    </Button>
  ) : null;

  return (
    <>
      <PageHeader
        title="Apps & API keys"
        help="Each app or website that verifies people: the flows it may run, where it may be embedded, and its API keys."
        extra={newButton}
      />
      <DataState
        query={q}
        isEmpty={(d) => d.length === 0}
        empty={
          <Empty image={<AppstoreAddOutlined style={{ fontSize: 48, opacity: 0.35 }} />} description="No apps yet. Create one for each mobile app or website.">
            {newButton}
          </Empty>
        }
      >
        {(apps) => (
          <TableFrame>
          <Table<ClientApp>
            rowKey="id"
            dataSource={apps}
            pagination={false}
            scroll={{ x: 860 }}
            rowClassName={() => 'clickable-row'}
            onRow={(a) => ({ onClick: () => navigate(`/apps/${a.id}`) })}
            columns={[
              {
                title: 'App',
                render: (_, a) => (
                  <Flex gap={12} align="center" style={{ minWidth: 0 }}>
                    <IconTile icon={a.channel === 'WEB' ? <GlobalOutlined /> : <MobileOutlined />} tone="neutral" />
                    <Flex vertical style={{ minWidth: 0 }}>
                      <span className="ct-strong">{a.name}</span>
                      <span className="ct-meta ct-mono">{a.code}</span>
                    </Flex>
                  </Flex>
                ),
              },
              { title: 'Channel', dataIndex: 'channel', width: 110, render: (v: string) => channelLabel(v) },
              {
                title: 'Identifier / origins',
                render: (_, a) =>
                  a.channel === 'WEB' ? (
                    a.allowedOrigins.length ? (
                      <Tooltip title={a.allowedOrigins.join('\n')}>
                        <Typography.Text className="ct-mono">
                          {a.allowedOrigins[0]}
                          {a.allowedOrigins.length > 1 && <Typography.Text type="secondary"> +{a.allowedOrigins.length - 1}</Typography.Text>}
                        </Typography.Text>
                      </Tooltip>
                    ) : (
                      <Typography.Text type="warning">No origins</Typography.Text>
                    )
                  ) : (
                    <Typography.Text className="ct-mono">{a.appIdentifier ?? '—'}</Typography.Text>
                  ),
              },
              {
                title: 'Allowed',
                width: 110,
                render: (_, a) => (
                  <span className="tabular">
                    {a.permissions.filter((p) => p.allowed).length} of {a.permissions.length}
                  </span>
                ),
              },
              { title: 'API keys', dataIndex: 'credentialsCount', width: 90, align: 'right', render: (v: number) => <span className="tabular">{v}</span> },
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
              { key: 'open', width: 48, align: 'right', render: () => <RightOutlined style={{ color: 'var(--ct-text-tertiary)' }} /> },
            ]}
          />
          </TableFrame>
        )}
      </DataState>
      <AppDrawer app={selected} loading={q.isPending} open={!!id} onClose={() => navigate('/apps')} />
      {creating && canBuild && <CreateAppModal onClose={() => setCreating(false)} />}
    </>
  );
}

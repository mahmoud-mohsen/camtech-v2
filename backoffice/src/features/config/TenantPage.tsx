import { EditOutlined, ExportOutlined, PlusOutlined, RightOutlined } from '@ant-design/icons';
import { Button, Card, Checkbox, DatePicker, Divider, Drawer, Empty, Flex, Form, Input, InputNumber, Modal, Popconfirm, Progress, Segmented, Switch, Table, Tabs, Tag, Tooltip, Typography } from 'antd';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { tenantApi } from '../../api/configuration';
import type { Entitlement, FeatureType, TenantSummary } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { ReadOnlyHint } from '../../components/Misc';
import { PageHeader } from '../../components/PageHeader';
import { CodeLabel } from '../../components/Tags';
import { dayjs } from '../../lib/format';
import { useApiMutation, useTenantEntitlements, useTenants } from '../../lib/hooks';
import { FEATURE_HELP, featureLabel } from '../../lib/labels';
import { PASSWORD_RULE_TEXT } from '../../lib/password';
import { LivenessPolicies } from './LivenessPolicies';
import { TenantSettings } from './SettingsPage';
import { PasswordField, PortalCredentialsModal, TenantUsersPanel, type PortalCredentials } from './TenantUsers';
import { optionalPasswordRule, PORTAL_URL, USERNAME_PATTERN, USERNAME_RULE_TEXT, useTenantUserErrorHandler } from './tenantUsersLogic';

const GROUPS: { type: FeatureType; title: string; help: string }[] = [
  { type: 'FLOW', title: 'Flows', help: 'Which verification journeys this tenant may run.' },
  { type: 'DOCUMENT', title: 'Documents', help: 'Which document types are accepted.' },
  { type: 'FEATURE', title: 'Features', help: 'Optional capabilities.' },
];

/** A plan change also changes what flows count as enabled and what apps can do. */
const ENTITLEMENT_QUERIES = [['entitlements'], ['flows'], ['capabilities']];

function QuotaText({ e }: { e: Entitlement }) {
  if (e.quotaPerDay === null) return <Tag variant="filled" className="ct-pill" color="blue">Unlimited</Tag>;
  return <span className="tabular">{e.quotaPerDay.toLocaleString()} / day</span>;
}

function UsedToday({ e }: { e: Entitlement }) {
  if (e.quotaPerDay === null || e.quotaPerDay === 0) return <span className="tabular">{e.usedToday}</span>;
  const pct = Math.min(100, Math.round((e.usedToday / e.quotaPerDay) * 100));
  return (
    <Tooltip title={`${e.usedToday} of ${e.quotaPerDay} used today`}>
      <Flex align="center" gap={8} style={{ minWidth: 140 }}>
        <span className="tabular">{e.usedToday}</span>
        <Progress percent={pct} size="small" showInfo={false} status={pct >= 100 ? 'exception' : pct >= 80 ? 'active' : 'normal'} style={{ flex: 1, margin: 0 }} />
      </Flex>
    </Tooltip>
  );
}

interface EditValues {
  enabled: boolean;
  unlimited: boolean;
  quotaPerDay: number | null;
  validUntil: dayjs.Dayjs | null;
}

function EditEntitlement({ tenantId, e, onClose }: { tenantId: number; e: Entitlement; onClose: () => void }) {
  const [form] = Form.useForm<EditValues>();
  const unlimited = Form.useWatch('unlimited', form);
  const save = useApiMutation(
    (v: EditValues) =>
      tenantApi.updateTenantEntitlement(tenantId, e.id, {
        enabled: v.enabled,
        quotaPerDay: v.unlimited ? null : (v.quotaPerDay ?? 0),
        validUntil: v.validUntil ? v.validUntil.format('YYYY-MM-DD') : null,
      }),
    { success: 'Entitlement saved', invalidate: ENTITLEMENT_QUERIES, onSuccess: onClose },
  );
  return (
    <Modal open title={`Edit: ${featureLabel(e.featureCode)}`} okText="Save" onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} destroyOnHidden>
      <Form
        form={form}
        layout="vertical"
        initialValues={{ enabled: e.enabled, unlimited: e.quotaPerDay === null, quotaPerDay: e.quotaPerDay ?? 1000, validUntil: e.validUntil ? dayjs(e.validUntil) : null }}
        onFinish={(v) => save.mutate(v)}
      >
        <Form.Item name="enabled" label="Enabled" valuePropName="checked">
          <Switch />
        </Form.Item>
        <Form.Item label="Daily quota" extra="How many times per day this can be used. Unlimited means no cap.">
          <Flex gap={12} align="center">
            <Form.Item name="unlimited" valuePropName="checked" noStyle>
              <Checkbox>Unlimited</Checkbox>
            </Form.Item>
            <Form.Item name="quotaPerDay" noStyle rules={[{ required: !unlimited, message: 'Enter a quota' }]}>
              <InputNumber min={0} step={100} precision={0} disabled={unlimited} style={{ width: 160 }} suffix="/ day" />
            </Form.Item>
          </Flex>
        </Form.Item>
        <Form.Item name="validUntil" label="Valid until" extra="Leave empty for no end date.">
          <DatePicker allowClear />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function EntitlementTable({ tenantId, items }: { tenantId: number; items: Entitlement[] }) {
  const { isAdmin } = usePermissions();
  const [editing, setEditing] = useState<Entitlement | null>(null);
  const toggle = useApiMutation((e: Entitlement) => tenantApi.updateTenantEntitlement(tenantId, e.id, { enabled: !e.enabled, quotaPerDay: e.quotaPerDay, validUntil: e.validUntil }), {
    success: (r) => `${featureLabel(r.featureCode)} ${r.enabled ? 'enabled' : 'disabled'}`,
    invalidate: ENTITLEMENT_QUERIES,
  });
  return (
    <>
      <Table<Entitlement>
        size="small"
        rowKey="id"
        pagination={false}
        dataSource={items}
        scroll={{ x: 700 }}
        columns={[
          {
            title: 'Name',
            render: (_, e) => (
              <div>
                <CodeLabel label={featureLabel(e.featureCode)} code={e.featureCode} />
                {FEATURE_HELP[e.featureCode] && (
                  <div>
                    <span className="ct-meta">{FEATURE_HELP[e.featureCode]}</span>
                  </div>
                )}
              </div>
            ),
          },
          {
            title: 'Enabled',
            width: 90,
            render: (_, e) => (
              <Tooltip title={isAdmin ? undefined : 'Only administrators can change this'}>
                <Switch checked={e.enabled} disabled={!isAdmin} loading={toggle.isPending && toggle.variables?.id === e.id} onChange={() => toggle.mutate(e)} />
              </Tooltip>
            ),
          },
          { title: 'Quota', width: 140, render: (_, e) => <QuotaText e={e} /> },
          { title: 'Used today', width: 180, render: (_, e) => <UsedToday e={e} /> },
          {
            title: 'Valid until',
            dataIndex: 'validUntil',
            width: 140,
            render: (v: string | null) => (v ? <DateText value={v} dateOnly /> : <Typography.Text type="secondary">No end date</Typography.Text>),
          },
          {
            title: '',
            width: 80,
            align: 'right',
            render: (_, e) => (
              <Button size="small" icon={<EditOutlined />} disabled={!isAdmin} onClick={() => setEditing(e)}>
                Edit
              </Button>
            ),
          },
        ]}
      />
      {editing && <EditEntitlement tenantId={tenantId} e={editing} onClose={() => setEditing(null)} />}
    </>
  );
}

interface NewTenantValues {
  code: string;
  name: string;
  owner: { username: string; displayName?: string; email?: string; password?: string };
}

function NewTenant({ onClose, onOwner }: { onClose: () => void; onOwner: (c: PortalCredentials) => void }) {
  const [form] = Form.useForm<NewTenantValues>();
  const onApiError = useTenantUserErrorHandler();
  const create = useApiMutation(
    (v: NewTenantValues) =>
      tenantApi.create({
        code: v.code.trim().toUpperCase(),
        name: v.name.trim(),
        owner: {
          username: v.owner.username.trim(),
          displayName: v.owner.displayName?.trim() || null,
          email: v.owner.email?.trim() || null,
          password: v.owner.password || null,
        },
      }),
    {
      success: (t) => `Tenant ${t.code} created`,
      invalidate: [['tenants']],
      onSuccess: (t) => {
        onClose();
        if (t.owner) onOwner({ tenantName: t.name, username: t.owner.user.username, password: t.owner.password });
      },
      onError: (err) => onApiError(err, form, ['owner']),
    },
  );
  return (
    <Modal open title="New tenant" okText="Create" width={600} onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: create.isPending }} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        The tenant starts with the same plan, settings, liveness limits and retention as the default tenant, plus a mobile and a web client app. Its team then
        integrates from the tenant portal.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => create.mutate(v)}>
        <Form.Item
          name="code"
          label="Code"
          extra="2-30 capital letters, digits or underscores. Cannot be changed later."
          normalize={(v: string) => v?.toUpperCase()}
          rules={[{ required: true, pattern: /^[A-Z0-9_]{2,30}$/, message: 'Use 2-30 capital letters, digits or underscores' }]}
        >
          <Input placeholder="ACME" autoFocus />
        </Form.Item>
        <Form.Item name="name" label="Name" rules={[{ required: true, whitespace: true, max: 200 }]}>
          <Input placeholder="Acme Payments LLC" />
        </Form.Item>
        <Divider titlePlacement="start" plain style={{ margin: '8px 0 4px' }}>
          Owner account
        </Divider>
        <Typography.Paragraph type="secondary">
          The tenant's first portal user, with full access including managing its other users. You share the sign-in details with the tenant; they
          must change the password at first sign-in.
        </Typography.Paragraph>
        <Form.Item
          name={['owner', 'username']}
          label="Username"
          extra="Used to sign in to the portal. Unique across all tenants."
          rules={[{ required: true, pattern: USERNAME_PATTERN, message: USERNAME_RULE_TEXT }]}
        >
          <Input autoComplete="off" placeholder="acme.owner" />
        </Form.Item>
        <Flex gap={12} wrap>
          <Form.Item name={['owner', 'displayName']} label="Name" rules={[{ max: 200 }]} style={{ flex: '1 1 220px' }}>
            <Input />
          </Form.Item>
          <Form.Item name={['owner', 'email']} label="Email" rules={[{ type: 'email', message: 'Enter a valid email' }]} style={{ flex: '1 1 220px' }}>
            <Input />
          </Form.Item>
        </Flex>
        <Form.Item
          name={['owner', 'password']}
          label="Password"
          extra={`${PASSWORD_RULE_TEXT} Leave empty to have one generated.`}
          rules={[optionalPasswordRule]}
        >
          <PasswordField />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function StatusTag({ status }: { status: TenantSummary['status'] }) {
  return (
    <Tag variant="filled" className="ct-pill" color={status === 'ACTIVE' ? 'success' : 'error'}>
      {status === 'ACTIVE' ? 'Active' : 'Suspended'}
    </Tag>
  );
}

function PlanTab({ tenantId }: { tenantId: number }) {
  const ents = useTenantEntitlements(tenantId);
  return (
    <>
      <Typography.Paragraph type="secondary">
        What this tenant may use: flows, document types and features, each with an optional daily quota and end date. The tenant sees its plan
        in the portal and can narrow it per client app.
      </Typography.Paragraph>
      <DataState query={ents}>
        {(list) => (
          <Flex vertical gap={16}>
            {GROUPS.map((g) => (
              <Card key={g.type} size="small" title={g.title} extra={<Typography.Text type="secondary">{g.help}</Typography.Text>}>
                <EntitlementTable tenantId={tenantId} items={list.filter((e) => e.featureType === g.type)} />
              </Card>
            ))}
          </Flex>
        )}
      </DataState>
    </>
  );
}

const TABS = ['plan', 'liveness', 'settings', 'users'] as const;
type TabKey = (typeof TABS)[number];

/** Everything CamTech manages for one tenant. */
function TenantDrawer({ tenant, tab, onTab, onClose }: { tenant: TenantSummary | undefined; tab: TabKey; onTab: (t: TabKey) => void; onClose: () => void }) {
  return (
    <Drawer
      open={tenant !== undefined}
      size="min(1100px, 100vw)"
      onClose={onClose}
      destroyOnHidden
      title={
        tenant && (
          <Flex gap={8} align="center" wrap>
            <span>{tenant.name}</span>
            <Typography.Text code style={{ fontWeight: 400 }}>{tenant.code}</Typography.Text>
            <StatusTag status={tenant.status} />
            {tenant.isDefault && <Tag variant="filled" className="ct-pill">Default</Tag>}
          </Flex>
        )
      }
      extra={
        <Button size="small" icon={<ExportOutlined />} href={PORTAL_URL} target="_blank" rel="noreferrer">
          Portal
        </Button>
      }
    >
      {tenant && (
        <Tabs
          activeKey={tab}
          onChange={(k) => onTab(k as TabKey)}
          items={[
            { key: 'plan', label: 'Plan', children: <PlanTab tenantId={tenant.id} /> },
            {
              key: 'liveness',
              label: 'Liveness limits',
              children: (
                <>
                  <Typography.Paragraph type="secondary">
                    The limits this tenant chooses its selfie liveness settings within (mode, challenges and how many each user does). The tenant
                    sets its own settings in the portal.
                  </Typography.Paragraph>
                  <LivenessPolicies tenantId={tenant.id} />
                </>
              ),
            },
            { key: 'settings', label: 'Settings', children: <TenantSettings tenantId={tenant.id} /> },
            { key: 'users', label: 'Portal users', children: <TenantUsersPanel tenant={tenant} /> },
          ]}
        />
      )}
    </Drawer>
  );
}

type StatusFilter = 'ALL' | TenantSummary['status'];

export default function TenantPage() {
  const { isAdmin } = usePermissions();
  const list = useTenants();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');
  const [creating, setCreating] = useState(false);
  const [ownerCreds, setOwnerCreds] = useState<PortalCredentials | null>(null);
  const setStatusOf = useApiMutation((t: TenantSummary) => tenantApi.update(t.id, { status: t.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE' }), {
    success: (t) => `${t.code} is now ${t.status === 'ACTIVE' ? 'active' : 'suspended'}`,
    invalidate: [['tenants']],
  });

  const openId = Number(params.get('tenant')) || null;
  const tab: TabKey = TABS.find((t) => t === params.get('tab')) ?? 'plan';
  const open = (id: number | null, nextTab: TabKey = 'plan') =>
    setParams(
      (p) => {
        if (id === null) {
          p.delete('tenant');
          p.delete('tab');
        } else {
          p.set('tenant', String(id));
          p.set('tab', nextTab);
        }
        return p;
      },
      { replace: id !== null && id === openId },
    );

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (list.data ?? []).filter(
      (t) => (status === 'ALL' || t.status === status) && (!s || t.code.toLowerCase().includes(s) || t.name.toLowerCase().includes(s)),
    );
  }, [list.data, search, status]);
  const counts = useMemo(() => {
    const all = list.data ?? [];
    return { ALL: all.length, ACTIVE: all.filter((t) => t.status === 'ACTIVE').length, SUSPENDED: all.filter((t) => t.status === 'SUSPENDED').length };
  }, [list.data]);

  return (
    <>
      <PageHeader
        title="Tenants"
        help="The companies using CamTech. Open a tenant to manage its plan, liveness limits, settings and portal users."
        extra={
          <Button type="primary" icon={<PlusOutlined />} disabled={!isAdmin} onClick={() => setCreating(true)}>
            New tenant
          </Button>
        }
      />
      <ReadOnlyHint what="tenants" />
      <Card size="small">
        <Flex gap={12} wrap align="center" style={{ marginBottom: 12 }}>
          <Input.Search allowClear placeholder="Search by name or code" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 260 }} />
          <Segmented<StatusFilter>
            value={status}
            onChange={setStatus}
            options={[
              { value: 'ALL', label: `All (${counts.ALL})` },
              { value: 'ACTIVE', label: `Active (${counts.ACTIVE})` },
              { value: 'SUSPENDED', label: `Suspended (${counts.SUSPENDED})` },
            ]}
          />
        </Flex>
        <DataState query={list}>
          {() => (
            <Table<TenantSummary>
              size="middle"
              rowKey="id"
              pagination={false}
              dataSource={rows}
              scroll={{ x: 720 }}
              locale={{ emptyText: <Empty description="No tenants match" /> }}
              onRow={(t) => ({ onClick: () => open(t.id), style: { cursor: 'pointer' } })}
              columns={[
                {
                  title: 'Tenant',
                  render: (_, t) => (
                    <Flex gap={8} align="center" wrap>
                      <CodeLabel label={t.name} code={t.code} />
                      {t.isDefault && (
                        <Tooltip title="CamTech's own tenant; new tenants start as a copy of it">
                          <Tag variant="filled" className="ct-pill">Default</Tag>
                        </Tooltip>
                      )}
                    </Flex>
                  ),
                },
                { title: 'Status', width: 130, render: (_, t) => <StatusTag status={t.status} /> },
                { title: 'Since', dataIndex: 'createdAt', width: 140, render: (v: string) => <DateText value={v} dateOnly /> },
                {
                  title: '',
                  width: 220,
                  align: 'right',
                  render: (_, t) => (
                    // Buttons here must not also open the drawer.
                    <Flex gap={8} justify="end" onClick={(e) => e.stopPropagation()}>
                      {!t.isDefault && (
                        <Popconfirm
                          title={t.status === 'ACTIVE' ? `Suspend ${t.code}?` : `Reactivate ${t.code}?`}
                          description={t.status === 'ACTIVE' ? 'Its apps and portal stop working within a minute.' : undefined}
                          okText={t.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                          okButtonProps={{ danger: t.status === 'ACTIVE' }}
                          disabled={!isAdmin}
                          onConfirm={() => setStatusOf.mutateAsync(t)}
                        >
                          <Button size="small" type="text" danger={t.status === 'ACTIVE'} disabled={!isAdmin}>
                            {t.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}
                          </Button>
                        </Popconfirm>
                      )}
                      <Button size="small" onClick={() => open(t.id)}>
                        Manage <RightOutlined />
                      </Button>
                    </Flex>
                  ),
                },
              ]}
            />
          )}
        </DataState>
      </Card>
      <TenantDrawer tenant={openId === null ? undefined : list.data?.find((t) => t.id === openId)} tab={tab} onTab={(t) => open(openId, t)} onClose={() => open(null)} />
      {creating && (
        <NewTenant
          onClose={() => setCreating(false)}
          onOwner={setOwnerCreds}
        />
      )}
      <PortalCredentialsModal creds={ownerCreds} onClose={() => setOwnerCreds(null)} />
    </>
  );
}

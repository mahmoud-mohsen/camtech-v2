import { CopyOutlined, EditOutlined, KeyOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Descriptions, Drawer, Flex, Form, Input, Modal, Select, Space, Table, Tag, Tooltip, Typography } from 'antd';
import { useState } from 'react';
import { tenantUsersApi } from '../../api/configuration';
import type { TenantSummary, TenantUserRole, TenantUserView } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { SecretModal } from '../../components/SecretModal';
import { ActiveTag } from '../../components/Tags';
import { useApiMutation } from '../../lib/hooks';
import { generatePassword, PASSWORD_RULE_TEXT } from '../../lib/password';
import {
  optionalPasswordRule, PORTAL_URL, TENANT_ROLE_COLOR, TENANT_ROLE_HELP, TENANT_ROLE_LABELS, TENANT_ROLES, USERNAME_PATTERN, USERNAME_RULE_TEXT,
  useTenantUserErrorHandler,
} from './tenantUsersLogic';

/** Password input with "Generate password" and copy buttons (use inside a Form.Item). */
export function PasswordField({ value, onChange, id }: { value?: string; onChange?: (v: string) => void; id?: string }) {
  const { message } = App.useApp();
  const copy = async () => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      message.success('Password copied');
    } catch {
      message.error('Could not copy. Select the password and copy it by hand.');
    }
  };
  return (
    <Space.Compact style={{ width: '100%' }}>
      <Input
        id={id}
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder="Leave empty to generate one on save"
        autoComplete="new-password"
        spellCheck={false}
        style={{ fontFamily: 'monospace' }}
      />
      <Tooltip title="Copy">
        <Button icon={<CopyOutlined />} disabled={!value} onClick={copy} aria-label="Copy password" />
      </Tooltip>
      <Button icon={<ReloadOutlined />} onClick={() => onChange?.(generatePassword())}>
        Generate password
      </Button>
    </Space.Compact>
  );
}

export interface PortalCredentials {
  tenantName: string;
  username: string;
  password: string;
  /** True for a password reset (vs a new account). */
  reset?: boolean;
}

/** Shows a portal user's username and password once, with copy buttons and the portal sign-in URL. */
export function PortalCredentialsModal({ creds, onClose }: { creds: PortalCredentials | null; onClose: () => void }) {
  return (
    <SecretModal
      open={!!creds}
      title={creds?.reset ? 'New portal password' : 'Portal sign-in details'}
      what="password"
      value={creds?.password ?? null}
      onClose={onClose}
      extra={
        creds && (
          <>
            <Typography.Paragraph>
              Share these with <b>{creds.tenantName}</b> through a safe channel. They must choose a new password when they sign in.
            </Typography.Paragraph>
            <Descriptions
              size="small"
              column={1}
              style={{ marginBottom: 8 }}
              items={[
                { label: 'Portal', children: <Typography.Link href={PORTAL_URL} target="_blank" rel="noreferrer" copyable={{ text: PORTAL_URL }}>{PORTAL_URL}</Typography.Link> },
                { label: 'Username', children: <Typography.Text code copyable={{ text: creds.username, tooltips: ['Copy', 'Copied'] }}>{creds.username}</Typography.Text> },
              ]}
            />
            <Typography.Text type="secondary">Password</Typography.Text>
          </>
        )
      }
    />
  );
}

const roleOptions = TENANT_ROLES.map((r) => ({
  value: r,
  label: (
    <span title={TENANT_ROLE_HELP[r]}>
      <b>{TENANT_ROLE_LABELS[r]}</b> <Typography.Text type="secondary">— {TENANT_ROLE_HELP[r]}</Typography.Text>
    </span>
  ),
}));

interface UserValues {
  username: string;
  displayName?: string;
  email?: string;
  role: TenantUserRole;
  status?: TenantUserView['status'];
  password?: string;
}

function UserForm({
  tenant, user, onlyActiveOwner, onClose, onCreated,
}: {
  tenant: TenantSummary;
  user: TenantUserView | null;
  onlyActiveOwner: boolean;
  onClose: () => void;
  onCreated: (c: PortalCredentials) => void;
}) {
  const [form] = Form.useForm<UserValues>();
  const onApiError = useTenantUserErrorHandler();
  const save = useApiMutation(
    async (v: UserValues) => {
      const displayName = v.displayName?.trim() || null;
      const email = v.email?.trim() || null;
      if (user) {
        await tenantUsersApi.update(tenant.id, user.id, { displayName, email, role: v.role, status: v.status ?? user.status });
        return null;
      }
      const r = await tenantUsersApi.create(tenant.id, { username: v.username.trim(), displayName, email, role: v.role, password: v.password || null });
      return { tenantName: tenant.name, username: r.user.username, password: r.password };
    },
    {
      success: user ? 'Portal user saved' : 'Portal user created',
      invalidate: [['tenant-users', tenant.id]],
      onSuccess: (r) => {
        onClose();
        if (r) onCreated(r);
      },
      onError: (err) => onApiError(err, form),
    },
  );
  return (
    <Modal
      open
      title={user ? `Edit ${user.username}` : `New portal user for ${tenant.name}`}
      okText={user ? 'Save' : 'Create user'}
      width={600}
      onCancel={onClose}
      onOk={() => form.submit()}
      okButtonProps={{ loading: save.isPending }}
      destroyOnHidden
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={user ? { ...user, displayName: user.displayName ?? undefined, email: user.email ?? undefined } : { role: 'VIEWER' }}
        onFinish={(v) => save.mutate(v)}
      >
        {!user && (
          <Form.Item name="username" label="Username" extra="Used to sign in to the portal. Unique across all tenants; can't be changed later." rules={[{ required: true, pattern: USERNAME_PATTERN, message: USERNAME_RULE_TEXT }]}>
            <Input autoComplete="off" autoFocus />
          </Form.Item>
        )}
        <Form.Item name="displayName" label="Name" rules={[{ max: 200 }]}>
          <Input />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Enter a valid email' }]}>
          <Input />
        </Form.Item>
        <Form.Item
          name="role"
          label="Role"
          rules={[{ required: true }]}
          extra={onlyActiveOwner ? 'This is the only active owner: the tenant must keep at least one.' : undefined}
        >
          <Select options={roleOptions} labelRender={({ value }) => TENANT_ROLE_LABELS[value as TenantUserRole] ?? String(value)} />
        </Form.Item>
        {user && (
          <Form.Item name="status" label="Status" extra="A disabled user can no longer sign in to the portal.">
            <Select options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }]} />
          </Form.Item>
        )}
        {!user && (
          <Form.Item name="password" label="Password" extra={`${PASSWORD_RULE_TEXT} Leave empty to have one generated. The user must change it at first sign-in.`} rules={[optionalPasswordRule]}>
            <PasswordField />
          </Form.Item>
        )}
      </Form>
    </Modal>
  );
}

function ResetPassword({ tenant, user, onClose, onDone }: { tenant: TenantSummary; user: TenantUserView; onClose: () => void; onDone: (c: PortalCredentials) => void }) {
  const [form] = Form.useForm<{ password?: string }>();
  const onApiError = useTenantUserErrorHandler();
  const reset = useApiMutation((v: { password?: string }) => tenantUsersApi.resetPassword(tenant.id, user.id, v.password || null), {
    success: 'Password reset',
    invalidate: [['tenant-users', tenant.id]],
    onSuccess: (r) => {
      onClose();
      onDone({ tenantName: tenant.name, username: user.username, password: r.password, reset: true });
    },
    onError: (err) => onApiError(err, form),
  });
  return (
    <Modal open title={`Reset the password of ${user.username}?`} okText="Reset password" width={560} onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: reset.isPending }} destroyOnHidden>
      <Typography.Paragraph type="secondary">
        Their current password stops working right away. They must choose a new one at next sign-in.
      </Typography.Paragraph>
      <Form form={form} layout="vertical" onFinish={(v) => reset.mutate(v)}>
        <Form.Item name="password" label="New password" extra={`${PASSWORD_RULE_TEXT} Leave empty to have one generated.`} rules={[optionalPasswordRule]}>
          <PasswordField />
        </Form.Item>
      </Form>
    </Modal>
  );
}

export function TenantUsersPanel({ tenant }: { tenant: TenantSummary }) {
  const { isAdmin } = usePermissions();
  const q = useQuery({ queryKey: ['tenant-users', tenant.id], queryFn: () => tenantUsersApi.list(tenant.id) });
  const [editing, setEditing] = useState<TenantUserView | null | undefined>(undefined);
  const [resetting, setResetting] = useState<TenantUserView | null>(null);
  const [creds, setCreds] = useState<PortalCredentials | null>(null);
  const activeOwners = (q.data ?? []).filter((u) => u.role === 'OWNER' && u.status === 'ACTIVE');

  return (
    <>
      <Flex justify="space-between" align="center" gap={12} wrap style={{ marginBottom: 12 }}>
        <Typography.Text type="secondary">
          People who sign in to the tenant portal at{' '}
          <Typography.Link href={PORTAL_URL} target="_blank" rel="noreferrer">{PORTAL_URL}</Typography.Link>.
        </Typography.Text>
        {isAdmin && (
          <Button type="primary" size="small" icon={<PlusOutlined />} onClick={() => setEditing(null)}>
            Add user
          </Button>
        )}
      </Flex>
      {!q.isPending && !q.isError && activeOwners.length === 0 && (
        <Typography.Paragraph type="warning">This tenant has no active owner, so nobody can manage its portal users. Add one.</Typography.Paragraph>
      )}
      <DataState query={q}>
        {(users) => (
          <Table<TenantUserView>
            size="small"
            rowKey="id"
            pagination={false}
            dataSource={users}
            scroll={{ x: 920 }}
            locale={{ emptyText: 'No portal users yet' }}
            columns={[
              { title: 'Username', dataIndex: 'username', render: (v: string) => <Typography.Text code>{v}</Typography.Text> },
              { title: 'Name', dataIndex: 'displayName', render: (v: string | null) => v || '—' },
              { title: 'Email', dataIndex: 'email', render: (v: string | null) => v || '—' },
              {
                title: 'Role',
                dataIndex: 'role',
                width: 110,
                render: (r: TenantUserRole) => <Tag variant="filled" className="ct-pill" color={TENANT_ROLE_COLOR[r]} title={TENANT_ROLE_HELP[r]}>{TENANT_ROLE_LABELS[r] ?? r}</Tag>,
              },
              { title: 'Status', dataIndex: 'status', width: 100, render: (v: string) => <ActiveTag value={v} /> },
              {
                title: 'Must change password',
                dataIndex: 'mustChangePassword',
                width: 110,
                render: (v: boolean) => (v ? <Tag variant="filled" className="ct-pill" color="warning">Yes</Tag> : 'No'),
              },
              { title: 'Last sign-in', dataIndex: 'lastLoginAt', width: 130, render: (v: string | null) => (v ? <DateText value={v} relative /> : 'Never') },
              ...(isAdmin
                ? [
                    {
                      title: '',
                      width: 210,
                      align: 'right' as const,
                      render: (_: unknown, u: TenantUserView) => (
                        <Flex gap={6} justify="flex-end">
                          <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(u)}>
                            Edit
                          </Button>
                          <Button size="small" icon={<KeyOutlined />} onClick={() => setResetting(u)}>
                            Reset password
                          </Button>
                        </Flex>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        )}
      </DataState>
      {editing !== undefined && (
        <UserForm
          tenant={tenant}
          user={editing}
          onlyActiveOwner={!!editing && activeOwners.length === 1 && activeOwners[0].id === editing.id}
          onClose={() => setEditing(undefined)}
          onCreated={setCreds}
        />
      )}
      {resetting && <ResetPassword tenant={tenant} user={resetting} onClose={() => setResetting(null)} onDone={setCreds} />}
      <PortalCredentialsModal creds={creds} onClose={() => setCreds(null)} />
    </>
  );
}

/** Drawer listing a tenant's portal users, with add / edit / reset password for administrators. */
export function TenantUsersDrawer({ tenant, onClose }: { tenant: TenantSummary | null; onClose: () => void }) {
  return (
    <Drawer open={tenant !== null} title={tenant ? `Portal users: ${tenant.name} (${tenant.code})` : undefined} size="min(1100px, 100vw)" onClose={onClose} destroyOnHidden>
      {tenant && <TenantUsersPanel tenant={tenant} />}
    </Drawer>
  );
}

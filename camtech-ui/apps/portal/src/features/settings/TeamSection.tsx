import { EditOutlined, KeyOutlined, LockOutlined, PlusOutlined, StopOutlined, ThunderboltOutlined, UnlockOutlined } from '@ant-design/icons';
import { CamtechApiError, type TenantUser, type TenantUserCreate, type TenantUserRole, type TenantUserStatus } from '@camtech/api-client';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Drawer, Flex, Form, Input, Modal, Radio, Space, Table, Tag, theme, Tooltip, Typography, type FormInstance } from 'antd';
import { useState } from 'react';
import { api } from '../../api/client';
import { ROLES } from '../../auth/permissions';
import { describeError, useAuth } from '../../auth/useAuth';
import { RefreshStatus } from '../../components/FilterBar';
import { RowActions } from '../../components/RowActions';
import { CopyButton } from '../../components/CopyButton';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PersonAvatar, SectionTitle, TableFrame } from '../../components/ui';
import { t } from '../../i18n';
import { useApiMutation } from '../../lib/hooks';
import { generatePassword, hasLettersAndDigits, PASSWORD_MIN_LENGTH } from '../../lib/password';

const usersKey = ['users'] as const;

const ROLE_COLOR: Record<TenantUserRole, string> = { OWNER: 'purple', DEVELOPER: 'geekblue', REVIEWER: 'gold', VIEWER: 'default' };

function RoleTag({ role }: { role: TenantUserRole }) {
  return (
    <Tag color={ROLE_COLOR[role]} variant="filled" className="ct-pill">
      {t(`role.${role}`)}
    </Tag>
  );
}

function StatusTag({ status }: { status: TenantUserStatus }) {
  return (
    <Tag color={status === 'ACTIVE' ? 'success' : 'default'} variant="filled" className="ct-pill">
      {t(`users.status.${status}`)}
    </Tag>
  );
}

/** Puts an API error on the form field it is about (username taken, weak password), else returns false. */
function fieldError(form: FormInstance, err: unknown): boolean {
  if (!(err instanceof CamtechApiError)) return false;
  const field = err.code === 'USERNAME_TAKEN' ? 'username' : err.code === 'WEAK_PASSWORD' ? 'password' : null;
  if (!field) return false;
  form.setFields([{ name: field, errors: [describeError(err)] }]);
  return true;
}

/** Optional password: blank = the server generates one; otherwise the same rules as the server. */
const passwordRules = [
  { min: PASSWORD_MIN_LENGTH, message: t('password.tooShort') },
  {
    validator: (_: unknown, value: string | undefined) =>
      !value || hasLettersAndDigits(value) ? Promise.resolve() : Promise.reject(new Error(t('password.lettersDigits'))),
  },
];

/** Password input with "Generate password" and copy buttons. */
function PasswordField({ form }: { form: FormInstance }) {
  const value = Form.useWatch('password', form) as string | undefined;
  return (
    <Form.Item label={t('users.form.password')} extra={t('users.form.passwordExtra')} style={{ marginBottom: 16 }}>
      <Space.Compact style={{ width: '100%' }}>
        <Form.Item name="password" noStyle rules={passwordRules}>
          <Input.Password autoComplete="new-password" style={{ fontFamily: 'monospace' }} maxLength={200} />
        </Form.Item>
        <Tooltip title={t('password.generate')}>
          <Button
            icon={<ThunderboltOutlined />}
            aria-label={t('password.generate')}
            onClick={() => {
              form.setFieldValue('password', generatePassword());
              void form.validateFields(['password']);
            }}
          >
            {t('password.generate')}
          </Button>
        </Tooltip>
        <CopyButton text={value ?? ''} type="default" size="middle" />
      </Space.Compact>
    </Form.Item>
  );
}

function RoleField({ disabled }: { disabled?: boolean }) {
  return (
    <Form.Item name="role" label={t('users.form.role')} rules={[{ required: true }]}>
      <Radio.Group style={{ display: 'grid', gap: 8 }} disabled={disabled}>
        {ROLES.map((r) => (
          <Radio key={r} value={r}>
            <span>
              <strong>{t(`role.${r}`)}</strong>
              <br />
              <span className="ct-meta">{t(`role.${r}.help`)}</span>
            </span>
          </Radio>
        ))}
      </Radio.Group>
    </Form.Item>
  );
}

/** Shows a new password exactly once. */
function PasswordOnceModal({ username, password, onClose }: { username: string; password: string; onClose: () => void }) {
  const { token } = theme.useToken();
  return (
    <Modal
      open
      title={
        <Flex align="center" gap={8}>
          <LockOutlined /> {t('users.password.title', { username })}
        </Flex>
      }
      closable={false}
      mask={{ closable: false }}
      keyboard={false}
      destroyOnHidden
      footer={
        <Button type="primary" onClick={onClose}>
          {t('users.password.done')}
        </Button>
      }
    >
      <Alert type="warning" showIcon style={{ marginBottom: 16 }} title={t('users.password.warning')} description={t('users.password.mustChange')} />
      <Flex
        align="center"
        gap={8}
        style={{
          padding: '8px 8px 8px 12px',
          borderRadius: token.borderRadius,
          border: `1px solid ${token.colorWarningBorder}`,
          background: token.colorWarningBg,
        }}
      >
        <Typography.Text style={{ fontFamily: token.fontFamilyCode, fontSize: 16, wordBreak: 'break-all', flex: 1 }} data-testid="one-time-password">
          {password}
        </Typography.Text>
        <CopyButton text={password} showLabel type="default" />
      </Flex>
    </Modal>
  );
}

interface CreateValues {
  username: string;
  displayName?: string;
  email?: string;
  role: TenantUserRole;
  password?: string;
}

function AddUserDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (username: string, password: string) => void }) {
  const [form] = Form.useForm<CreateValues>();
  const create = useApiMutation(
    (v: CreateValues) => {
      const body: TenantUserCreate = {
        username: v.username.trim(),
        displayName: v.displayName?.trim() || null,
        email: v.email?.trim() || null,
        role: v.role,
        password: v.password || null,
      };
      return api.createUser(body);
    },
    {
      invalidate: [usersKey],
      onSuccess: (r) => {
        onClose();
        onCreated(r.user.username, r.password);
      },
      onError: (err) => fieldError(form, err),
    },
  );
  return (
    <Drawer
      open
      title={t('users.add')}
      size={480}
      onClose={onClose}
      destroyOnHidden
      footer={
        <Flex justify="flex-end" gap={8}>
          <Button onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="primary" loading={create.isPending} onClick={() => form.submit()}>
            {t('users.form.create')}
          </Button>
        </Flex>
      }
    >
      <Form<CreateValues> form={form} layout="vertical" requiredMark={false} initialValues={{ role: 'VIEWER', password: '' }} onFinish={(v) => create.mutate(v)}>
        <Form.Item
          name="username"
          label={t('users.form.username')}
          rules={[
            { required: true, whitespace: true, message: t('users.form.usernameRequired') },
            { pattern: /^\s*[A-Za-z0-9._-]{3,64}\s*$/, message: t('users.form.usernamePattern') },
          ]}
        >
          <Input autoComplete="off" spellCheck={false} autoCapitalize="none" maxLength={64} autoFocus />
        </Form.Item>
        <Form.Item name="displayName" label={t('users.form.displayName')}>
          <Input maxLength={120} />
        </Form.Item>
        <Form.Item name="email" label={t('users.form.email')} rules={[{ type: 'email', message: t('users.form.emailInvalid') }]}>
          <Input type="email" maxLength={200} />
        </Form.Item>
        <RoleField />
        <PasswordField form={form} />
      </Form>
    </Drawer>
  );
}

interface EditValues {
  displayName?: string;
  email?: string;
  role: TenantUserRole;
  status: TenantUserStatus;
}

function EditUserModal({ user, isSelf, onClose }: { user: TenantUser; isSelf: boolean; onClose: () => void }) {
  const [form] = Form.useForm<EditValues>();
  const save = useApiMutation(
    (v: EditValues) => api.updateUser(user.id, { displayName: v.displayName?.trim() || null, email: v.email?.trim() || null, role: v.role, status: v.status }),
    { success: (u) => t('users.saved', { username: u.username }), invalidate: [usersKey], onSuccess: onClose },
  );
  return (
    <Modal
      open
      title={t('users.edit.title', { username: user.username })}
      okText={t('common.save')}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() => form.submit()}
      okButtonProps={{ loading: save.isPending }}
      destroyOnHidden
      width={560}
    >
      <Form<EditValues>
        form={form}
        layout="vertical"
        requiredMark={false}
        initialValues={{ displayName: user.displayName ?? '', email: user.email ?? '', role: user.role, status: user.status }}
        onFinish={(v) => save.mutate(v)}
      >
        <Form.Item name="displayName" label={t('users.form.displayName')}>
          <Input maxLength={120} />
        </Form.Item>
        <Form.Item name="email" label={t('users.form.email')} rules={[{ type: 'email', message: t('users.form.emailInvalid') }]}>
          <Input type="email" maxLength={200} />
        </Form.Item>
        {isSelf && <Alert type="info" showIcon style={{ marginBottom: 16 }} title={t('auth.error.SELF_LOCKOUT')} />}
        <RoleField disabled={isSelf} />
        <Form.Item name="status" label={t('users.form.status')}>
          <Radio.Group
            optionType="button"
            disabled={isSelf}
            options={(['ACTIVE', 'DISABLED'] as const).map((s) => ({ value: s, label: t(`users.status.${s}`) }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onDone }: { user: TenantUser; onClose: () => void; onDone: (password: string) => void }) {
  const [form] = Form.useForm<{ password?: string }>();
  const reset = useApiMutation((v: { password?: string }) => api.resetUserPassword(user.id, v.password || null), {
    invalidate: [usersKey],
    onSuccess: (r) => {
      onClose();
      onDone(r.password);
    },
    onError: (err) => fieldError(form, err),
  });
  return (
    <Modal
      open
      title={t('users.reset.title', { username: user.username })}
      okText={t('users.reset.submit')}
      cancelText={t('common.cancel')}
      onCancel={onClose}
      onOk={() => form.submit()}
      okButtonProps={{ loading: reset.isPending, danger: true }}
      destroyOnHidden
      width={560}
    >
      <Typography.Paragraph type="secondary">{t('users.reset.intro')}</Typography.Paragraph>
      <Form form={form} layout="vertical" requiredMark={false} initialValues={{ password: '' }} onFinish={(v) => reset.mutate(v)}>
        <PasswordField form={form} />
      </Form>
    </Modal>
  );
}

/** Settings › Team: who can sign in to this console and their roles (owners only). */
export function TeamSection() {
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: usersKey, queryFn: api.users });
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TenantUser | null>(null);
  const [resetting, setResetting] = useState<TenantUser | null>(null);
  const [shown, setShown] = useState<{ username: string; password: string } | null>(null);

  const setStatus = useApiMutation((v: { user: TenantUser; status: TenantUserStatus }) => api.updateUser(v.user.id, { status: v.status }), {
    success: (u) => t(u.status === 'ACTIVE' ? 'users.enabled' : 'users.disabled', { username: u.username }),
    invalidate: [usersKey],
  });

  return (
    <>
      <SectionTitle
        title={t('users.title')}
        sub={t('users.subtitle')}
        extra={
          <Flex gap={8} wrap>
            <RefreshStatus query={users} />
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAdding(true)}>
              {t('users.add')}
            </Button>
          </Flex>
        }
      />
      <TableFrame>
        <DataState query={users} isEmpty={(d) => d.length === 0} empty={<Typography.Paragraph style={{ padding: 24 }}>{t('users.empty')}</Typography.Paragraph>}>
          {(data) => (
            <Table<TenantUser>
              rowKey="id"
              dataSource={data}
              pagination={false}
              scroll={{ x: 900 }}
              columns={[
                {
                  title: t('users.col.username'),
                  dataIndex: 'username',
                  render: (_, u) => (
                    <Flex gap={12} align="center">
                      <PersonAvatar name={u.displayName || u.username} />
                      <Flex vertical style={{ minWidth: 0 }}>
                        <Flex gap={6} align="center" wrap>
                          <span className="ct-strong">{u.username}</span>
                          {u.id === me?.id && (
                            <Tag color="blue" variant="filled" className="ct-pill">
                              {t('users.you')}
                            </Tag>
                          )}
                          {u.mustChangePassword && (
                            <Tag color="warning" variant="filled" className="ct-pill">
                              {t('users.mustChange')}
                            </Tag>
                          )}
                        </Flex>
                        {u.displayName && <span className="ct-meta">{u.displayName}</span>}
                      </Flex>
                    </Flex>
                  ),
                },
                { title: t('users.col.email'), dataIndex: 'email', render: (v: string | null) => v || <span className="ct-meta">—</span> },
                { title: t('users.col.role'), dataIndex: 'role', width: 120, render: (r: TenantUserRole) => <RoleTag role={r} /> },
                { title: t('users.col.status'), dataIndex: 'status', width: 110, render: (s: TenantUserStatus) => <StatusTag status={s} /> },
                {
                  title: t('users.col.lastLogin'),
                  dataIndex: 'lastLoginAt',
                  width: 140,
                  render: (v: string | null) => <span className="ct-meta">{v ? <DateText value={v} relative /> : t('common.never')}</span>,
                },
                {
                  key: 'actions',
                  width: 130,
                  align: 'end',
                  render: (_, u) => {
                    const self = u.id === me?.id;
                    return (
                      <RowActions
                        label={`${t('users.actions')}: ${u.username}`}
                        primary={
                          <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(u)}>
                            {t('common.edit')}
                          </Button>
                        }
                        items={[
                          { key: 'reset', label: t('users.resetPassword'), icon: <KeyOutlined />, onClick: () => setResetting(u) },
                          u.status === 'ACTIVE'
                            ? {
                                key: 'disable',
                                label: t('users.disable'),
                                icon: <StopOutlined />,
                                danger: true,
                                disabled: self,
                                hint: self ? t('auth.error.SELF_LOCKOUT') : undefined,
                                onClick: () => setStatus.mutateAsync({ user: u, status: 'DISABLED' }),
                                confirm: { title: t('users.disable'), description: t('users.disable.confirm', { username: u.username }), okText: t('users.disable') },
                              }
                            : { key: 'enable', label: t('users.enable'), icon: <UnlockOutlined />, onClick: () => setStatus.mutate({ user: u, status: 'ACTIVE' }) },
                        ]}
                      />
                    );
                  },
                },
              ]}
            />
          )}
        </DataState>
      </TableFrame>

      {adding && <AddUserDrawer onClose={() => setAdding(false)} onCreated={(username, password) => setShown({ username, password })} />}
      {editing && <EditUserModal user={editing} isSelf={editing.id === me?.id} onClose={() => setEditing(null)} />}
      {resetting && (
        <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} onDone={(password) => setShown({ username: resetting.username, password })} />
      )}
      {shown && <PasswordOnceModal username={shown.username} password={shown.password} onClose={() => setShown(null)} />}
    </>
  );
}

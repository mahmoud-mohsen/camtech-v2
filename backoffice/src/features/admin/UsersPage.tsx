import { EditOutlined, KeyOutlined, PlusOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Button, Flex, Form, Input, Modal, Radio, Select, Table, Tag, Typography } from 'antd';
import { useState } from 'react';
import { usersApi } from '../../api/configuration';
import type { AdminUser, Role } from '../../api/types';
import { usePermissions } from '../../auth/useAuth';
import { ConfirmAction } from '../../components/ConfirmAction';
import { DataState } from '../../components/DataState';
import { DateText } from '../../components/DateText';
import { PageHeader } from '../../components/PageHeader';
import { SecretModal } from '../../components/SecretModal';
import { ActiveTag } from '../../components/Tags';
import { PersonCell } from '../../components/ui';
import { useApiMutation } from '../../lib/hooks';
import { ROLE_HELP, ROLE_LABELS } from '../../lib/labels';

const ROLES: Role[] = ['ADMIN', 'REVIEWER', 'VIEWER'];
const ROLE_COLOR: Record<Role, string> = { ADMIN: 'magenta', REVIEWER: 'blue', VIEWER: 'default' };

function RolePicker(props: { value?: Role; onChange?: (r: Role) => void; disabled?: boolean }) {
  return (
    <Radio.Group value={props.value} onChange={(e) => props.onChange?.(e.target.value)} disabled={props.disabled} style={{ display: 'grid', gap: 8 }}>
      {ROLES.map((r) => (
        <Radio key={r} value={r}>
          <b>{ROLE_LABELS[r]}</b> <Typography.Text type="secondary">— {ROLE_HELP[r]}</Typography.Text>
        </Radio>
      ))}
    </Radio.Group>
  );
}

interface FormValues {
  username: string;
  displayName: string;
  email?: string;
  role: Role;
  status?: AdminUser['status'];
}

function UserForm({ user, onClose, onPassword }: { user: AdminUser | null; onClose: () => void; onPassword: (p: { username: string; password: string }) => void }) {
  const [form] = Form.useForm<FormValues>();
  const { username: me } = usePermissions();
  const self = user?.username === me;
  const save = useApiMutation(
    async (v: FormValues) => {
      if (user) {
        await usersApi.update(user.id, { displayName: v.displayName.trim(), email: v.email?.trim() || null, role: v.role, status: v.status ?? user.status });
        return null;
      }
      const r = await usersApi.create({ username: v.username.trim().toLowerCase(), displayName: v.displayName.trim(), email: v.email?.trim() || null, role: v.role });
      return { username: r.user.username, password: r.temporaryPassword };
    },
    {
      success: user ? 'User saved' : 'User created',
      invalidate: [['users']],
      onSuccess: (r) => {
        onClose();
        if (r) onPassword(r);
      },
    },
  );
  return (
    <Modal open title={user ? `Edit ${user.username}` : 'New user'} okText={user ? 'Save' : 'Create user'} width={560} onCancel={onClose} onOk={() => form.submit()} okButtonProps={{ loading: save.isPending }} destroyOnHidden>
      <Form form={form} layout="vertical" initialValues={user ?? { role: 'VIEWER' }} onFinish={(v) => save.mutate(v)}>
        {!user && (
          <Form.Item name="username" label="Username" extra="Used to sign in. Can't be changed later." rules={[{ required: true, pattern: /^[a-zA-Z0-9._-]{3,40}$/, message: '3-40 letters, digits, dot, dash or underscore' }]}>
            <Input autoComplete="off" />
          </Form.Item>
        )}
        <Form.Item name="displayName" label="Full name" rules={[{ required: true, message: 'Enter a name' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="email" label="Email" rules={[{ type: 'email', message: 'Enter a valid email' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="role" label="Role" rules={[{ required: true }]} extra={self ? "You can't change your own role." : undefined}>
          <RolePicker disabled={self} />
        </Form.Item>
        {user && (
          <Form.Item name="status" label="Status" extra={self ? "You can't disable yourself." : 'A disabled user can no longer sign in.'}>
            <Select disabled={self} options={[{ value: 'ACTIVE', label: 'Active' }, { value: 'DISABLED', label: 'Disabled' }]} />
          </Form.Item>
        )}
        {!user && <Typography.Paragraph type="secondary">A temporary password is generated. The user must choose a new one at first sign-in.</Typography.Paragraph>}
      </Form>
    </Modal>
  );
}

export default function UsersPage() {
  const { username: me } = usePermissions();
  const q = useQuery({ queryKey: ['users'], queryFn: usersApi.list });
  const [editing, setEditing] = useState<AdminUser | null | undefined>(undefined);
  const [pwd, setPwd] = useState<{ username: string; password: string } | null>(null);
  const reset = useApiMutation((u: AdminUser) => usersApi.resetPassword(u.id), {
    success: 'Password reset',
    invalidate: [['users']],
    onSuccess: (r, u) => setPwd({ username: u.username, password: r.temporaryPassword }),
  });

  return (
    <>
      <PageHeader
        title="Users"
        help="People who can sign in to this back office, and what their role allows them to do."
        extra={<Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing(null)}>New user</Button>}
      />
      <DataState query={q} isEmpty={(d) => d.length === 0}>
        {(users) => (
          <div style={{ border: '1px solid var(--ct-border)', borderRadius: 14, overflow: 'hidden', background: 'var(--ct-card)', boxShadow: 'var(--ct-shadow-xs)' }}>
            <Table<AdminUser>
              rowKey="id"
              pagination={false}
              dataSource={users}
              scroll={{ x: 900 }}
              columns={[
                {
                  title: 'User',
                  render: (_, u) => (
                    <PersonCell
                      name={u.displayName}
                      sub={
                        <>
                          {u.username}
                          {u.email ? ` · ${u.email}` : ''}
                          {u.username === me && (
                            <Tag variant="filled" className="ct-pill" style={{ marginInlineStart: 8 }}>
                              You
                            </Tag>
                          )}
                        </>
                      }
                    />
                  ),
                },
                { title: 'Role', dataIndex: 'role', width: 130, render: (r: Role) => <Tag color={ROLE_COLOR[r]} title={ROLE_HELP[r]} variant="filled" className="ct-pill">{ROLE_LABELS[r]}</Tag> },
                {
                  title: 'Status',
                  width: 200,
                  render: (_, u) => (
                    <Flex gap={4} wrap>
                      <ActiveTag value={u.status} />
                      {u.mustChangePassword && <Tag color="warning" variant="filled" className="ct-pill">Must change password</Tag>}
                    </Flex>
                  ),
                },
                { title: 'Last sign-in', dataIndex: 'lastLoginAt', width: 140, render: (v: string | null) => <span className="ct-meta tabular">{v ? <DateText value={v} relative /> : 'Never'}</span> },
                { title: 'Created', dataIndex: 'createdAt', width: 120, render: (v: string) => <span className="ct-meta tabular"><DateText value={v} dateOnly /></span> },
                {
                  title: '',
                  width: 230,
                  align: 'right',
                  render: (_, u) => (
                    <Flex gap={6} justify="flex-end">
                      <Button size="small" icon={<EditOutlined />} onClick={() => setEditing(u)}>Edit</Button>
                      <ConfirmAction
                        label="Reset password"
                        buttonProps={{ size: 'small', icon: <KeyOutlined /> }}
                        title={`Reset the password of ${u.displayName}?`}
                        description="A new temporary password is generated and their current password stops working. They must choose a new one at next sign-in."
                        okText="Reset password"
                        onConfirm={() => reset.mutateAsync(u)}
                      />
                    </Flex>
                  ),
                },
              ]}
            />
          </div>
        )}
      </DataState>
      {editing !== undefined && <UserForm user={editing} onClose={() => setEditing(undefined)} onPassword={setPwd} />}
      <SecretModal
        open={!!pwd}
        title="Temporary password"
        what="temporary password"
        value={pwd?.password ?? null}
        extra={<Typography.Paragraph>Give it to <b>{pwd?.username}</b> through a safe channel. They will be asked to change it when they sign in.</Typography.Paragraph>}
        onClose={() => setPwd(null)}
      />
    </>
  );
}

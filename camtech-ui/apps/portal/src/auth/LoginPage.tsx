import { LockOutlined, LoginOutlined, UserOutlined } from '@ant-design/icons';
import { CamtechApiError } from '@camtech/api-client';
import { Alert, Button, Flex, Form, Input, Tag, theme, Typography } from 'antd';
import { useEffect, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { API_BASE_URL, USE_MOCKS } from '../env';
import { t } from '../i18n';
import { DEMO_PASSWORD, DEMO_USERS } from '../mocks/demoUsers';
import { AuthShell } from './AuthShell';
import { describeError, useAuth } from './useAuth';

interface Values {
  username: string;
  password: string;
}

/** Only same-app paths, never /login itself (avoids open redirects and loops). */
function safeFrom(v: unknown): string {
  return typeof v === 'string' && v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/login') ? v : '/';
}

export function LoginPage() {
  const { user, login, sessionExpired } = useAuth();
  const { token } = theme.useToken();
  const navigate = useNavigate();
  const location = useLocation();
  const [form] = Form.useForm<Values>();
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const from = safeFrom((location.state as { from?: unknown } | null)?.from);

  useEffect(() => {
    document.title = `${t('auth.login.title')} · ${t('app.name')}`;
  }, []);

  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : from} replace />;

  const onFinish = async (v: Values) => {
    setError(null);
    setLoading(true);
    try {
      const u = await login(v.username.trim(), v.password);
      navigate(u.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (e) {
      setError(e);
      form.setFieldValue('password', '');
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      {sessionExpired && error === null && <Alert type="info" showIcon title={t('auth.login.sessionEnded')} />}
      {error !== null && (
        <Alert
          type="error"
          showIcon
          title={describeError(error)}
          description={
            error instanceof CamtechApiError ? (
              <Typography.Text type="secondary" style={{ fontFamily: 'monospace', fontSize: 12 }}>
                {error.code}
              </Typography.Text>
            ) : undefined
          }
        />
      )}

      <Form form={form} layout="vertical" onFinish={(v) => void onFinish(v)} requiredMark={false} disabled={loading}>
        <Form.Item name="username" label={t('auth.login.username')} rules={[{ required: true, whitespace: true, message: t('auth.login.usernameRequired') }]}>
          <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" spellCheck={false} autoCapitalize="none" maxLength={64} />
        </Form.Item>
        <Form.Item name="password" label={t('auth.login.password')} rules={[{ required: true, message: t('auth.login.passwordRequired') }]}>
          <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" maxLength={200} />
        </Form.Item>
        <Button type="primary" size="large" htmlType="submit" block loading={loading} icon={<LoginOutlined />}>
          {t('auth.login.submit')}
        </Button>
      </Form>

      {USE_MOCKS && (
        <Alert
          type="warning"
          showIcon
          title={t('auth.login.mockTitle')}
          description={
            <Flex vertical gap={6}>
              <span>
                {t('auth.login.mockHint', { password: DEMO_PASSWORD })}
              </span>
              <Flex gap={6} wrap>
                {DEMO_USERS.map((u) => (
                  <Tag.CheckableTag
                    key={u.username}
                    checked={false}
                    onChange={() => form.setFieldsValue({ username: u.username, password: DEMO_PASSWORD })}
                    style={{ border: `1px solid ${token.colorBorder}` }}
                  >
                    <code>{u.username}</code> · {t(`role.${u.role}`)}
                    {u.mustChangePassword ? ` · ${t('auth.login.mockMustChange')}` : ''}
                    {u.tenantCode !== 'NOQODI' ? ` · ${t('auth.login.mockOtherTenant')}` : ''}
                  </Tag.CheckableTag>
                ))}
              </Flex>
            </Flex>
          }
        />
      )}

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        {t('auth.login.server')}: <Typography.Text code style={{ fontSize: 12 }}>{API_BASE_URL}</Typography.Text>
      </Typography.Text>
    </AuthShell>
  );
}

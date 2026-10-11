import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { Alert, Button, Card, Form, Input, Typography } from 'antd';
import { useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { errorMessage, USE_MOCKS } from '../api/client';
import { useAuth } from './useAuth';
import { AuthShell } from './AuthShell';

export function LoginPage() {
  const { user, login, sessionExpired } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const from = (location.state as { from?: string } | null)?.from ?? '/';

  if (user) return <Navigate to={user.mustChangePassword ? '/change-password' : from} replace />;

  const onFinish = async (v: { username: string; password: string }) => {
    setError(null);
    setLoading(true);
    try {
      const u = await login(v.username.trim(), v.password);
      navigate(u.mustChangePassword ? '/change-password' : from, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Sign in
        </Typography.Title>
        <Typography.Paragraph type="secondary">Use your back-office account.</Typography.Paragraph>
        {sessionExpired && !error && (
          <Alert type="info" showIcon style={{ marginBottom: 16 }} title="Your session ended. Please sign in again." />
        )}
        {error && <Alert type="error" showIcon style={{ marginBottom: 16 }} title={error} />}
        <Form layout="vertical" onFinish={onFinish} requiredMark={false} disabled={loading}>
          <Form.Item name="username" label="Username" rules={[{ required: true, message: 'Enter your username' }]}>
            <Input prefix={<UserOutlined />} autoComplete="username" autoFocus size="large" />
          </Form.Item>
          <Form.Item name="password" label="Password" rules={[{ required: true, message: 'Enter your password' }]}>
            <Input.Password prefix={<LockOutlined />} autoComplete="current-password" size="large" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block size="large" loading={loading}>
            Sign in
          </Button>
        </Form>
        {USE_MOCKS && (
          <Alert
            style={{ marginTop: 16 }}
            type="warning"
            showIcon
            title="Demo mode (mock data)"
            description={
              <span>
                Users: <code>admin</code> (administrator), <code>sara.review</code> (reviewer), <code>omar.view</code> (viewer),{' '}
                <code>layla.new</code> (must change password). Demo password for all: <code>Demo@1234</code>
              </span>
            }
          />
        )}
      </Card>
    </AuthShell>
  );
}

import { App, Button, Card, Typography } from 'antd';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from './useAuth';
import { AuthShell } from './AuthShell';
import { ChangePasswordForm } from './ChangePasswordForm';

/** Forced password change (mustChangePassword = true): nothing else is reachable until it is done. */
export function ChangePasswordPage() {
  const { user, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/" replace />;

  return (
    <AuthShell>
      <Card>
        <Typography.Title level={3} style={{ marginTop: 0 }}>
          Choose a new password
        </Typography.Title>
        <Typography.Paragraph type="secondary">
          Hi {user.displayName}, you signed in with a temporary password. Choose your own password to continue.
        </Typography.Paragraph>
        <ChangePasswordForm
          submitLabel="Save and continue"
          onDone={async () => {
            message.success('Password changed');
            await refreshUser();
            navigate('/', { replace: true });
          }}
        />
        <Button type="link" block style={{ marginTop: 8 }} onClick={() => logout()}>
          Sign out
        </Button>
      </Card>
    </AuthShell>
  );
}

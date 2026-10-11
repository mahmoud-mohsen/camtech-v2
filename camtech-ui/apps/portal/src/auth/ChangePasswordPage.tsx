import { App, Button, Typography } from 'antd';
import { useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { t } from '../i18n';
import { AuthShell } from './AuthShell';
import { ChangePasswordForm } from './ChangePasswordForm';
import { useAuth } from './useAuth';

/** Forced password change (mustChangePassword = true): nothing else is reachable until it is done. */
export function ChangePasswordPage() {
  const { user, initialising, refreshUser, logout } = useAuth();
  const navigate = useNavigate();
  const { message } = App.useApp();

  useEffect(() => {
    document.title = `${t('password.forced.title')} · ${t('app.name')}`;
  }, []);

  if (initialising) return null;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.mustChangePassword) return <Navigate to="/" replace />;

  return (
    <AuthShell title={t('password.forced.title')}>
      <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
        {t('password.forced.intro', { name: user.displayName || user.username })}
      </Typography.Paragraph>
      <ChangePasswordForm
        submitLabel={t('password.forced.submit')}
        onDone={async () => {
          message.success(t('password.changed'));
          await refreshUser();
          navigate('/', { replace: true });
        }}
      />
      <Button type="link" block onClick={() => void logout()}>
        {t('auth.logout')}
      </Button>
    </AuthShell>
  );
}

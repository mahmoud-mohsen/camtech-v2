import { LogoutOutlined, StopOutlined } from '@ant-design/icons';
import { Button, Flex, Result, Spin } from 'antd';
import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { t } from '../i18n';
import { AuthShell } from './AuthShell';
import { describeError, useAuth, usePermissions, useTenantInfoQuery } from './useAuth';

function FullPageSpin() {
  return (
    <Flex align="center" justify="center" style={{ minHeight: '100vh' }}>
      <Spin size="large" />
    </Flex>
  );
}

/** 403 TENANT_SUSPENDED: nothing works until CamTech restores the tenant. */
export function SuspendedScreen() {
  const { logout } = useAuth();
  return (
    <AuthShell title={t('auth.suspended.title')}>
      <Result
        status="warning"
        icon={<StopOutlined />}
        subTitle={t('auth.suspended.subtitle')}
        style={{ padding: 0 }}
        extra={
          <Button icon={<LogoutOutlined />} onClick={() => void logout()}>
            {t('auth.logout')}
          </Button>
        }
      />
    </AuthShell>
  );
}

/**
 * Gate for the signed-in area: sends anonymous users to /login, forces the password change when required,
 * shows the suspended screen, and renders the console once the tenant's info is loaded.
 */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initialising, suspended } = useAuth();
  const location = useLocation();
  const ready = !!user && !user.mustChangePassword && !suspended;
  const info = useTenantInfoQuery(ready);

  if (initialising) return <FullPageSpin />;
  if (suspended) return <SuspendedScreen />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  if (user.mustChangePassword) return <Navigate to="/change-password" replace />;
  if (info.data) return <>{children}</>;
  if (info.isError) {
    return (
      <Flex align="center" justify="center" style={{ minHeight: '100vh', padding: 16 }}>
        <Result
          status="warning"
          title={t('error.title')}
          subTitle={describeError(info.error)}
          extra={
            <Button type="primary" onClick={() => void info.refetch()}>
              {t('common.retry')}
            </Button>
          }
        />
      </Flex>
    );
  }
  return <FullPageSpin />;
}

/** Owner-only pages (e.g. Users): other roles get a clear message instead of the page. */
export function OwnerOnly({ children }: { children: ReactNode }) {
  const { isOwner } = usePermissions();
  if (!isOwner) return <Result status="403" title={t('auth.ownersOnly.title')} subTitle={t('auth.ownersOnly.subtitle')} />;
  return <>{children}</>;
}

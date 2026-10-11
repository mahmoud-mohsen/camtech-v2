import { KeyOutlined, LogoutOutlined, MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, MoonOutlined, SafetyCertificateFilled, SunOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { App, Button, Drawer, Dropdown, Flex, Grid, Layout, Menu, Modal, Tag, Tooltip, Typography, type MenuProps } from 'antd';
import { Suspense, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { USE_MOCKS } from '../api/client';
import { reviewsApi } from '../api/operations';
import { useAuth } from '../auth/useAuth';
import { ChangePasswordForm } from '../auth/ChangePasswordForm';
import { PersonAvatar } from '../components/ui';
import { ROLE_LABELS } from '../lib/labels';
import { activeNavPath, NAV } from './nav';
import { PageSkeleton } from './PageSkeleton';
import { useThemeMode } from './useThemeMode';

const { Sider, Header, Content } = Layout;

function usePendingReviews(): number {
  const open = useQuery({ queryKey: ['review-count', 'OPEN'], queryFn: () => reviewsApi.list({ status: 'OPEN', size: 1 }), refetchInterval: 60_000 });
  return open.data?.total ?? 0;
}

function AccountMenu() {
  const { user, logout } = useAuth();
  const { message } = App.useApp();
  const [pwdOpen, setPwdOpen] = useState(false);
  const screens = Grid.useBreakpoint();
  if (!user) return null;
  const items: MenuProps['items'] = [
    {
      key: 'who',
      disabled: true,
      label: (
        <Flex vertical style={{ cursor: 'default' }}>
          <Typography.Text strong>{user.displayName}</Typography.Text>
          <span className="ct-meta">
            {user.username} · {ROLE_LABELS[user.role]}
          </span>
        </Flex>
      ),
    },
    { type: 'divider' },
    { key: 'pwd', icon: <KeyOutlined />, label: 'Change password', onClick: () => setPwdOpen(true) },
    { key: 'out', icon: <LogoutOutlined />, label: 'Sign out', danger: true, onClick: () => logout() },
  ];
  return (
    <>
      <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
        <Button type="text" style={{ height: 48, paddingInline: 8 }} aria-label="Account">
          <Flex align="center" gap={10}>
            <PersonAvatar name={user.displayName} size={32} />
            {screens.md && (
              <Flex vertical align="flex-start" style={{ lineHeight: 1.25 }}>
                <span style={{ fontWeight: 700 }}>{user.displayName}</span>
                <span className="ct-meta" style={{ fontSize: 12, fontWeight: 500 }}>
                  {ROLE_LABELS[user.role]}
                </span>
              </Flex>
            )}
          </Flex>
        </Button>
      </Dropdown>
      <Modal open={pwdOpen} title="Change password" footer={null} onCancel={() => setPwdOpen(false)} destroyOnHidden>
        <ChangePasswordForm
          onDone={() => {
            setPwdOpen(false);
            message.success('Password changed');
          }}
        />
      </Modal>
    </>
  );
}

function PendingCount({ count }: { count: number }) {
  return (
    <span
      className="tabular"
      style={{
        minWidth: 22, height: 22, padding: '0 7px', borderRadius: 999, background: '#F79009', color: '#0B2545',
        fontSize: 12, fontWeight: 800, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
      }}
    >
      {count}
    </span>
  );
}

export function AppLayout() {
  const { user } = useAuth();
  const { mode, toggle } = useThemeMode();
  const navigate = useNavigate();
  const location = useLocation();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);
  const pending = usePendingReviews();
  const narrow = !screens.lg;
  // Phones get a slide-out menu instead of a permanent icon rail.
  const phone = screens.md === false;
  const [menuOpen, setMenuOpen] = useState(false);
  const isCollapsed = phone ? false : narrow ? true : collapsed;
  useEffect(() => setMenuOpen(false), [location.pathname]);

  const items: MenuProps['items'] = NAV.map((g) => ({
    type: 'group' as const,
    key: g.label,
    label: isCollapsed ? null : g.label.toUpperCase(),
    children: g.items
      .filter((i) => !i.roles || (user && i.roles.includes(user.role)))
      .map((i) => ({
        key: i.path,
        icon: i.icon,
        label:
          i.badge === 'pendingReviews' && pending > 0 ? (
            <Flex justify="space-between" align="center">
              {i.label}
              <PendingCount count={pending} />
            </Flex>
          ) : (
            i.label
          ),
      })),
  }));

  const siderContent = (
        <Flex vertical style={{ minHeight: '100%' }}>
          <Flex
            align="center"
            gap={12}
            role="link"
            tabIndex={0}
            aria-label="Dashboard"
            style={{ height: 72, padding: isCollapsed ? '0 18px' : '0 24px', cursor: 'pointer', flexShrink: 0 }}
            onClick={() => navigate('/')}
            onKeyDown={(e) => e.key === 'Enter' && navigate('/')}
          >
            <span
              style={{
                width: 36, height: 36, borderRadius: 10, background: '#0074C1', color: '#FFFFFF', flexShrink: 0,
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
              }}
            >
              <SafetyCertificateFilled />
            </span>
            {!isCollapsed && (
              <Flex vertical style={{ lineHeight: 1.2 }}>
                <span style={{ color: '#FFFFFF', fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em' }}>CamTech</span>
                <span style={{ color: 'rgba(255,255,255,0.7)', fontSize: 12 }}>Operations</span>
              </Flex>
            )}
          </Flex>
          <Menu
            mode="inline"
            theme="dark"
            selectedKeys={[activeNavPath(location.pathname)]}
            items={items}
            onClick={(e) => navigate(e.key)}
            style={{ borderInlineEnd: 'none', flex: 1, fontWeight: 600 }}
          />
          {!narrow && !phone && (
            <Button
              type="text"
              aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((c) => !c)}
              style={{ color: 'rgba(255,255,255,0.7)', margin: 16, alignSelf: isCollapsed ? 'center' : 'flex-start' }}
            >
              {isCollapsed ? null : 'Collapse'}
            </Button>
          )}
        </Flex>
  );

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {phone ? (
        <Drawer
          open={menuOpen}
          onClose={() => setMenuOpen(false)}
          placement="left"
          size={280}
          closable={false}
          styles={{ body: { padding: 0, background: '#0B2545' }, header: { display: 'none' } }}
        >
          {siderContent}
        </Drawer>
      ) : (
        <Sider
          width={256}
          collapsedWidth={72}
          collapsed={isCollapsed}
          theme="dark"
          style={{ position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
        >
          {siderContent}
        </Sider>
      )}
      <Layout>
        <Header
          style={{
            borderBottom: '1px solid var(--ct-border-subtle)', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 10, height: 64, lineHeight: '64px',
          }}
        >
          <Flex align="center" gap={8}>
            {phone && <Button type="text" aria-label="Open menu" icon={<MenuOutlined />} onClick={() => setMenuOpen(true)} />}
            {USE_MOCKS && (
              <Tooltip title="Data comes from the built-in mock layer, not a real backend. Changes are lost on reload.">
                <Tag color="purple" variant="filled" className="ct-pill">
                  Demo data
                </Tag>
              </Tooltip>
            )}
          </Flex>
          <Flex align="center" gap={4} style={{ marginInlineStart: 'auto' }}>
            <Tooltip title={mode === 'light' ? 'Dark theme' : 'Light theme'}>
              <Button type="text" aria-label="Toggle theme" icon={mode === 'light' ? <MoonOutlined /> : <SunOutlined />} onClick={toggle} />
            </Tooltip>
            <AccountMenu />
          </Flex>
        </Header>
        <Content style={{ padding: screens.md ? '32px 40px 48px' : 16, maxWidth: 1360, width: '100%', margin: '0 auto' }}>
          <Suspense fallback={<PageSkeleton />}>
            <Outlet />
          </Suspense>
        </Content>
      </Layout>
    </Layout>
  );
}

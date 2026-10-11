import { DownOutlined, KeyOutlined, LogoutOutlined, MenuFoldOutlined, MenuOutlined, MenuUnfoldOutlined, MoonOutlined, SunOutlined } from '@ant-design/icons';
import { App, Badge, Button, Drawer, Dropdown, Flex, Grid, Layout, Menu, Modal, Tag, theme, Tooltip, Typography, type MenuProps } from 'antd';
import { Suspense, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { BrandMark } from '../components/BrandMark';
import { USE_MOCKS } from '../env';
import { t } from '../i18n';
import { ChangePasswordForm } from '../auth/ChangePasswordForm';
import { useAuth, usePermissions, useTenantInfo } from '../auth/useAuth';
import { useReviewSummary } from '../lib/hooks';
import { activeNavPath, navFor, navLabel, pendingReviews, type NavItem } from './nav';
import { PageSkeleton } from './PageSkeleton';
import { useThemeMode } from './useThemeMode';

const { Sider, Header, Content } = Layout;

function Brand({ collapsed, onClick }: { collapsed: boolean; onClick: () => void }) {
  return (
    <Flex
      align="center"
      gap={12}
      role="link"
      tabIndex={0}
      style={{ height: 72, padding: collapsed ? '0 16px' : '0 22px', cursor: 'pointer', flex: 'none' }}
      onClick={onClick}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}
    >
      <BrandMark size={36} />
      {!collapsed && (
        <Flex vertical style={{ lineHeight: 1.2 }}>
          <span style={{ fontWeight: 800, fontSize: 17, letterSpacing: '-0.02em', color: 'var(--ct-heading)' }}>CamTech</span>
          <span className="ct-meta" style={{ fontSize: 12 }}>
            {t('app.short')}
          </span>
        </Flex>
      )}
    </Flex>
  );
}

function NavMenu({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isOwner } = usePermissions();
  const summary = useReviewSummary();
  const pending = pendingReviews(summary.data);
  const entry = (i: NavItem) => {
    if (i.badge !== 'reviews' || !pending) return { key: i.path, icon: i.icon, label: navLabel(i) };
    const hint = t('nav.reviews.pending', { n: pending });
    return {
      key: i.path,
      icon: collapsed ? <Badge dot color="#F79009" offset={[2, 0]}>{i.icon}</Badge> : i.icon,
      title: hint,
      label: (
        <Flex justify="space-between" align="center" gap={8}>
          <span>{navLabel(i)}</span>
          <Badge count={pending} overflowCount={99} color="#F79009" title={hint} aria-label={hint} style={{ color: '#0B2545', fontWeight: 800, boxShadow: 'none' }} />
        </Flex>
      ),
    };
  };
  const items: MenuProps['items'] = navFor(isOwner).map((g) => ({
    type: 'group' as const,
    key: g.label,
    label: collapsed ? null : <span style={{ textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700 }}>{t(g.label)}</span>,
    children: g.items.map(entry),
  }));
  return (
    <Menu
      mode="inline"
      selectedKeys={[activeNavPath(location.pathname, location.search)]}
      items={items}
      onClick={(e) => {
        navigate(e.key);
        onNavigate?.();
      }}
      style={{ borderInlineEnd: 'none', padding: '0 8px', fontWeight: 600 }}
    />
  );
}

function initials(name: string): string {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  const two = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : name.slice(0, 2);
  return two.toUpperCase();
}

/** Who is signed in (name, company, role), change password and sign out. */
function UserMenu({ compact }: { compact: boolean }) {
  const { user, tenant, logout } = useAuth();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const [changing, setChanging] = useState(false);
  if (!user) return null;
  const name = user.displayName || user.username;
  const roleLabel = t(`role.${user.role}`);
  const items: MenuProps['items'] = [
    {
      key: 'who',
      disabled: true,
      label: (
        <div style={{ cursor: 'default', padding: '2px 0', maxWidth: 280 }}>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {t('auth.signedInAs')}
          </Typography.Text>
          <br />
          <Typography.Text strong>{name}</Typography.Text>{' '}
          <Typography.Text type="secondary" style={{ fontSize: 12, fontFamily: token.fontFamilyCode }}>
            {user.username}
          </Typography.Text>
          <br />
          <Tag color="blue" variant="filled" className="ct-pill" style={{ marginTop: 4 }}>
            {roleLabel}
          </Tag>
          {tenant && (
            <>
              <br />
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                {t('auth.company')}: {tenant.name} <Typography.Text code style={{ fontSize: 12 }}>{tenant.code}</Typography.Text>
              </Typography.Text>
            </>
          )}
        </div>
      ),
    },
    { type: 'divider' },
    { key: 'password', icon: <KeyOutlined />, label: t('password.change'), onClick: () => setChanging(true) },
    { key: 'logout', icon: <LogoutOutlined />, label: t('auth.logout'), onClick: () => void logout() },
  ];
  return (
    <>
      <Dropdown menu={{ items }} trigger={['click']} placement="bottomRight">
        <Button type="text" style={{ height: 44, paddingInline: 8 }} aria-label={`${name} · ${roleLabel}`}>
          <Flex align="center" gap={8}>
            <span
              aria-hidden
              style={{
                width: 32, height: 32, borderRadius: 999, display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 12,
                background: 'var(--ct-brand-soft)', color: 'var(--ct-brand-strong)',
              }}
            >
              {initials(name)}
            </span>
            {!compact && (
              <Flex vertical align="flex-start" style={{ lineHeight: 1.2 }}>
                <span style={{ fontWeight: 700 }}>{name}</span>
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {tenant?.name ?? ''} · {roleLabel}
                </Typography.Text>
              </Flex>
            )}
            <DownOutlined style={{ fontSize: 10, opacity: 0.6 }} />
          </Flex>
        </Button>
      </Dropdown>
      <Modal open={changing} title={t('password.change')} footer={null} onCancel={() => setChanging(false)} destroyOnHidden>
        <ChangePasswordForm
          onDone={() => {
            message.success(t('password.changed'));
            setChanging(false);
          }}
        />
      </Modal>
    </>
  );
}

export function AppLayout() {
  const { token } = theme.useToken();
  const { mode, toggle } = useThemeMode();
  const navigate = useNavigate();
  const screens = Grid.useBreakpoint();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const info = useTenantInfo();

  const mobile = !screens.md;
  const tablet = !!screens.md && !screens.xl;
  const isCollapsed = tablet ? true : collapsed;

  return (
    <Layout style={{ minHeight: '100vh' }}>
      {!mobile && (
        <Sider
          width={256}
          collapsedWidth={72}
          collapsed={isCollapsed}
          theme={mode}
          style={{ borderInlineEnd: `1px solid ${token.colorBorderSecondary}`, position: 'sticky', top: 0, height: '100vh', overflow: 'auto' }}
        >
          <Brand collapsed={isCollapsed} onClick={() => navigate('/')} />
          <NavMenu collapsed={isCollapsed} />
        </Sider>
      )}
      {mobile && (
        <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)} placement="left" size={260} styles={{ body: { padding: 0 } }} closable={false}>
          <Brand collapsed={false} onClick={() => { navigate('/'); setDrawerOpen(false); }} />
          <NavMenu collapsed={false} onNavigate={() => setDrawerOpen(false)} />
        </Drawer>
      )}
      <Layout>
        <Header
          style={{
            borderBottom: `1px solid ${token.colorBorderSecondary}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            position: 'sticky', top: 0, zIndex: 10, height: 64, lineHeight: '64px', gap: 8,
          }}
        >
          <Flex align="center" gap={8} style={{ minWidth: 0 }}>
            {mobile ? (
              <Button type="text" aria-label={t('menu.expand')} icon={<MenuOutlined />} onClick={() => setDrawerOpen(true)} />
            ) : (
              !tablet && (
                <Button
                  type="text"
                  aria-label={collapsed ? t('menu.expand') : t('menu.collapse')}
                  icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                  onClick={() => setCollapsed((c) => !c)}
                />
              )
            )}
            {info.status === 'SUSPENDED' && <Tag color="error" variant="filled" className="ct-pill">Suspended</Tag>}
            {USE_MOCKS && (
              <Tooltip title={t('mock.tooltip')}>
                <Tag color="purple" variant="filled" className="ct-pill">
                  {t('mock.tag')}
                </Tag>
              </Tooltip>
            )}
          </Flex>
          <Flex align="center" gap={4}>
            <Tooltip title={mode === 'light' ? t('theme.dark') : t('theme.light')}>
              <Button type="text" aria-label={mode === 'light' ? t('theme.dark') : t('theme.light')} icon={mode === 'light' ? <MoonOutlined /> : <SunOutlined />} onClick={toggle} />
            </Tooltip>
            <UserMenu compact={mobile} />
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

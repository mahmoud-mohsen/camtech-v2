import {
  ApiOutlined, AppstoreOutlined, AuditOutlined, BranchesOutlined, ClockCircleOutlined, DashboardOutlined,
  IdcardOutlined, MessageOutlined, SafetyCertificateOutlined, ScanOutlined, SettingOutlined, SolutionOutlined, TeamOutlined,
  UserOutlined, CrownOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import type { Role } from '../api/types';

export interface NavItem {
  path: string;
  label: string;
  icon: ReactNode;
  roles?: Role[];
  badge?: 'pendingReviews';
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  { label: 'Overview', items: [{ path: '/', label: 'Dashboard', icon: <DashboardOutlined /> }] },
  {
    label: 'Operations',
    items: [
      { path: '/verifications', label: 'Verifications', icon: <SafetyCertificateOutlined /> },
      { path: '/reviews', label: 'Review queue', icon: <SolutionOutlined />, badge: 'pendingReviews' },
      { path: '/people', label: 'People', icon: <UserOutlined /> },
      { path: '/documents', label: 'Documents', icon: <IdcardOutlined /> },
      { path: '/scans', label: 'Document scans', icon: <ScanOutlined /> },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { path: '/config/tenant', label: 'Tenants', icon: <CrownOutlined /> },
      { path: '/config/client-apps', label: 'Client apps', icon: <AppstoreOutlined /> },
      { path: '/config/settings', label: 'Settings', icon: <SettingOutlined /> },
      { path: '/config/flows', label: 'Flows', icon: <BranchesOutlined /> },
      { path: '/config/messages', label: 'Messages', icon: <MessageOutlined /> },
      { path: '/config/webhooks', label: 'Webhooks', icon: <ApiOutlined /> },
      { path: '/config/retention', label: 'Data retention', icon: <ClockCircleOutlined /> },
    ],
  },
  {
    label: 'Administration',
    items: [
      { path: '/audit', label: 'Audit log', icon: <AuditOutlined /> },
      { path: '/users', label: 'Users', icon: <TeamOutlined />, roles: ['ADMIN'] },
    ],
  },
];

/** Finds the nav entry that owns a pathname (longest prefix wins). */
export function activeNavPath(pathname: string): string {
  const all = NAV.flatMap((g) => g.items.map((i) => i.path));
  const match = all.filter((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(p + '/'))).sort((a, b) => b.length - a.length);
  return match[0] ?? '/';
}


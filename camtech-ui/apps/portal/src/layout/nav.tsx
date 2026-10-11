import {
  ApiOutlined, AppstoreOutlined, AuditOutlined, BgColorsOutlined, BookOutlined, CheckSquareOutlined, ControlOutlined, DashboardOutlined, ExperimentOutlined,
  FileSearchOutlined, IdcardOutlined, SafetyCertificateOutlined, SettingOutlined, UserOutlined,
} from '@ant-design/icons';
import type { ReactNode } from 'react';
import { t, type MessageKey } from '../i18n';

export interface NavItem {
  path: string;
  label: MessageKey;
  icon: ReactNode;
  /** Shown to OWNERs only (the route is guarded too). */
  ownerOnly?: boolean;
  /** Shows the count of items waiting for review. */
  badge?: 'reviews';
}

export interface NavGroup {
  label: MessageKey;
  items: NavItem[];
}

// Monitor (daily work, the review queue first), Build (developer set-up), Account (settings, audit).
export const NAV: NavGroup[] = [
  {
    label: 'nav.group.monitor',
    items: [
      { path: '/', label: 'nav.overview', icon: <DashboardOutlined /> },
      { path: '/reviews', label: 'nav.reviews', icon: <CheckSquareOutlined />, badge: 'reviews' },
      { path: '/verifications', label: 'nav.verifications', icon: <SafetyCertificateOutlined /> },
      { path: '/scans', label: 'nav.scans', icon: <FileSearchOutlined /> },
      { path: '/documents', label: 'nav.documents', icon: <IdcardOutlined /> },
      { path: '/people', label: 'nav.people', icon: <UserOutlined /> },
    ],
  },
  {
    label: 'nav.group.build',
    items: [
      { path: '/apps', label: 'nav.apps', icon: <AppstoreOutlined /> },
      { path: '/webhooks', label: 'nav.webhooks', icon: <ApiOutlined /> },
      { path: '/flows', label: 'nav.flows', icon: <ControlOutlined /> },
      { path: '/branding', label: 'nav.branding', icon: <BgColorsOutlined /> },
      { path: '/playground', label: 'nav.playground', icon: <ExperimentOutlined /> },
      { path: '/guide', label: 'nav.guide', icon: <BookOutlined /> },
    ],
  },
  {
    label: 'nav.group.account',
    items: [
      { path: '/settings', label: 'nav.settings', icon: <SettingOutlined /> },
      { path: '/audit', label: 'nav.audit', icon: <AuditOutlined /> },
    ],
  },
];

/** The navigation this user sees: owner-only entries removed for other roles, empty groups dropped. */
export function navFor(isOwner: boolean): NavGroup[] {
  return NAV.map((g) => ({ ...g, items: g.items.filter((i) => isOwner || !i.ownerOnly) })).filter((g) => g.items.length > 0);
}

/**
 * Finds the nav entry that owns a page: the entry named by a `from` query wins (a scan opened from the review
 * queue stays under Reviews), else the longest path prefix.
 */
export function activeNavPath(pathname: string, search = ''): string {
  const all = NAV.flatMap((g) => g.items.map((i) => i.path));
  const from = new URLSearchParams(search).get('from');
  if (from && all.includes(`/${from}`)) return `/${from}`;
  const match = all.filter((p) => (p === '/' ? pathname === '/' : pathname === p || pathname.startsWith(p + '/'))).sort((a, b) => b.length - a.length);
  return match[0] ?? '';
}

/** What the reviews badge counts: scans waiting, plus verifications when the tenant reviews them itself. */
export function pendingReviews(summary: { owner: string; scansToReview: number; verificationsToReview: number } | undefined): number {
  if (!summary) return 0;
  return summary.scansToReview + (summary.owner === 'TENANT' ? summary.verificationsToReview : 0);
}

export const navLabel = (item: NavItem) => t(item.label);

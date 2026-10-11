import { ApiOutlined, ClockCircleOutlined, FileSearchOutlined, IdcardOutlined, KeyOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import type { TenantAttention } from '@camtech/api-client';
import type { ReactNode } from 'react';
import { t } from '../../i18n';
import { expiringBeforeFor } from '../../lib/expiry';
import { formatRelative } from '../../lib/format';
import { featureLabel } from '../../lib/labels';

export interface AttentionItem {
  key: string;
  icon: ReactNode;
  text: string;
  to?: string;
  tone: 'warning' | 'error';
}

/** Share of the daily quota after which usage is flagged. */
const QUOTA_WARNING = 0.8;

/** What needs a look, most urgent first: failing webhooks, expiring keys, work waiting, expiring documents, quotas. */
export function attentionItems(
  a: TenantAttention,
  appIds: Record<string, number>,
  quotas: { featureCode: string; quotaPerDay: number | null; usedToday: number; enabled: boolean }[],
  today: Date = new Date(),
): AttentionItem[] {
  const items: AttentionItem[] = [];
  for (const w of a.failingWebhooks) {
    items.push({ key: `webhook-${w.id}`, icon: <ApiOutlined />, tone: 'error', text: t('attention.webhook', { url: w.url, n: w.consecutiveFailures }), to: `/webhooks?webhook=${w.id}` });
  }
  for (const k of a.credentialsExpiring) {
    const id = appIds[k.clientAppCode];
    items.push({
      key: `key-${k.keyId}`, icon: <KeyOutlined />, tone: 'warning',
      text: t('attention.credential', { key: k.keyId, app: k.clientAppCode, when: formatRelative(k.expiresAt) }),
      to: id ? `/apps/${id}` : '/apps',
    });
  }
  if (a.verificationsToReview > 0) {
    items.push({ key: 'verifications', icon: <SafetyCertificateOutlined />, tone: 'warning', text: t('attention.verifications', { n: a.verificationsToReview }), to: '/reviews?tab=verifications' });
  }
  if (a.scansToReview > 0) {
    items.push({ key: 'scans', icon: <FileSearchOutlined />, tone: 'warning', text: t('attention.scans', { n: a.scansToReview }), to: '/reviews?tab=scans' });
  }
  if (a.documentsExpiring > 0) {
    items.push({
      key: 'documents', icon: <IdcardOutlined />, tone: 'warning',
      text: t('attention.documents', { n: a.documentsExpiring, days: a.expiryWarningDays }),
      to: `/documents?expiringBefore=${expiringBeforeFor(a.expiryWarningDays, today)}`,
    });
  }
  for (const q of quotas) {
    if (!q.enabled || !q.quotaPerDay) continue;
    const share = q.usedToday / q.quotaPerDay;
    if (share >= QUOTA_WARNING) {
      items.push({ key: `quota-${q.featureCode}`, icon: <ClockCircleOutlined />, tone: share >= 1 ? 'error' : 'warning', text: t('attention.quota', { feature: featureLabel(q.featureCode), pct: Math.round(share * 100) }) });
    }
  }
  return items;
}

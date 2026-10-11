import type { TenantAttention } from '@camtech/api-client';
import { describe, expect, it } from 'vitest';
import { attentionItems } from './attention';

const none: TenantAttention = { scansToReview: 0, verificationsToReview: 0, failingWebhooks: [], credentialsExpiring: [], documentsExpiring: 0, expiryWarningDays: 30 };
const today = new Date(2026, 9, 10);

describe('Overview "Needs attention"', () => {
  it('is empty when nothing waits', () => {
    expect(attentionItems(none, {}, [], today)).toEqual([]);
  });

  it('links each item to where it is handled, most urgent first', () => {
    const items = attentionItems(
      {
        scansToReview: 2,
        verificationsToReview: 5,
        failingWebhooks: [{ id: 9, url: 'https://ops.example/hook', consecutiveFailures: 7, lastDeliveryAt: null }],
        credentialsExpiring: [{ clientAppCode: 'MOBILE_APP', keyId: 'ck_1', expiresAt: '2026-10-19T00:00:00Z' }, { clientAppCode: 'GONE', keyId: 'ck_2', expiresAt: '2026-10-20T00:00:00Z' }],
        documentsExpiring: 4,
        expiryWarningDays: 30,
      },
      { MOBILE_APP: 3 },
      [],
      today,
    );
    expect(items.map((i) => [i.key, i.to, i.tone])).toEqual([
      ['webhook-9', '/webhooks?webhook=9', 'error'],
      ['key-ck_1', '/apps/3', 'warning'],
      ['key-ck_2', '/apps', 'warning'],
      ['verifications', '/reviews?tab=verifications', 'warning'],
      ['scans', '/reviews?tab=scans', 'warning'],
      ['documents', '/documents?expiringBefore=2026-11-10', 'warning'],
    ]);
    expect(items[0].text).toContain('https://ops.example/hook');
    expect(items[0].text).toContain('7');
    expect(items[5].text).toBe('4 documents expire within 30 days');
  });

  it('flags quotas used at 80% or more', () => {
    const items = attentionItems(none, {}, [
      { featureCode: 'DOCUMENT_SCAN', quotaPerDay: 200, usedToday: 170, enabled: true },
      { featureCode: 'SELFIE_ID_VERIFICATION', quotaPerDay: 100, usedToday: 100, enabled: true },
      { featureCode: 'FACE_AUTHENTICATION', quotaPerDay: 100, usedToday: 10, enabled: true },
      { featureCode: 'LIVENESS_CHECK', quotaPerDay: null, usedToday: 900, enabled: true },
    ], today);
    expect(items.map((i) => [i.key, i.tone])).toEqual([['quota-DOCUMENT_SCAN', 'warning'], ['quota-SELFIE_ID_VERIFICATION', 'error']]);
    expect(items[0].text).toBe('Document scan: 85% of today’s quota used');
  });
});

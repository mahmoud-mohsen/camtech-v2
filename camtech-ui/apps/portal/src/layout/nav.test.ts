import { describe, expect, it } from 'vitest';
import { hasTranslation, MESSAGE_KEYS } from '../i18n';
import { activeNavPath, NAV, navFor, pendingReviews } from './nav';

describe('navigation', () => {
  it('groups the pages as Monitor, Build, Account', () => {
    expect(NAV.map((g) => [g.label, g.items.map((i) => i.path)])).toEqual([
      ['nav.group.monitor', ['/', '/reviews', '/verifications', '/scans', '/documents', '/people']],
      ['nav.group.build', ['/apps', '/webhooks', '/flows', '/branding', '/playground', '/guide']],
      ['nav.group.account', ['/settings', '/audit']],
    ]);
  });

  it('shows every entry to every role (owner-only settings are a tab of Settings)', () => {
    const paths = (owner: boolean) => navFor(owner).flatMap((g) => g.items.map((i) => i.path));
    expect(paths(false)).toEqual(paths(true));
  });

  it('highlights the owning entry of nested pages', () => {
    expect(activeNavPath('/')).toBe('/');
    expect(activeNavPath('/reviews/12')).toBe('/reviews');
    expect(activeNavPath('/documents/3')).toBe('/documents');
    expect(activeNavPath('/people/7')).toBe('/people');
    expect(activeNavPath('/scans/41')).toBe('/scans');
    expect(activeNavPath('/settings/documents')).toBe('/settings');
  });

  it('keeps a page opened from the review queue under Reviews', () => {
    expect(activeNavPath('/scans/41', '?from=reviews')).toBe('/reviews');
    expect(activeNavPath('/scans/41', '?from=nowhere')).toBe('/scans');
  });

  it('counts pending reviews, verifications only when the tenant reviews them', () => {
    expect(pendingReviews(undefined)).toBe(0);
    expect(pendingReviews({ owner: 'TENANT', scansToReview: 3, verificationsToReview: 4 })).toBe(7);
    expect(pendingReviews({ owner: 'CAMTECH', scansToReview: 3, verificationsToReview: 4 })).toBe(3);
  });

  it('has Arabic text for every navigation and new page string', () => {
    const scoped = MESSAGE_KEYS.filter((k) =>
      /^(nav|settings|media|expiry|documents?|people|person|reviews|case|reviewSettings|documentSettings|retention|attention|webhooks)\./.test(k),
    );
    expect(scoped.length).toBeGreaterThan(150);
    expect(scoped.filter((k) => !hasTranslation('ar', k))).toEqual([]);
  });
});

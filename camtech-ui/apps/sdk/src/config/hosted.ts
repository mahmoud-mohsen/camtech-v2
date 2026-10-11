// Configuration of the hosted page from its URL. Secrets travel in the hash (never sent to servers or logged by
// proxies) and are removed from the address bar immediately; non-secret options are in the query.
import type { Lang } from '@camtech/api-client';
import { originOf } from '../core/protocol';
import type { CamtechOptions } from './options';

export const PREVIEW_SCREENS = [
  'welcome', 'liveness', 'document', 'result-approved', 'result-review', 'result-rejected',
] as const;
export type PreviewScreen = (typeof PREVIEW_SCREENS)[number];

export interface HostedLaunch {
  preview: { screen: PreviewScreen; lang: Lang } | null;
  /** Untrusted raw options (normalize before use). */
  options: Partial<Record<keyof CamtechOptions | 'returnUrl', unknown>>;
  /** Origin of the embedding page (iframe mode), validated. */
  parentOrigin: string | null;
  /** The hash carried an SDK token or a session. */
  hasSecrets: boolean;
  /** Mock scenarios (mock builds only). */
  mockScenarios: string[];
}

export function parseHostedLocation(href: string): HostedLaunch {
  const url = new URL(href);
  const q = url.searchParams;
  const hash = new URLSearchParams(url.hash.replace(/^#/, ''));
  const lang: Lang = q.get('lang') === 'ar' ? 'ar' : 'en';

  if (q.get('preview') === '1') {
    const screen = q.get('screen');
    return {
      preview: { screen: (PREVIEW_SCREENS as readonly string[]).includes(screen ?? '') ? screen as PreviewScreen : 'welcome', lang },
      options: { lang },
      parentOrigin: originOf(q.get('parentOrigin')),
      hasSecrets: false,
      mockScenarios: [],
    };
  }

  const options: HostedLaunch['options'] = {
    journey: q.get('journey') ?? undefined,
    subjectRef: q.get('subjectRef') ?? undefined,
    lang,
    documentType: q.get('documentType') ?? undefined,
    enrollFace: q.get('enrollFace') ?? undefined,
    scanTypes: q.get('scanTypes') ?? undefined,
    returnUrl: q.get('returnUrl') ?? undefined,
    debug: q.get('debug') ?? undefined,
    simulateCamera: q.get('simulateCamera') ?? undefined,
    sdkToken: hash.get('sdkToken') ?? undefined,
    sessionId: hash.get('sessionId') ?? undefined,
    sessionToken: hash.get('sessionToken') ?? undefined,
  };
  return {
    preview: null,
    options,
    parentOrigin: originOf(q.get('parentOrigin')),
    hasSecrets: Boolean(hash.get('sdkToken') || (hash.get('sessionId') && hash.get('sessionToken'))),
    mockScenarios: (q.get('mock') ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean),
  };
}

/** The URL without its hash, for history.replaceState (keeps the query). */
export function stripHash(href: string): string {
  const url = new URL(href);
  url.hash = '';
  return url.toString();
}

/**
 * Where to send the user at the end: the return URL plus only `camtechSessionId` and `camtechStatus`.
 * The result token never goes in a URL; the tenant backend reads the result itself.
 */
export function buildReturnUrl(returnUrl: string, sessionId: string | null, status: 'completed' | 'cancelled' | 'failed'): string | null {
  let url: URL;
  try {
    url = new URL(returnUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (sessionId) url.searchParams.set('camtechSessionId', sessionId);
  url.searchParams.set('camtechStatus', status);
  return url.toString();
}

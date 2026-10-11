// Resume support: the current selfie verification is kept in sessionStorage (cleared when the tab closes;
// never localStorage). Storage may be unavailable (private mode, partitioned iframes): every access is guarded.
import type { IdDocumentType } from '@camtech/api-client';

const KEY = 'camtech.selfie-session.v1';

export interface StoredSession {
  sessionId: string;
  sessionToken: string;
  /** Last step reached (informational; the server's nextStep wins on resume). */
  step: string;
  documentType: IdDocumentType | null;
  expiresAt: string | null;
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function loadSession(): StoredSession | null {
  try {
    const raw = storage()?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof v.sessionId !== 'string' || typeof v.sessionToken !== 'string') return null;
    if (v.expiresAt && Date.parse(v.expiresAt) <= Date.now()) {
      clearSession();
      return null;
    }
    return {
      sessionId: v.sessionId,
      sessionToken: v.sessionToken,
      step: typeof v.step === 'string' ? v.step : 'LIVENESS',
      documentType: v.documentType === 'EMIRATES_ID' || v.documentType === 'PASSPORT' ? v.documentType : null,
      expiresAt: typeof v.expiresAt === 'string' ? v.expiresAt : null,
    };
  } catch {
    return null;
  }
}

export function saveSession(s: StoredSession): void {
  try {
    storage()?.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage full or blocked: resume will not be available */
  }
}

export function updateSession(patch: Partial<StoredSession>): void {
  const cur = loadSession();
  if (cur) saveSession({ ...cur, ...patch });
}

export function clearSession(): void {
  try {
    storage()?.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

import type { MediaRef, SessionDetail, Step } from '../api/types';

function lastStep(steps: Step[], code: string, passedOnly: boolean): Step | undefined {
  const list = steps.filter((s) => s.stepCode === code && (!passedOnly || s.status === 'PASSED'));
  return list[list.length - 1];
}

/** Selfie and document portrait used for the face comparison (derived from the step attempts). */
export function facePair(session: Pick<SessionDetail, 'steps'>): { selfie: MediaRef | null; document: MediaRef | null } {
  const live = lastStep(session.steps, 'LIVENESS', true) ?? lastStep(session.steps, 'LIVENESS', false);
  const selfie = live?.media.find((m) => m.role === 'SELFIE_NORMAL') ?? live?.media[0] ?? null;
  const cap = lastStep(session.steps, 'DOC_CAPTURE', true) ?? lastStep(session.steps, 'DOC_CAPTURE', false);
  const document =
    cap?.media.find((m) => m.role === 'FACE_PHOTO') ??
    cap?.media.find((m) => m.role === 'PHOTO_PAGE') ??
    cap?.media.find((m) => m.role === 'FRONT') ??
    null;
  return { selfie, document };
}

/** The similarity score used for the decision. */
export function sessionSimilarity(session: Pick<SessionDetail, 'steps' | 'finalSimilarity'>): number | null {
  if (session.finalSimilarity !== null) return session.finalSimilarity;
  const match = [...session.steps].reverse().find((s) => s.stepCode === 'FACE_DOC_MATCH' || s.stepCode === 'FACE_TEMPLATE_MATCH');
  return match?.checks.find((c) => c.score !== null)?.score ?? null;
}

export interface DuplicateMatch {
  partyId: number;
  partyName: string | null;
  score: number | null;
  threshold: string | null;
}

/** The other person the duplicate search matched (DEDUP_SEARCH step that failed or went to review), or null. */
export function duplicateMatch(session: Pick<SessionDetail, 'steps'>): DuplicateMatch | null {
  const step = [...session.steps].reverse().find((s) => s.stepCode === 'DEDUP_SEARCH' && (s.status === 'FAILED' || s.status === 'REVIEW'));
  const check = step?.checks.find((c) => (c.checkCode === 'DEDUP_1N' || c.checkCode === 'DEDUP_MATCH') && typeof c.details?.matchedPartyId === 'number');
  if (!check) return null;
  const name = check.details?.matchedPartyName;
  return { partyId: check.details!.matchedPartyId as number, partyName: typeof name === 'string' ? name : null, score: check.score, threshold: check.thresholdUsed };
}

/** Number of failed attempts per step code. */
export function failedAttempts(steps: Step[]): number {
  return steps.filter((s) => s.status === 'FAILED').length;
}

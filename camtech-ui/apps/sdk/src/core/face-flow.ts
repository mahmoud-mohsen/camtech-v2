// The session-less selfie flows (face authentication, liveness check, face enrollment): selfies → one upload → decision.
import type { LivenessChallengeTarget, SelfieFlowResponse } from '@camtech/api-client';
import type { JourneyFlow } from '../config/options';

export type FaceFlow = 'FACE_AUTHENTICATION' | 'LIVENESS_CHECK' | 'FACE_ENROLLMENT';

export const FACE_FLOWS: readonly FaceFlow[] = ['FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'FACE_ENROLLMENT'];

export function isFaceFlow(flow: JourneyFlow | null): flow is FaceFlow {
  return (FACE_FLOWS as readonly (string | null)[]).includes(flow);
}

/**
 * Who the challenge is for. Face authentication sends no `flow` (the server default, as before); a challenge only
 * works for the flow it was issued for. LIVENESS_CHECK works without a subjectRef.
 */
export function faceChallengeTarget(flow: FaceFlow, subjectRef: string | null): LivenessChallengeTarget {
  if (flow === 'FACE_AUTHENTICATION') return { subjectRef: subjectRef ?? '' };
  if (flow === 'FACE_ENROLLMENT') return { subjectRef: subjectRef ?? '', flow };
  return subjectRef ? { subjectRef, flow } : { flow };
}

/**
 * - approved: authenticated / live person / face registered.
 * - review: face enrollment only: the face already belongs to another person, a reviewer decides.
 * - duplicate: face enrollment rejected for that reason (manual review off): taking the selfies again cannot help.
 * - rejected: the selfies can be taken again.
 */
export type FaceOutcome = 'approved' | 'review' | 'duplicate' | 'rejected';

export function faceOutcome(res: Pick<SelfieFlowResponse, 'decision' | 'reasonCode'>): FaceOutcome {
  if (res.decision === 'APPROVED') return 'approved';
  if (res.decision === 'REVIEW') return 'review';
  return res.reasonCode === 'DUPLICATE_IDENTITY' ? 'duplicate' : 'rejected';
}

// State machine of the selfie ID verification screens (pure, so it is unit tested).
import type { ChallengeSubmission, Decision, IdDocumentType, NextStep } from '@camtech/api-client';
import type { DocFields } from './fields';
import type { ReviewState } from './scan-review';

export interface Notice {
  code: string;
  message: string | null;
  attemptsRemaining: number | null;
}

export type OverReason = 'ATTEMPTS' | 'EXPIRED' | 'SESSION' | 'CANCELLED' | 'FAILED';

export type SelfieScreen =
  | { name: 'init' }
  | { name: 'welcome' }
  | { name: 'starting' }
  | { name: 'primer' }
  | { name: 'liveness'; notice: Notice | null }
  | { name: 'livenessUpload'; normal: Blob; challenge: ChallengeSubmission | null }
  | { name: 'docChoice' }
  | { name: 'docCapture'; documentType: IdDocumentType }
  /** Emirates ID only: the back (MRZ), after the front (`image`). */
  | { name: 'docCaptureBack'; documentType: IdDocumentType; image: Blob }
  | { name: 'docReading'; documentType: IdDocumentType; image: Blob; back: Blob | null }
  /** `review`: the merged OCR details to review (null: nothing usable was read, the details are typed in a form). */
  | { name: 'docConfirm'; documentType: IdDocumentType; image: Blob; back: Blob | null; fields: DocFields; ocrFailed: boolean; review: ReviewState | null }
  | { name: 'docUpload'; documentType: IdDocumentType; image: Blob; back: Blob | null; fields: DocFields; review: ReviewState | null }
  | { name: 'docRescan'; documentType: IdDocumentType; notice: Notice }
  | { name: 'finishing' }
  | { name: 'review' }
  | { name: 'result'; decision: Decision; message: string | null }
  | { name: 'over'; reason: OverReason; message: string | null };

export interface SessionInfo {
  sessionId: string;
  expiresAt: string | null;
}

export interface SelfieState {
  screen: SelfieScreen;
  session: SessionInfo | null;
  /** Document chosen (or given by the integrator / session). */
  documentType: IdDocumentType | null;
  /** Only one document is offered: no choice screen. */
  fixedDocument: boolean;
  /** Message of the last document response (shown on the result). */
  lastMessage: string | null;
}

export type SelfieEvent =
  | { type: 'NO_RESUME' }
  | { type: 'RESUMED'; session: SessionInfo; nextStep: NextStep; documentType: IdDocumentType | null; skipWelcome: boolean }
  | { type: 'START' }
  | { type: 'STARTED'; session: SessionInfo }
  | { type: 'CAMERA_READY' }
  | { type: 'LIVENESS_CAPTURED'; normal: Blob; challenge: ChallengeSubmission | null }
  | { type: 'LIVENESS_PASSED'; nextStep: NextStep }
  | { type: 'LIVENESS_RETAKE'; notice: Notice | null }
  | { type: 'CHOOSE_DOCUMENT' }
  | { type: 'DOC_CHOSEN'; documentType: IdDocumentType }
  | { type: 'DOC_CAPTURED'; image: Blob }
  | { type: 'DOC_READ'; fields: DocFields; ocrFailed: boolean; review?: ReviewState | null }
  | { type: 'DOC_SUBMIT'; fields: DocFields; review?: ReviewState | null }
  | { type: 'DOC_EDIT' }
  | { type: 'DOC_RESCAN'; notice: Notice }
  | { type: 'RESCAN' }
  | { type: 'DOC_DONE'; message: string | null }
  | { type: 'RESULT'; decision: Decision | null; message?: string | null }
  | { type: 'OVER'; reason: OverReason; message: string | null }
  | { type: 'RESTART' };

export function initialSelfieState(documentType: IdDocumentType | null, offered: readonly IdDocumentType[]): SelfieState {
  const fixed = documentType ?? (offered.length === 1 ? offered[0] : null);
  return { screen: { name: 'init' }, session: null, documentType: fixed, fixedDocument: fixed !== null, lastMessage: null };
}

/** Documents whose back is captured too (the Emirates ID back carries the MRZ). */
export function hasBack(type: IdDocumentType): boolean {
  return type === 'EMIRATES_ID';
}

function afterLiveness(state: SelfieState): SelfieScreen {
  return state.documentType ? { name: 'docCapture', documentType: state.documentType } : { name: 'docChoice' };
}

function routeNextStep(state: SelfieState, next: NextStep): SelfieScreen {
  if (next === 'LIVENESS') return { name: 'primer' };
  if (next === 'DOCUMENT') return afterLiveness(state);
  return { name: 'finishing' };
}

export function selfieReducer(state: SelfieState, event: SelfieEvent): SelfieState {
  const s = state.screen;
  switch (event.type) {
    case 'NO_RESUME':
      return { ...state, screen: { name: 'welcome' } };
    case 'RESUMED': {
      const next = { ...state, session: event.session, documentType: state.documentType ?? event.documentType };
      if (!event.skipWelcome && event.nextStep !== 'DONE') return { ...next, screen: { name: 'welcome' } };
      return { ...next, screen: routeNextStep(next, event.nextStep) };
    }
    case 'START':
      // A resumed session (welcome shown for consent) continues; otherwise a new one is created.
      return { ...state, screen: state.session ? { name: 'primer' } : { name: 'starting' } };
    case 'STARTED':
      return { ...state, session: event.session, screen: { name: 'primer' } };
    case 'CAMERA_READY':
      return s.name === 'primer' ? { ...state, screen: { name: 'liveness', notice: null } } : state;
    case 'LIVENESS_CAPTURED':
      return s.name === 'liveness' ? { ...state, screen: { name: 'livenessUpload', normal: event.normal, challenge: event.challenge } } : state;
    case 'LIVENESS_PASSED':
      return { ...state, screen: event.nextStep === 'LIVENESS' ? { name: 'liveness', notice: null } : routeNextStep(state, event.nextStep) };
    case 'LIVENESS_RETAKE':
      return { ...state, screen: { name: 'liveness', notice: event.notice } };
    case 'CHOOSE_DOCUMENT':
      return state.fixedDocument ? state : { ...state, screen: { name: 'docChoice' } };
    case 'DOC_CHOSEN':
      return { ...state, documentType: event.documentType, screen: { name: 'docCapture', documentType: event.documentType } };
    case 'DOC_CAPTURED':
      if (s.name === 'docCapture') {
        return {
          ...state,
          screen: hasBack(s.documentType)
            ? { name: 'docCaptureBack', documentType: s.documentType, image: event.image }
            : { name: 'docReading', documentType: s.documentType, image: event.image, back: null },
        };
      }
      return s.name === 'docCaptureBack'
        ? { ...state, screen: { name: 'docReading', documentType: s.documentType, image: s.image, back: event.image } }
        : state;
    case 'DOC_READ':
      return s.name === 'docReading'
        ? { ...state, screen: { name: 'docConfirm', documentType: s.documentType, image: s.image, back: s.back, fields: event.fields, ocrFailed: event.ocrFailed, review: event.review ?? null } }
        : state;
    case 'DOC_SUBMIT':
      return s.name === 'docConfirm'
        ? { ...state, screen: { name: 'docUpload', documentType: s.documentType, image: s.image, back: s.back, fields: event.fields, review: event.review ?? null } }
        : state;
    case 'DOC_EDIT':
      return s.name === 'docUpload'
        ? { ...state, screen: { name: 'docConfirm', documentType: s.documentType, image: s.image, back: s.back, fields: s.fields, ocrFailed: false, review: s.review } }
        : state;
    case 'DOC_RESCAN': {
      const documentType = 'documentType' in s ? s.documentType : state.documentType;
      if (!documentType) return { ...state, screen: { name: 'docChoice' } };
      return { ...state, screen: { name: 'docRescan', documentType, notice: event.notice } };
    }
    case 'RESCAN': {
      const documentType = 'documentType' in s ? s.documentType : state.documentType;
      return { ...state, screen: documentType ? { name: 'docCapture', documentType } : { name: 'docChoice' } };
    }
    case 'DOC_DONE':
      return { ...state, lastMessage: event.message, screen: { name: 'finishing' } };
    case 'RESULT': {
      if (event.decision === 'REVIEW') return { ...state, screen: { name: 'review' } };
      if (event.decision === 'APPROVED' || event.decision === 'REJECTED') {
        return { ...state, screen: { name: 'result', decision: event.decision, message: event.message ?? state.lastMessage } };
      }
      return { ...state, screen: { name: 'over', reason: 'FAILED', message: event.message ?? null } };
    }
    case 'OVER':
      return { ...state, screen: { name: 'over', reason: event.reason, message: event.message } };
    case 'RESTART':
      return { ...state, session: null, lastMessage: null, documentType: state.fixedDocument ? state.documentType : null, screen: { name: 'starting' } };
    default:
      return state;
  }
}

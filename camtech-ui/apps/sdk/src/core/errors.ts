// Maps every API error code (integration guide §5) to what the SDK must do next.
import { CamtechApiError, type NextStep } from '@camtech/api-client';

export const LIVENESS_CODES = [
  'TOO_DARK', 'TOO_BRIGHT', 'BLURRY', 'FACE_TOO_SMALL', 'MULTIPLE_FACES', 'HEAD_TURNED', 'HEAD_TILTED', 'NO_FACE',
  'FACE_CHANGED', 'NOT_CLOSER', 'SPOOF_SUSPECTED', 'CHALLENGE_FAILED', 'FACE_NOT_VISIBLE',
] as const;
export const DOCUMENT_CODES = ['ID_NUMBER_INVALID', 'MRZ_INVALID', 'ID_EXPIRED', 'PASSPORT_EXPIRED', 'NO_FACE'] as const;

export type ErrorAction =
  /** 422 on liveness with attempts left: take the selfie (and the challenge) again. */
  | 'RETAKE_LIVENESS'
  /** 422 on the document with attempts left: scan again. */
  | 'RESCAN_DOCUMENT'
  /** Challenge missing, unknown or expired (400/409): get a new challenge and redo the selfies; no attempt used. */
  | 'NEW_CHALLENGE'
  /** 409 LIVENESS_REQUIRED: back to the selfies. */
  | 'GO_TO_LIVENESS'
  /** 409 already done / closed: read the session state and continue from nextStep. */
  | 'RESUME'
  /** The session is gone or over: start a new verification. */
  | 'START_AGAIN'
  /** 429 QUOTA_EXCEEDED, TENANT_SUSPENDED: try later. */
  | 'SERVICE_BUSY'
  /** Credentials, SDK token, origin or subject problem: the integrator must fix it. */
  | 'CONFIG'
  /** The SDK token expired: the host must provide a new one. */
  | 'TOKEN_EXPIRED'
  /** 403 FEATURE_NOT_*: hide the feature. */
  | 'FEATURE_UNAVAILABLE'
  /** 502/503/504/network: send the same upload again. */
  | 'RETRY'
  /** 404 NO_ENROLLED_FACE: a face registration (or selfie verification) is needed first. */
  | 'NOT_ENROLLED'
  /** 409 FACE_ALREADY_ENROLLED: face registration is not needed (also returned by the challenge request). */
  | 'ALREADY_ENROLLED'
  /** 413: the image is too large. */
  | 'TOO_LARGE'
  | 'UNKNOWN';

/** FACE_AUTH: every session-less selfie flow (face authentication, liveness check, face enrollment). */
export type ErrorContext = 'LIVENESS' | 'DOCUMENT' | 'FACE_AUTH' | 'SCAN' | 'SESSION' | 'CONFIG';

export interface ClassifiedError {
  action: ErrorAction;
  code: string;
  /** Server message (in the requested language) or null when the error has none. */
  message: string | null;
  status: number;
  attemptsRemaining: number | null;
  nextStep: NextStep | null;
  retryable: boolean;
}

const CONFIG_CODES = new Set([
  'CLIENT_AUTH_REQUIRED', 'CLIENT_AUTH_INVALID', 'ORIGIN_NOT_ALLOWED', 'SDK_TOKEN_NOT_ALLOWED',
  'SUBJECT_MISMATCH',
]);
const CHALLENGE_CODES = new Set(['CHALLENGE_REQUIRED', 'CHALLENGE_INVALID', 'CHALLENGE_EXPIRED']);
const RESUME_CODES = new Set(['LIVENESS_ALREADY_DONE', 'ALREADY_VERIFIED', 'SESSION_CLOSED']);
const START_AGAIN_CODES = new Set(['SESSION_EXPIRED', 'SESSION_NOT_FOUND', 'SESSION_TOKEN_INVALID', 'TOO_MANY_ATTEMPTS']);

export function classifyError(err: unknown, context: ErrorContext): ClassifiedError {
  if (!(err instanceof CamtechApiError)) {
    return {
      action: 'UNKNOWN', code: 'UNKNOWN', message: null, status: -1, attemptsRemaining: null, nextStep: null,
      retryable: false,
    };
  }
  const base = {
    code: err.code,
    message: err.code === 'NETWORK_ERROR' || /^HTTP_\d+$/.test(err.code) ? null : err.message || null,
    status: err.status,
    attemptsRemaining: err.attemptsRemaining,
    nextStep: err.nextStep,
    retryable: err.retryable,
  };
  const code = err.code;
  let action: ErrorAction;
  if (err.retryable || code === 'FACE_SERVICE_ERROR' || code === 'FACE_SERVICE_UNAVAILABLE') action = 'RETRY';
  else if (CHALLENGE_CODES.has(code)) action = 'NEW_CHALLENGE';
  else if (err.status === 422 && (context === 'LIVENESS' || context === 'FACE_AUTH')
    && (LIVENESS_CODES as readonly string[]).includes(code)) {
    // Face authentication has no session to run out of: every call can be retaken.
    action = context === 'LIVENESS' && (err.nextStep === 'DONE' || err.attemptsRemaining === 0) ? 'START_AGAIN' : 'RETAKE_LIVENESS';
  } else if (err.status === 422 && context === 'DOCUMENT' && (DOCUMENT_CODES as readonly string[]).includes(code)) {
    action = err.nextStep === 'DONE' || err.attemptsRemaining === 0 ? 'START_AGAIN' : 'RESCAN_DOCUMENT';
  } else if (err.status === 422 && err.nextStep === 'LIVENESS') action = 'RETAKE_LIVENESS';
  else if (err.status === 422 && err.nextStep === 'DOCUMENT') action = 'RESCAN_DOCUMENT';
  else if (code === 'LIVENESS_REQUIRED') action = 'GO_TO_LIVENESS';
  else if (RESUME_CODES.has(code)) action = 'RESUME';
  else if (START_AGAIN_CODES.has(code)) action = 'START_AGAIN';
  else if (code === 'QUOTA_EXCEEDED' || code === 'TENANT_SUSPENDED') action = 'SERVICE_BUSY';
  else if (code === 'SDK_TOKEN_EXPIRED' || code === 'SDK_TOKEN_INVALID') action = 'TOKEN_EXPIRED';
  else if (CONFIG_CODES.has(code)) action = 'CONFIG';
  else if (code === 'FEATURE_NOT_ENABLED' || code === 'FEATURE_NOT_ALLOWED') action = 'FEATURE_UNAVAILABLE';
  else if (code === 'NO_ENROLLED_FACE') action = 'NOT_ENROLLED';
  else if (code === 'FACE_ALREADY_ENROLLED') action = 'ALREADY_ENROLLED';
  else if (code === 'FILE_TOO_LARGE' || err.status === 413) action = 'TOO_LARGE';
  else if (err.status === 422 && context === 'LIVENESS') action = 'RETAKE_LIVENESS';
  else if (err.status === 422 && context === 'DOCUMENT') action = 'RESCAN_DOCUMENT';
  else action = 'UNKNOWN';
  return { action, ...base };
}

/** Errors that end the whole journey (the host must change something). */
export function isFatal(action: ErrorAction): boolean {
  return action === 'CONFIG' || action === 'TOKEN_EXPIRED';
}

import { describe, expect, it } from 'vitest';
import { CamtechApiError, type Capabilities, type FlowCapability } from '@camtech/api-client';
import { classifyError } from './errors';
import { faceChallengeTarget, faceOutcome, isFaceFlow } from './face-flow';
import { EMPTY_FIELDS } from './fields';
import {
  challengeRequest, challengeRequired, initialJourney, journeyReducer, livenessMode, planJourney, scanTypesFor, idDocumentsFor, currentFlow,
  uploadAllowed, willEnrollFace,
} from './journey';
import { withRetry } from './retry';
import { initialSelfieState, selfieReducer, type SelfieEvent, type SelfieState } from './selfie-flow';

const flow = (code: string, documents: string[] = [], upload = false): FlowCapability => ({
  code, documents, steps: [],
  settings: { livenessMaxAttempts: 5, documentMaxAttempts: 3, sessionTtlMinutes: 15, deviceAntispoofRequired: false, fileUploadAllowed: upload },
  quota: { perDay: null, remainingToday: null },
});
const caps = (...flows: FlowCapability[]): Capabilities => ({ tenant: 'T', clientApp: 'A', channel: 'WEB', flows, features: [], locales: ['en', 'ar'] });

describe('planJourney', () => {
  it('keeps the requested order and drops flows the app may not use', () => {
    const c = caps(flow('DOCUMENT_SCAN'), flow('SELFIE_ID_VERIFICATION'));
    const p = planJourney(['SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION', 'DOCUMENT_SCAN'], c, 'u1');
    expect(p.flows).toEqual(['SELFIE_ID_VERIFICATION', 'DOCUMENT_SCAN']);
    expect(p.skipped).toEqual([{ flow: 'FACE_AUTHENTICATION', reason: 'NOT_ALLOWED' }]);
  });

  it('needs a subjectRef for face authentication', () => {
    const p = planJourney(['FACE_AUTHENTICATION'], caps(flow('FACE_AUTHENTICATION')), null);
    expect(p.flows).toEqual([]);
    expect(p.skipped[0].reason).toBe('SUBJECT_REQUIRED');
  });

  it('needs a subjectRef for face enrollment but not for the liveness check', () => {
    const c = caps(flow('LIVENESS_CHECK'), flow('FACE_ENROLLMENT'));
    const p = planJourney(['FACE_ENROLLMENT', 'LIVENESS_CHECK'], c, null);
    expect(p.flows).toEqual(['LIVENESS_CHECK']);
    expect(p.skipped).toEqual([{ flow: 'FACE_ENROLLMENT', reason: 'SUBJECT_REQUIRED' }]);
    expect(planJourney(['FACE_ENROLLMENT', 'FACE_AUTHENTICATION'], caps(flow('FACE_ENROLLMENT')), 'u1')).toEqual({
      flows: ['FACE_ENROLLMENT'], skipped: [{ flow: 'FACE_AUTHENTICATION', reason: 'NOT_ALLOWED' }],
    });
  });

  it('tells whether a selfie verification registers the face', () => {
    const selfie = (available?: boolean): FlowCapability => {
      const f = flow('SELFIE_ID_VERIFICATION');
      return { ...f, settings: { ...f.settings, faceEnrollmentAvailable: available } };
    };
    expect(willEnrollFace(caps(selfie(true)), null)).toBe(true);
    expect(willEnrollFace(caps(selfie(true)), false)).toBe(false);
    expect(willEnrollFace(caps(selfie(false)), true)).toBe(true);
    expect(willEnrollFace(caps(selfie()), null)).toBe(false);
    expect(willEnrollFace(null, null)).toBe(false);
  });

  it('keeps everything without capabilities and removes duplicates', () => {
    expect(planJourney(['DOCUMENT_SCAN', 'DOCUMENT_SCAN'], null, null).flows).toEqual(['DOCUMENT_SCAN']);
  });

  it('filters documents and upload permission from capabilities', () => {
    const c = caps(flow('SELFIE_ID_VERIFICATION', ['PASSPORT'], true), flow('DOCUMENT_SCAN', ['EMIRATES_ID_FRONT', 'TRADE_LICENCE']));
    expect(idDocumentsFor(c)).toEqual(['PASSPORT']);
    expect(idDocumentsFor(null)).toEqual(['EMIRATES_ID', 'PASSPORT']);
    expect(scanTypesFor(c, ['EMIRATES_ID', 'PASSPORT', 'TRADE_LICENCE'])).toEqual(['EMIRATES_ID', 'TRADE_LICENCE']);
    expect(uploadAllowed(c, 'SELFIE_ID_VERIFICATION')).toBe(true);
    expect(uploadAllowed(c, 'DOCUMENT_SCAN')).toBe(false);
    expect(uploadAllowed(null, 'DOCUMENT_SCAN')).toBe(false);
  });
});

describe('liveness mode', () => {
  const withMode = (code: string, settings: Partial<FlowCapability['settings']>): FlowCapability => {
    const f = flow(code);
    return { ...f, settings: { ...f.settings, ...settings } };
  };

  it('requests a challenge with every supported action in ACTIVE mode', () => {
    const c = caps(withMode('SELFIE_ID_VERIFICATION', { livenessMode: 'ACTIVE', livenessChallengeRequired: true }));
    expect(livenessMode(c, 'SELFIE_ID_VERIFICATION')).toBe('ACTIVE');
    expect(challengeRequired(c, 'SELFIE_ID_VERIFICATION')).toBe(true);
    const body = challengeRequest(c, 'SELFIE_ID_VERIFICATION', { sessionId: 's1' });
    expect(body).toEqual({ sessionId: 's1', supportedActions: ['TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'LOOK_UP', 'LOOK_DOWN', 'SMILE', 'MOVE_CLOSER'] });
  });

  it('skips the challenge entirely in PASSIVE mode', () => {
    const c = caps(withMode('FACE_AUTHENTICATION', { livenessMode: 'PASSIVE', livenessChallengeRequired: false }));
    expect(livenessMode(c, 'FACE_AUTHENTICATION')).toBe('PASSIVE');
    expect(challengeRequest(c, 'FACE_AUTHENTICATION', { subjectRef: 'u1' })).toBeNull();
  });

  it('binds session-less challenges to their flow (face authentication keeps the old body)', () => {
    expect(challengeRequest(null, 'FACE_AUTHENTICATION', faceChallengeTarget('FACE_AUTHENTICATION', 'u1')))
      .toEqual({ subjectRef: 'u1', supportedActions: expect.any(Array) });
    expect(challengeRequest(null, 'FACE_ENROLLMENT', faceChallengeTarget('FACE_ENROLLMENT', 'u1')))
      .toMatchObject({ subjectRef: 'u1', flow: 'FACE_ENROLLMENT' });
    expect(faceChallengeTarget('LIVENESS_CHECK', null)).toEqual({ flow: 'LIVENESS_CHECK' });
    expect(faceChallengeTarget('LIVENESS_CHECK', 'u1')).toEqual({ subjectRef: 'u1', flow: 'LIVENESS_CHECK' });
    const c = caps(withMode('LIVENESS_CHECK', { livenessMode: 'PASSIVE' }));
    expect(challengeRequest(c, 'LIVENESS_CHECK', faceChallengeTarget('LIVENESS_CHECK', null))).toBeNull();
  });

  it('assumes ACTIVE when the server does not say (older server, no capabilities)', () => {
    expect(livenessMode(null, 'FACE_AUTHENTICATION')).toBe('ACTIVE');
    expect(livenessMode(caps(flow('FACE_AUTHENTICATION')), 'FACE_AUTHENTICATION')).toBe('ACTIVE');
    expect(challengeRequest(null, 'FACE_AUTHENTICATION', { subjectRef: 'u1' })?.supportedActions).toHaveLength(7);
  });
});

describe('session-less selfie flows', () => {
  it('recognises the flows and their outcomes', () => {
    expect(['FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'FACE_ENROLLMENT'].every((f) => isFaceFlow(f as never))).toBe(true);
    expect(isFaceFlow('SELFIE_ID_VERIFICATION')).toBe(false);
    expect(isFaceFlow(null)).toBe(false);
    expect(faceOutcome({ decision: 'APPROVED', reasonCode: null })).toBe('approved');
    expect(faceOutcome({ decision: 'REVIEW', reasonCode: 'DUPLICATE_IDENTITY' })).toBe('review');
    expect(faceOutcome({ decision: 'REJECTED', reasonCode: 'DUPLICATE_IDENTITY' })).toBe('duplicate');
    expect(faceOutcome({ decision: 'REJECTED', reasonCode: 'TOO_DARK' })).toBe('rejected');
  });
});

describe('journeyReducer', () => {
  it('runs the flows in order and collects results', () => {
    let s = initialJourney(['SELFIE_ID_VERIFICATION', 'DOCUMENT_SCAN']);
    expect(currentFlow(s)).toBe('SELFIE_ID_VERIFICATION');
    s = journeyReducer(s, { type: 'FLOW_DONE', result: { flow: 'SELFIE_ID_VERIFICATION', sessionId: 's', status: 'COMPLETED', decision: 'APPROVED', resultToken: 't', resultTokenExpiresAt: null } });
    expect(currentFlow(s)).toBe('DOCUMENT_SCAN');
    s = journeyReducer(s, { type: 'FLOW_DONE', result: null });
    expect(s.status).toBe('complete');
    expect(s.results).toHaveLength(1);
    expect(journeyReducer(s, { type: 'FLOW_DONE', result: null })).toBe(s);
  });

  it('collects the results of the new flows', () => {
    let s = initialJourney(['LIVENESS_CHECK', 'FACE_ENROLLMENT']);
    s = journeyReducer(s, { type: 'FLOW_DONE', result: { flow: 'LIVENESS_CHECK', sessionId: 'a', status: 'COMPLETED', decision: 'APPROVED', resultToken: 't', resultTokenExpiresAt: null } });
    s = journeyReducer(s, { type: 'FLOW_DONE', result: { flow: 'FACE_ENROLLMENT', sessionId: 'b', status: 'COMPLETED', decision: 'REVIEW', resultToken: 't', resultTokenExpiresAt: null } });
    expect(s.status).toBe('complete');
    expect(s.results.map((r) => r.flow)).toEqual(['LIVENESS_CHECK', 'FACE_ENROLLMENT']);
  });

  it('cancels only a running journey and can be reset', () => {
    const s = journeyReducer(initialJourney(['DOCUMENT_SCAN']), { type: 'CANCEL' });
    expect(s.status).toBe('cancelled');
    expect(currentFlow(s)).toBeNull();
    expect(journeyReducer(s, { type: 'RESET', flows: ['DOCUMENT_SCAN'] }).status).toBe('running');
    expect(initialJourney([]).status).toBe('complete');
  });
});

describe('selfieReducer', () => {
  const blob = new Blob(['x']);
  const run = (s: SelfieState, ...events: SelfieEvent[]) => events.reduce(selfieReducer, s);
  const session = { sessionId: 's1', expiresAt: '2030-01-01T00:00:00Z' };

  it('walks the happy path', () => {
    let s = initialSelfieState(null, ['EMIRATES_ID', 'PASSPORT']);
    s = run(s, { type: 'NO_RESUME' }, { type: 'START' });
    expect(s.screen.name).toBe('starting');
    s = run(s, { type: 'STARTED', session }, { type: 'CAMERA_READY' });
    expect(s.screen).toEqual({ name: 'liveness', notice: null });
    s = run(s, { type: 'LIVENESS_CAPTURED', normal: blob, challenge: null }, { type: 'LIVENESS_PASSED', nextStep: 'DOCUMENT' });
    expect(s.screen.name).toBe('docChoice');
    s = run(s, { type: 'DOC_CHOSEN', documentType: 'PASSPORT' }, { type: 'DOC_CAPTURED', image: blob });
    expect(s.screen).toMatchObject({ name: 'docReading', documentType: 'PASSPORT' });
    s = run(s, { type: 'DOC_READ', fields: EMPTY_FIELDS, ocrFailed: true });
    expect(s.screen).toMatchObject({ name: 'docConfirm', ocrFailed: true });
    s = run(s, { type: 'DOC_SUBMIT', fields: { ...EMPTY_FIELDS, documentNumber: 'A1' } });
    expect(s.screen).toMatchObject({ name: 'docUpload', fields: { documentNumber: 'A1' } });
    s = run(s, { type: 'DOC_DONE', message: 'Your face matches' }, { type: 'RESULT', decision: 'APPROVED' });
    expect(s.screen).toEqual({ name: 'result', decision: 'APPROVED', message: 'Your face matches' });
  });

  it('skips the document choice when the type is fixed', () => {
    let s = initialSelfieState('EMIRATES_ID', ['EMIRATES_ID', 'PASSPORT']);
    expect(s.fixedDocument).toBe(true);
    s = run(s, { type: 'NO_RESUME' }, { type: 'START' }, { type: 'STARTED', session }, { type: 'CAMERA_READY' },
      { type: 'LIVENESS_CAPTURED', normal: blob, challenge: null }, { type: 'LIVENESS_PASSED', nextStep: 'DOCUMENT' });
    expect(s.screen).toEqual({ name: 'docCapture', documentType: 'EMIRATES_ID' });
    expect(selfieReducer(s, { type: 'CHOOSE_DOCUMENT' })).toBe(s);
    expect(initialSelfieState(null, ['PASSPORT']).documentType).toBe('PASSPORT');
  });

  it('captures the back of an Emirates ID after the front and keeps both images', () => {
    const front = new Blob(['front']);
    const back = new Blob(['back']);
    let s = run(initialSelfieState('EMIRATES_ID', ['EMIRATES_ID', 'PASSPORT']), { type: 'NO_RESUME' }, { type: 'START' }, { type: 'STARTED', session },
      { type: 'CAMERA_READY' }, { type: 'LIVENESS_CAPTURED', normal: blob, challenge: null }, { type: 'LIVENESS_PASSED', nextStep: 'DOCUMENT' });
    s = selfieReducer(s, { type: 'DOC_CAPTURED', image: front });
    expect(s.screen).toEqual({ name: 'docCaptureBack', documentType: 'EMIRATES_ID', image: front });
    s = selfieReducer(s, { type: 'DOC_CAPTURED', image: back });
    expect(s.screen).toEqual({ name: 'docReading', documentType: 'EMIRATES_ID', image: front, back });
    s = selfieReducer(s, { type: 'DOC_READ', fields: EMPTY_FIELDS, ocrFailed: false });
    expect(s.screen).toMatchObject({ name: 'docConfirm', image: front, back });
    s = selfieReducer(s, { type: 'DOC_SUBMIT', fields: EMPTY_FIELDS });
    expect(s.screen).toMatchObject({ name: 'docUpload', image: front, back });
    s = selfieReducer(s, { type: 'DOC_EDIT' });
    expect(s.screen).toMatchObject({ name: 'docConfirm', image: front, back });
    // Retake restarts from the front.
    expect(selfieReducer(s, { type: 'RESCAN' }).screen).toEqual({ name: 'docCapture', documentType: 'EMIRATES_ID' });
    expect(selfieReducer({ ...s, screen: { name: 'docCaptureBack', documentType: 'EMIRATES_ID', image: front } }, { type: 'RESCAN' }).screen)
      .toEqual({ name: 'docCapture', documentType: 'EMIRATES_ID' });
  });

  it('captures only one side of a passport', () => {
    let s = run(initialSelfieState('PASSPORT', ['PASSPORT']), { type: 'NO_RESUME' }, { type: 'START' }, { type: 'STARTED', session },
      { type: 'CAMERA_READY' }, { type: 'LIVENESS_CAPTURED', normal: blob, challenge: null }, { type: 'LIVENESS_PASSED', nextStep: 'DOCUMENT' });
    s = selfieReducer(s, { type: 'DOC_CAPTURED', image: blob });
    expect(s.screen).toEqual({ name: 'docReading', documentType: 'PASSPORT', image: blob, back: null });
  });

  it('retakes the selfies and rescans the document with the server notice', () => {
    let s = run(initialSelfieState('PASSPORT', ['PASSPORT']), { type: 'NO_RESUME' }, { type: 'START' }, { type: 'STARTED', session },
      { type: 'CAMERA_READY' }, { type: 'LIVENESS_CAPTURED', normal: blob, challenge: null });
    s = selfieReducer(s, { type: 'LIVENESS_RETAKE', notice: { code: 'TOO_DARK', message: 'Too dark', attemptsRemaining: 3 } });
    expect(s.screen).toMatchObject({ name: 'liveness', notice: { code: 'TOO_DARK', attemptsRemaining: 3 } });
    s = run(s, { type: 'LIVENESS_CAPTURED', normal: blob, challenge: null }, { type: 'LIVENESS_PASSED', nextStep: 'DOCUMENT' },
      { type: 'DOC_CAPTURED', image: blob }, { type: 'DOC_READ', fields: EMPTY_FIELDS, ocrFailed: false }, { type: 'DOC_SUBMIT', fields: EMPTY_FIELDS });
    s = selfieReducer(s, { type: 'DOC_RESCAN', notice: { code: 'FACE_MISMATCH', message: 'No match', attemptsRemaining: 2 } });
    expect(s.screen).toMatchObject({ name: 'docRescan', documentType: 'PASSPORT', notice: { attemptsRemaining: 2 } });
    s = selfieReducer(s, { type: 'RESCAN' });
    expect(s.screen).toEqual({ name: 'docCapture', documentType: 'PASSPORT' });
  });

  it('resumes from the server nextStep', () => {
    const base = initialSelfieState(null, ['EMIRATES_ID', 'PASSPORT']);
    expect(selfieReducer(base, { type: 'RESUMED', session, nextStep: 'DOCUMENT', documentType: 'PASSPORT', skipWelcome: true }).screen)
      .toEqual({ name: 'docCapture', documentType: 'PASSPORT' });
    expect(selfieReducer(base, { type: 'RESUMED', session, nextStep: 'LIVENESS', documentType: null, skipWelcome: true }).screen.name).toBe('primer');
    expect(selfieReducer(base, { type: 'RESUMED', session, nextStep: 'DONE', documentType: null, skipWelcome: false }).screen.name).toBe('finishing');
    const welcome = selfieReducer(base, { type: 'RESUMED', session, nextStep: 'LIVENESS', documentType: null, skipWelcome: false });
    expect(welcome.screen.name).toBe('welcome');
    expect(selfieReducer(welcome, { type: 'START' }).screen.name).toBe('primer');
  });

  it('routes decisions and restarts', () => {
    const s = { ...initialSelfieState(null, ['EMIRATES_ID', 'PASSPORT']), session };
    expect(selfieReducer(s, { type: 'RESULT', decision: 'REVIEW' }).screen.name).toBe('review');
    expect(selfieReducer(s, { type: 'RESULT', decision: 'REJECTED', message: 'No' }).screen).toEqual({ name: 'result', decision: 'REJECTED', message: 'No' });
    expect(selfieReducer(s, { type: 'RESULT', decision: null }).screen).toMatchObject({ name: 'over', reason: 'FAILED' });
    const restarted = selfieReducer({ ...s, documentType: 'PASSPORT' }, { type: 'RESTART' });
    expect(restarted.session).toBeNull();
    expect(restarted.documentType).toBeNull();
    expect(restarted.screen.name).toBe('starting');
  });

  it('ignores events that do not fit the current screen', () => {
    const s = initialSelfieState(null, ['EMIRATES_ID']);
    expect(selfieReducer(s, { type: 'DOC_CAPTURED', image: blob })).toBe(s);
    expect(selfieReducer(s, { type: 'LIVENESS_CAPTURED', normal: blob, challenge: null })).toBe(s);
  });
});

describe('classifyError (guide §5)', () => {
  const err = (status: number, code: string, extra: { attemptsRemaining?: number; nextStep?: 'LIVENESS' | 'DOCUMENT' | 'DONE' } = {}) =>
    new CamtechApiError(status, { code, message: `msg ${code}`, ...extra });

  it.each([
    [err(422, 'TOO_DARK', { attemptsRemaining: 3, nextStep: 'LIVENESS' }), 'LIVENESS', 'RETAKE_LIVENESS'],
    [err(422, 'NOT_CLOSER', { attemptsRemaining: 0, nextStep: 'DONE' }), 'LIVENESS', 'START_AGAIN'],
    [err(422, 'ID_EXPIRED', { attemptsRemaining: 2, nextStep: 'DOCUMENT' }), 'DOCUMENT', 'RESCAN_DOCUMENT'],
    [err(422, 'NO_FACE', { attemptsRemaining: 1, nextStep: 'DOCUMENT' }), 'DOCUMENT', 'RESCAN_DOCUMENT'],
    [err(422, 'NO_FACE', { attemptsRemaining: 1, nextStep: 'LIVENESS' }), 'LIVENESS', 'RETAKE_LIVENESS'],
    [err(409, 'LIVENESS_REQUIRED'), 'DOCUMENT', 'GO_TO_LIVENESS'],
    [err(409, 'ALREADY_VERIFIED'), 'DOCUMENT', 'RESUME'],
    [err(409, 'SESSION_CLOSED'), 'LIVENESS', 'RESUME'],
    [err(410, 'SESSION_EXPIRED'), 'DOCUMENT', 'START_AGAIN'],
    [err(404, 'SESSION_NOT_FOUND'), 'SESSION', 'START_AGAIN'],
    [err(401, 'SESSION_TOKEN_INVALID'), 'SESSION', 'START_AGAIN'],
    [err(429, 'TOO_MANY_ATTEMPTS'), 'LIVENESS', 'START_AGAIN'],
    [err(429, 'QUOTA_EXCEEDED'), 'SESSION', 'SERVICE_BUSY'],
    [err(401, 'CLIENT_AUTH_INVALID'), 'CONFIG', 'CONFIG'],
    [err(403, 'ORIGIN_NOT_ALLOWED'), 'CONFIG', 'CONFIG'],
    [err(403, 'SUBJECT_MISMATCH'), 'FACE_AUTH', 'CONFIG'],
    [err(401, 'SDK_TOKEN_EXPIRED'), 'CONFIG', 'TOKEN_EXPIRED'],
    [err(401, 'SDK_TOKEN_INVALID'), 'SESSION', 'TOKEN_EXPIRED'],
    [err(403, 'SDK_TOKEN_NOT_ALLOWED'), 'CONFIG', 'CONFIG'],
    [err(403, 'FEATURE_NOT_ALLOWED'), 'SCAN', 'FEATURE_UNAVAILABLE'],
    [err(403, 'TENANT_SUSPENDED'), 'CONFIG', 'SERVICE_BUSY'],
    [err(413, 'FILE_TOO_LARGE'), 'LIVENESS', 'TOO_LARGE'],
    [err(503, 'FACE_SERVICE_UNAVAILABLE'), 'LIVENESS', 'RETRY'],
    [err(502, 'FACE_SERVICE_ERROR'), 'DOCUMENT', 'RETRY'],
    [err(0, 'NETWORK_ERROR'), 'DOCUMENT', 'RETRY'],
    [err(404, 'NO_ENROLLED_FACE'), 'FACE_AUTH', 'NOT_ENROLLED'],
    [err(409, 'FACE_ALREADY_ENROLLED'), 'FACE_AUTH', 'ALREADY_ENROLLED'],
    [err(409, 'FACE_ALREADY_ENROLLED'), 'LIVENESS', 'ALREADY_ENROLLED'],
    [err(500, 'INTERNAL'), 'SESSION', 'UNKNOWN'],
    [err(400, 'CHALLENGE_REQUIRED'), 'LIVENESS', 'NEW_CHALLENGE'],
    [err(409, 'CHALLENGE_INVALID'), 'FACE_AUTH', 'NEW_CHALLENGE'],
    [err(409, 'CHALLENGE_EXPIRED'), 'LIVENESS', 'NEW_CHALLENGE'],
    [err(422, 'CHALLENGE_FAILED', { attemptsRemaining: 2, nextStep: 'LIVENESS' }), 'LIVENESS', 'RETAKE_LIVENESS'],
    [err(422, 'CHALLENGE_FAILED', { attemptsRemaining: 0, nextStep: 'DONE' }), 'LIVENESS', 'START_AGAIN'],
    [err(503, 'LIVENESS_UNAVAILABLE'), 'LIVENESS', 'RETRY'],
    [err(422, 'CHALLENGE_FAILED', { attemptsRemaining: 0, nextStep: 'DONE' }), 'FACE_AUTH', 'RETAKE_LIVENESS'],
    [err(422, 'FACE_NOT_VISIBLE', { attemptsRemaining: 2, nextStep: 'LIVENESS' }), 'LIVENESS', 'RETAKE_LIVENESS'],
    [err(422, 'FACE_NOT_VISIBLE', { attemptsRemaining: 0, nextStep: 'DONE' }), 'LIVENESS', 'START_AGAIN'],
    [err(422, 'FACE_NOT_VISIBLE'), 'FACE_AUTH', 'RETAKE_LIVENESS'],
  ] as const)('%#: %o in %s → %s', (e, context, action) => {
    expect(classifyError(e, context).action).toBe(action);
  });

  it('never shows generic transport messages as server messages', () => {
    expect(classifyError(err(0, 'NETWORK_ERROR'), 'SESSION').message).toBeNull();
    expect(classifyError(new CamtechApiError(500, { code: 'HTTP_500', message: 'Request failed (500)' }), 'SESSION').message).toBeNull();
    expect(classifyError(err(422, 'TOO_DARK'), 'LIVENESS').message).toBe('msg TOO_DARK');
    expect(classifyError(new Error('x'), 'SESSION').action).toBe('UNKNOWN');
  });
});

describe('withRetry', () => {
  const noSleep = () => Promise.resolve();

  it('retries retryable errors twice, then throws', async () => {
    let calls = 0;
    const retries: number[] = [];
    await expect(withRetry(async () => {
      calls++;
      throw new CamtechApiError(503, { code: 'FACE_SERVICE_UNAVAILABLE', message: 'busy' });
    }, { sleep: noSleep, onRetry: (n) => retries.push(n) })).rejects.toMatchObject({ code: 'FACE_SERVICE_UNAVAILABLE' });
    expect(calls).toBe(3);
    expect(retries).toEqual([1, 2]);
  });

  it('succeeds after a transient failure and never retries other errors', async () => {
    let calls = 0;
    await expect(withRetry(async () => {
      calls++;
      if (calls === 1) throw new CamtechApiError(0, { code: 'NETWORK_ERROR', message: 'x' });
      return 'ok';
    }, { sleep: noSleep })).resolves.toBe('ok');
    calls = 0;
    await expect(withRetry(async () => {
      calls++;
      throw new CamtechApiError(422, { code: 'TOO_DARK', message: 'x' });
    }, { sleep: noSleep })).rejects.toMatchObject({ code: 'TOO_DARK' });
    expect(calls).toBe(1);
  });
});

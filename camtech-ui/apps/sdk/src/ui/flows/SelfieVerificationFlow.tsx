// Selfie ID verification: welcome → selfies → document → confirm details → match → result.
import { useCallback, useEffect, useMemo, useReducer, useState, type ReactElement } from 'react';
import type { DocumentResponse, DocumentScanResponse, IdDocumentType, LivenessResponse, SessionResult, SessionState } from '@camtech/api-client';
import { requestMotionPermission } from '@camtech/capture-core';
import { classifyError, isFatal, type ClassifiedError } from '../../core/errors';
import { cleanDocFields } from '../../core/doc-form';
import { EMPTY_FIELDS, prefillFromScans, type ScanSide } from '../../core/fields';
import { buildReview, toDocFields, validateReview, withRequired, type ScannedSide } from '../../core/scan-review';
import { challengeRequest, challengeRequired, idDocumentsFor, uploadAllowed, willEnrollFace } from '../../core/journey';
import type { StepName, VerificationResult } from '../../core/protocol';
import { withRetry } from '../../core/retry';
import { hasBack, initialSelfieState, selfieReducer, type Notice, type OverReason, type SelfieEvent, type SelfieScreen } from '../../core/selfie-flow';
import { clearSession, loadSession, saveSession, updateSession } from '../../core/session-store';
import { preloadFaceTracker } from '../capture/vision';
import { SessionTimer } from '../components/session';
import { useSdk, useStep } from '../context';
import { DocumentCaptureScreen, LivenessScreen } from '../screens/capture';
import {
  documentTips, ErrorScreen, LoadingScreen, NoticeScreen, ResultScreen, SelfiePrimerScreen, UploadStep, WelcomeScreen,
} from '../screens/common';
import { ChoiceScreen, ConfirmDetailsScreen, docIcon } from '../screens/documents';
import { ScanReviewScreen } from '../screens/scan-review';
import { UnderReviewScreen } from '../screens/review';

const STEP: Record<SelfieScreen['name'], StepName> = {
  init: 'LOADING', welcome: 'WELCOME', starting: 'LOADING', primer: 'CAMERA_PERMISSION', liveness: 'LIVENESS',
  livenessUpload: 'LIVENESS_UPLOAD', docChoice: 'DOCUMENT_CHOICE', docCapture: 'DOCUMENT_CAPTURE', docCaptureBack: 'DOCUMENT_CAPTURE', docReading: 'DOCUMENT_READING',
  docConfirm: 'DOCUMENT_CONFIRM', docUpload: 'DOCUMENT_UPLOAD', docRescan: 'DOCUMENT_RESCAN', finishing: 'LOADING',
  review: 'UNDER_REVIEW', result: 'RESULT', over: 'RESULT',
};

/** Screens during which the session timer runs and cancel calls the server. */
const ACTIVE = new Set<SelfieScreen['name']>(['primer', 'liveness', 'livenessUpload', 'docChoice', 'docCapture', 'docCaptureBack', 'docReading',
  'docConfirm', 'docUpload', 'docRescan', 'welcome']);

function overReasonFor(c: ClassifiedError): OverReason {
  if (c.code === 'SESSION_EXPIRED') return 'EXPIRED';
  if (c.code === 'TOO_MANY_ATTEMPTS' || c.status === 422) return 'ATTEMPTS';
  return 'SESSION';
}

function overReasonForStatus(s: SessionState['status']): OverReason {
  if (s === 'EXPIRED') return 'EXPIRED';
  if (s === 'CANCELLED') return 'CANCELLED';
  if (s === 'FAILED') return 'ATTEMPTS';
  return 'SESSION';
}

export interface FlowProps<R> {
  isLast: boolean;
  onDone: (result: R | null) => void;
}

export function SelfieVerificationFlow({ isLast, onDone }: FlowProps<VerificationResult>): ReactElement {
  const sdk = useSdk();
  const { client, config, caps, i18n, setCancelInfo, reportError, setSessionId } = sdk;
  const { t } = i18n;
  const offered = useMemo(() => idDocumentsFor(caps), [caps]);
  const [state, dispatch] = useReducer(selfieReducer, undefined, () =>
    initialSelfieState(config.documentType && offered.includes(config.documentType) ? config.documentType : null, offered));
  const [error, setError] = useState<{ error: ClassifiedError; retry?: () => void } | null>(null);
  const [result, setResult] = useState<SessionResult | null>(null);
  const [attempt, setAttempt] = useState(0);
  const screen = state.screen;
  const session = state.session;
  useStep('SELFIE_ID_VERIFICATION', error ? 'ERROR' : STEP[screen.name]);

  const fail = useCallback((c: ClassifiedError, retry?: () => void) => {
    reportError({ code: c.code, message: c.message ?? c.code, fatal: isFatal(c.action), status: c.status, flow: 'SELFIE_ID_VERIFICATION' });
    setError({ error: c, retry });
  }, [reportError]);

  const send = useCallback((e: SelfieEvent) => {
    setError(null);
    dispatch(e);
  }, []);

  // Cancel → POST /cancel for an open session; the host learns the session id for the return URL.
  useEffect(() => {
    setSessionId(session?.sessionId ?? null);
    if (session && ACTIVE.has(screen.name)) {
      const id = session.sessionId;
      setCancelInfo({ sessionId: id, onCancel: async () => { clearSession(); await client.cancel(id); } });
    } else {
      setCancelInfo(null);
    }
  }, [session, screen.name, client, setCancelInfo, setSessionId]);
  useEffect(() => () => setCancelInfo(null), [setCancelInfo]);

  // Keep the resume record in sync with the step.
  useEffect(() => {
    if (session && ACTIVE.has(screen.name)) updateSession({ step: screen.name, documentType: state.documentType });
  }, [session, screen.name, state.documentType]);

  /** Re-reads the session and continues from the server's nextStep (409 already done / closed). */
  const resync = useCallback(async (sessionId: string) => {
    try {
      const s = await withRetry(() => client.getSession(sessionId));
      if (s.status === 'COMPLETED') send({ type: 'RESULT', decision: s.decision });
      else if (s.status === 'IN_PROGRESS' || s.status === 'CREATED') {
        send({ type: 'RESUMED', session: { sessionId, expiresAt: s.expiresAt }, nextStep: s.nextStep, documentType: s.documentType, skipWelcome: true });
      } else {
        clearSession();
        send({ type: 'OVER', reason: overReasonForStatus(s.status), message: null });
      }
    } catch (e) {
      fail(classifyError(e, 'SESSION'), () => void resync(sessionId));
    }
  }, [client, send, fail]);

  // ---------------------------------------------------------------- init: resume a session if there is one
  useEffect(() => {
    if (screen.name !== 'init') return;
    let cancelled = false;
    const fromConfig = config.sessionId && config.sessionToken ? { sessionId: config.sessionId, sessionToken: config.sessionToken } : null;
    const stored = fromConfig ? null : loadSession();
    const candidate = fromConfig ?? stored;
    if (!candidate) {
      dispatch({ type: 'NO_RESUME' });
      return;
    }
    client.setSessionToken(candidate.sessionToken);
    withRetry(() => client.getSession(candidate.sessionId)).then((s) => {
      if (cancelled) return;
      if (s.status === 'COMPLETED' || s.status === 'IN_PROGRESS' || s.status === 'CREATED') {
        if (fromConfig) saveSession({ ...fromConfig, step: 'init', documentType: s.documentType, expiresAt: s.expiresAt });
        dispatch({
          type: 'RESUMED', session: { sessionId: s.sessionId, expiresAt: s.expiresAt }, nextStep: s.nextStep,
          documentType: s.documentType, skipWelcome: Boolean(stored),
        });
      } else {
        clearSession();
        if (fromConfig) dispatch({ type: 'OVER', reason: overReasonForStatus(s.status), message: null });
        else {
          client.setSessionToken(undefined);
          dispatch({ type: 'NO_RESUME' });
        }
      }
    }, (e: unknown) => {
      if (cancelled) return;
      const c = classifyError(e, 'SESSION');
      if (c.action === 'RETRY' || c.action === 'UNKNOWN') {
        fail(c, () => { setError(null); setAttempt((n) => n + 1); });
        return;
      }
      clearSession();
      if (fromConfig) {
        if (c.action === 'START_AGAIN') dispatch({ type: 'OVER', reason: overReasonFor(c), message: c.message });
        else fail(c);
      } else {
        client.setSessionToken(undefined);
        dispatch({ type: 'NO_RESUME' });
      }
    });
    return () => { cancelled = true; };
  }, [screen.name, attempt, client, config.sessionId, config.sessionToken, fail]);

  // ---------------------------------------------------------------- starting: create a verification
  useEffect(() => {
    if (screen.name !== 'starting') return;
    let cancelled = false;
    client.setSessionToken(undefined);
    withRetry(() => client.startSelfieVerification({
      subjectRef: sdk.subjectRef ?? undefined,
      documentType: state.documentType ?? undefined,
      enrollFace: config.enrollFace ?? undefined,
    })).then((res) => {
      if (cancelled) return;
      saveSession({ sessionId: res.sessionId, sessionToken: res.sessionToken, step: 'primer', documentType: state.documentType, expiresAt: res.expiresAt });
      dispatch({ type: 'STARTED', session: { sessionId: res.sessionId, expiresAt: res.expiresAt } });
    }, (e: unknown) => {
      if (cancelled) return;
      fail(classifyError(e, 'SESSION'), () => { setError(null); setAttempt((n) => n + 1); });
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per entry into "starting" (or retry)
  }, [screen.name, attempt]);

  // ---------------------------------------------------------------- finishing: read the decision and result token
  useEffect(() => {
    if (screen.name !== 'finishing' || !session) return;
    let cancelled = false;
    withRetry(() => client.getResult(session.sessionId)).then((r) => {
      if (cancelled) return;
      setResult(r);
      if (r.decision !== 'REVIEW') clearSession();
      dispatch({ type: 'RESULT', decision: r.decision });
    }, (e: unknown) => {
      if (cancelled) return;
      fail(classifyError(e, 'SESSION'), () => { setError(null); setAttempt((n) => n + 1); });
    });
    return () => { cancelled = true; };
  }, [screen.name, session, client, attempt, fail]);

  useEffect(() => {
    if (screen.name === 'primer') preloadFaceTracker(config.vision);
  }, [screen.name, config.vision]);

  useEffect(() => {
    if (screen.name === 'over' || screen.name === 'result') clearSession();
  }, [screen.name]);

  const entry = (): VerificationResult | null => {
    if (!session) return null;
    return {
      flow: 'SELFIE_ID_VERIFICATION',
      sessionId: session.sessionId,
      status: result?.status ?? (screen.name === 'over' ? 'FAILED' : 'IN_PROGRESS'),
      decision: result?.decision ?? null,
      resultToken: result?.resultToken ?? null,
      resultTokenExpiresAt: result?.resultTokenExpiresAt ?? null,
    };
  };
  const finish = () => onDone(entry());
  const doneLabel = t(isLast ? 'done' : 'continue');

  const onExpire = useCallback(() => {
    clearSession();
    dispatch({ type: 'OVER', reason: 'EXPIRED', message: null });
  }, []);

  const timer = session?.expiresAt && ACTIVE.has(screen.name) && screen.name !== 'welcome'
    ? <SessionTimer expiresAt={session.expiresAt} onExpire={onExpire} />
    : null;

  // ---------------------------------------------------------------- upload outcomes
  const onLivenessFailure = (c: ClassifiedError) => {
    if (c.action === 'NEW_CHALLENGE') {
      // Challenge expired / unknown: no attempt was used; redo the selfies with a new challenge.
      send({ type: 'LIVENESS_RETAKE', notice: { code: c.code, message: t('challengeRenewed'), attemptsRemaining: null } });
    } else if (c.action === 'RETAKE_LIVENESS' || c.action === 'GO_TO_LIVENESS') {
      send({ type: 'LIVENESS_RETAKE', notice: { code: c.code, message: c.message, attemptsRemaining: c.attemptsRemaining } });
    } else if (c.action === 'START_AGAIN') {
      send({ type: 'OVER', reason: overReasonFor(c), message: c.message });
    } else if (c.action === 'RESUME' && session) {
      void resync(session.sessionId);
    } else if (c.action === 'TOO_LARGE') {
      send({ type: 'LIVENESS_RETAKE', notice: { code: c.code, message: t('tooLargeBody'), attemptsRemaining: null } });
    } else {
      fail(c, () => send({ type: 'LIVENESS_RETAKE', notice: null }));
    }
  };

  const onDocumentResponse = (res: DocumentResponse) => {
    if (res.nextStep === 'DOCUMENT') {
      send({ type: 'DOC_RESCAN', notice: { code: res.reasonCode ?? res.result, message: res.message, attemptsRemaining: res.attemptsRemaining } });
    } else if (res.nextStep === 'LIVENESS') {
      send({ type: 'LIVENESS_RETAKE', notice: { code: res.reasonCode ?? 'LIVENESS_REQUIRED', message: res.message, attemptsRemaining: null } });
    } else {
      send({ type: 'DOC_DONE', message: res.message });
    }
  };

  const onDocumentFailure = (c: ClassifiedError) => {
    const notice: Notice = { code: c.code, message: c.message, attemptsRemaining: c.attemptsRemaining };
    if (c.action === 'RESCAN_DOCUMENT' || c.action === 'TOO_LARGE') send({ type: 'DOC_RESCAN', notice });
    else if (c.action === 'GO_TO_LIVENESS' || c.action === 'RETAKE_LIVENESS') send({ type: 'LIVENESS_RETAKE', notice });
    else if (c.action === 'START_AGAIN') send({ type: 'OVER', reason: overReasonFor(c), message: c.message });
    else if (c.action === 'RESUME' && session) void resync(session.sessionId);
    else fail(c, () => send({ type: 'DOC_EDIT' }));
  };

  // ---------------------------------------------------------------- render
  if (error) {
    const a = error.error.action;
    const canRestart = a === 'START_AGAIN' || a === 'UNKNOWN' || a === 'RETRY';
    return (
      <ErrorScreen error={error.error}
                   onRetry={error.retry && a !== 'CONFIG' && a !== 'TOKEN_EXPIRED' && a !== 'FEATURE_UNAVAILABLE' ? error.retry : undefined}
                   onStartAgain={canRestart && session ? () => send({ type: 'RESTART' }) : undefined}
                   onClose={isFatal(a) || a === 'FEATURE_UNAVAILABLE' || a === 'SERVICE_BUSY' ? finish : undefined} />
    );
  }

  const body = (() => {
    switch (screen.name) {
      case 'init':
      case 'starting':
      case 'finishing':
        return <LoadingScreen />;
      case 'welcome':
        return (
          <WelcomeScreen needs={willEnrollFace(caps, config.enrollFace) ? ['selfie', 'idDocument', 'faceRegistration'] : ['selfie', 'idDocument']}
                         onStart={() => send({ type: 'START' })} />
        );
      case 'primer':
        return (
          <SelfiePrimerScreen onContinue={() => {
            // iOS asks for motion access only from a tap; the answer does not block the flow.
            void requestMotionPermission();
            send({ type: 'CAMERA_READY' });
          }} />
        );
      case 'liveness':
        return (
          <LivenessScreen notice={screen.notice} challengeRequired={challengeRequired(caps, 'SELFIE_ID_VERIFICATION')}
                          challengeRequest={challengeRequest(caps, 'SELFIE_ID_VERIFICATION', { sessionId: session?.sessionId ?? '' })}
                          loadChallenge={(body) => client.createLivenessChallenge(body)}
                          onCaptured={(normal, challenge) => send({ type: 'LIVENESS_CAPTURED', normal, challenge })} />
        );
      case 'livenessUpload': {
        const id = session?.sessionId ?? '';
        return (
          <UploadStep<LivenessResponse> title={t('uploadingLiveness')} context="LIVENESS"
                                        run={(signal) => client.submitLiveness(id, screen.normal, null, undefined, signal, screen.challenge ?? undefined)}
                                        onSuccess={(r) => send({ type: 'LIVENESS_PASSED', nextStep: r.nextStep })}
                                        onFailure={onLivenessFailure} />
        );
      }
      case 'docChoice':
        return (
          <ChoiceScreen<IdDocumentType> title={t('docChoiceTitle')} lead={t('docChoiceBody')}
                                        options={offered.map((d) => ({
                                          value: d, label: t(`doc_${d}`), icon: docIcon(d),
                                          description: d === 'EMIRATES_ID' && hasBack(d) ? t('scanDoc_EMIRATES_ID_desc') : t(`doc_${d}_desc`),
                                        }))}
                                        onChoose={(d) => send({ type: 'DOC_CHOSEN', documentType: d })} />
        );
      case 'docCapture':
        return (
          <DocumentCaptureScreen key={`cap-${screen.documentType}`} documentType={screen.documentType}
                                 sub={hasBack(screen.documentType) ? t('sideOf', { n: 1 }) : undefined}
                                 uploadAllowed={uploadAllowed(caps, 'SELFIE_ID_VERIFICATION')}
                                 onCaptured={(image) => send({ type: 'DOC_CAPTURED', image })} />
        );
      case 'docCaptureBack':
        return (
          <DocumentCaptureScreen key="cap-back" documentType="EMIRATES_ID_BACK" sub={t('sideOf', { n: 2 })}
                                 uploadAllowed={uploadAllowed(caps, 'SELFIE_ID_VERIFICATION')}
                                 onCaptured={(image) => send({ type: 'DOC_CAPTURED', image })} />
        );
      case 'docReading':
        return (
          <UploadStep<{ front: ScanSide | null; back: ScanSide | null; scanned: ScannedSide[] }> title={t('readingDocument')} context="SCAN" offerRetry={false}
                      run={async (signal) => {
                        // Both sides in parallel: one side failing (network / OCR) never blocks the other.
                        const back = screen.back;
                        const [f, b] = await Promise.allSettled([
                          client.scanDocument(screen.image, screen.documentType, { store: false }, signal),
                          back ? client.scanDocument(back, 'EMIRATES_ID_BACK', { store: false }, signal) : Promise.resolve(null),
                        ]);
                        if (f.status === 'rejected' && (b.status === 'rejected' || !back)) throw f.reason;
                        const ok = (r: PromiseSettledResult<DocumentScanResponse | null>): DocumentScanResponse | null =>
                          r.status === 'fulfilled' && r.value?.success ? r.value : null;
                        const side = (res: DocumentScanResponse | null): ScanSide | null => (res ? { fields: res.fields, rawText: res.rawText } : null);
                        const front = ok(f);
                        const backRes = ok(b);
                        const scanned: ScannedSide[] = [];
                        if (front) scanned.push({ type: back ? 'EMIRATES_ID_FRONT' : screen.documentType, res: front });
                        if (backRes) scanned.push({ type: 'EMIRATES_ID_BACK', res: backRes });
                        return { front: side(front), back: side(backRes), scanned };
                      }}
                      onSuccess={(r) => {
                        const { fields, ocrFailed } = prefillFromScans(screen.documentType, r.front, r.back);
                        // Nothing usable read: the details are typed in the form instead of reviewed.
                        const review = ocrFailed ? null : { fields: withRequired(screen.documentType, buildReview(r.scanned)), values: {}, edited: [] };
                        if (review) review.values = Object.fromEntries(review.fields.map((x) => [x.key, x.value]));
                        send({ type: 'DOC_READ', fields, ocrFailed, review });
                      }}
                      onFailure={(c) => {
                        if (isFatal(c.action)) fail(c);
                        else send({ type: 'DOC_READ', fields: EMPTY_FIELDS, ocrFailed: true });
                      }} />
        );
      case 'docConfirm':
        if (screen.review) {
          const { documentType, image, back, review } = screen;
          return (
            <ScanReviewScreen title={t(`doc_${documentType}`)} fields={review.fields} initial={review}
                              photos={back ? [{ side: 'EMIRATES_ID_FRONT', image }, { side: 'EMIRATES_ID_BACK', image: back }] : [{ side: documentType, image }]}
                              validate={(values) => validateReview(documentType, values)}
                              confirmLabel={t('confirmSubmit')} rescanLabel={t('retakePhoto')}
                              onRescan={() => send({ type: 'RESCAN' })}
                              onConfirm={(values, edited) => send({
                                type: 'DOC_SUBMIT', fields: cleanDocFields(documentType, toDocFields(documentType, values)),
                                review: { fields: review.fields, values, edited },
                              })} />
          );
        }
        return (
          <ConfirmDetailsScreen documentType={screen.documentType} image={screen.image} backImage={screen.back} initial={screen.fields}
                                ocrFailed={screen.ocrFailed} onSubmit={(fields) => send({ type: 'DOC_SUBMIT', fields })}
                                onRetake={() => send({ type: 'RESCAN' })} />
        );
      case 'docUpload': {
        const id = session?.sessionId ?? '';
        const { fields } = screen;
        return (
          <UploadStep<DocumentResponse> title={t('uploadingDocument')} context="DOCUMENT"
                                        run={(signal) => client.submitDocument(id, {
                                          documentType: screen.documentType, document: screen.image, documentBack: screen.back ?? undefined,
                                          documentNumber: fields.documentNumber || undefined, expiryDate: fields.expiryDate || undefined,
                                          mrzLine2: fields.mrzLine2 || undefined, fullName: fields.fullName || undefined,
                                          dateOfBirth: fields.dateOfBirth || undefined, issuingCountry: fields.issuingCountry || undefined,
                                        }, signal)}
                                        onSuccess={onDocumentResponse} onFailure={onDocumentFailure} />
        );
      }
      case 'docRescan':
        return (
          <NoticeScreen title={t('rescanTitle')} message={screen.notice.message} fallback={t('scanFailedBody')}
                        attemptsRemaining={screen.notice.attemptsRemaining} actionLabel={t('scanAgain')} tips={documentTips(t)}
                        onAction={() => send({ type: 'RESCAN' })}
                        secondary={state.fixedDocument ? undefined : { label: t('useOtherDocument'), onClick: () => send({ type: 'CHOOSE_DOCUMENT' }) }} />
        );
      case 'review':
        return session
          ? (
            <UnderReviewScreen sessionId={session.sessionId} doneLabel={doneLabel}
                               onDecided={(r) => { setResult(r); clearSession(); send({ type: 'RESULT', decision: r.decision }); }}
                               onResult={setResult} onDone={finish} />
          )
          : <LoadingScreen />;
      case 'result':
        return screen.decision === 'APPROVED'
          ? (
            <ResultScreen tone="success" title={sdk.branding.texts[i18n.lang]?.doneTitle || t('approvedTitle')}
                          body={sdk.branding.texts[i18n.lang]?.doneBody || t('approvedBody')}
                          primary={{ label: doneLabel, onClick: finish }} />
          )
          : (
            <ResultScreen tone="danger" title={t('rejectedTitle')} body={t('rejectedBody')} message={screen.message}
                          reference={session?.sessionId} primary={{ label: doneLabel, onClick: finish }}
                          secondary={{ label: t('startAgain'), onClick: () => send({ type: 'RESTART' }) }} />
          );
      case 'over':
        return (
          <ResultScreen tone={screen.reason === 'EXPIRED' || screen.reason === 'CANCELLED' ? 'neutral' : 'danger'}
                        title={t(`over${screen.reason}Title`)} body={t(`over${screen.reason}Body`)} message={screen.message}
                        reference={session?.sessionId}
                        primary={{ label: t('startAgain'), onClick: () => { setResult(null); send({ type: 'RESTART' }); } }}
                        secondary={{ label: isLast ? t('close') : t('continue'), onClick: finish }} />
        );
      default:
        return <LoadingScreen />;
    }
  })();

  return (
    <>
      {timer && <div className="ct-flowbar">{timer}</div>}
      {body}
    </>
  );
}


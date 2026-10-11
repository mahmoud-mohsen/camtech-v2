// The session-less selfie flows: selfies → one upload → decision.
// FACE_AUTHENTICATION (POST /v2/face-authentications): a returning user, matched to their registered face.
// LIVENESS_CHECK (POST /v2/liveness-checks): a live person is in front of the camera; nothing is registered.
// FACE_ENROLLMENT (POST /v2/face-enrollments): registers the face of the subject (approved / review / rejected).
import { useCallback, useEffect, useState, type ReactElement } from 'react';
import type { CamtechPublicClient, ChallengeSubmission, SelfieFlowResponse } from '@camtech/api-client';
import { requestMotionPermission } from '@camtech/capture-core';
import { isFatal, type ClassifiedError } from '../../core/errors';
import { faceChallengeTarget, faceOutcome, type FaceFlow } from '../../core/face-flow';
import { challengeRequest, challengeRequired } from '../../core/journey';
import type { StepName, VerificationResult } from '../../core/protocol';
import type { Notice } from '../../core/selfie-flow';
import type { MessageKey } from '../../i18n';
import { preloadFaceTracker } from '../capture/vision';
import { useSdk, useStep } from '../context';
import { LivenessScreen } from '../screens/capture';
import { ErrorScreen, ResultScreen, SelfiePrimerScreen, UploadStep, type PrimerKind } from '../screens/common';
import type { FlowProps } from './SelfieVerificationFlow';

type FaceScreen =
  | { name: 'primer' }
  | { name: 'liveness'; notice: Notice | null }
  | { name: 'upload'; normal: Blob; challenge: ChallengeSubmission | null }
  | { name: 'decided'; res: SelfieFlowResponse }
  | { name: 'notEnrolled'; message: string | null }
  | { name: 'alreadyEnrolled'; message: string | null }
  | { name: 'error'; error: ClassifiedError; retry?: () => void };

const STEP: Record<FaceScreen['name'], StepName> = {
  primer: 'CAMERA_PERMISSION', liveness: 'LIVENESS', upload: 'LIVENESS_UPLOAD', decided: 'RESULT', notEnrolled: 'RESULT',
  alreadyEnrolled: 'RESULT', error: 'ERROR',
};

interface FlowTexts {
  primer: PrimerKind;
  uploading: MessageKey;
  approved: [MessageKey, MessageKey];
  rejected: [MessageKey, MessageKey];
}

const TEXTS: Record<FaceFlow, FlowTexts> = {
  FACE_AUTHENTICATION: {
    primer: 'faceAuth', uploading: 'uploadingFaceAuth', approved: ['faceApprovedTitle', 'faceApprovedBody'], rejected: ['faceRejectedTitle', 'faceRejectedBody'],
  },
  LIVENESS_CHECK: {
    primer: 'livenessCheck', uploading: 'uploadingLiveness', approved: ['livenessApprovedTitle', 'livenessApprovedBody'],
    rejected: ['livenessRejectedTitle', 'livenessRejectedBody'],
  },
  FACE_ENROLLMENT: {
    primer: 'faceEnroll', uploading: 'uploadingFaceEnroll', approved: ['enrollApprovedTitle', 'enrollApprovedBody'],
    rejected: ['enrollRejectedTitle', 'enrollRejectedBody'],
  },
};

function upload(client: CamtechPublicClient, flow: FaceFlow, subjectRef: string | null, normal: Blob, signal: AbortSignal,
                challenge: ChallengeSubmission | null): Promise<SelfieFlowResponse> {
  const ch = challenge ?? undefined;
  if (flow === 'LIVENESS_CHECK') return client.livenessCheck(subjectRef, normal, null, undefined, signal, ch);
  if (flow === 'FACE_ENROLLMENT') return client.faceEnroll(subjectRef ?? '', normal, null, undefined, signal, ch);
  return client.faceAuthenticate(subjectRef ?? '', normal, null, undefined, signal, ch);
}

export function SelfieOnlyFlow({ flow, isLast, onDone }: FlowProps<VerificationResult> & { flow: FaceFlow }): ReactElement {
  const { client, caps, i18n, subjectRef, reportError, config, setCancelInfo, branding } = useSdk();
  const { t } = i18n;
  const texts = TEXTS[flow];
  const [screen, setScreen] = useState<FaceScreen>({ name: 'primer' });
  useStep(flow, screen.name === 'decided' && screen.res.decision === 'REVIEW' ? 'UNDER_REVIEW' : STEP[screen.name]);
  const doneLabel = t(isLast ? 'done' : 'continue');

  useEffect(() => {
    setCancelInfo({ sessionId: null });
    return () => setCancelInfo(null);
  }, [setCancelInfo]);

  useEffect(() => {
    if (screen.name === 'primer') preloadFaceTracker(config.vision);
  }, [screen.name, config.vision]);

  const report = useCallback((c: ClassifiedError) => {
    reportError({ code: c.code, message: c.message ?? c.code, fatal: isFatal(c.action), status: c.status, flow });
  }, [reportError, flow]);

  /** FACE_ALREADY_ENROLLED (challenge or upload) ends the flow; anything else stays on the liveness screen. */
  const onChallengeError = useCallback((c: ClassifiedError) => {
    if (c.action !== 'ALREADY_ENROLLED') return false;
    report(c);
    setScreen({ name: 'alreadyEnrolled', message: c.message });
    return true;
  }, [report]);

  const onFailure = useCallback((c: ClassifiedError, normal: Blob, challenge: ChallengeSubmission | null) => {
    report(c);
    if (c.action === 'NOT_ENROLLED') setScreen({ name: 'notEnrolled', message: c.message });
    else if (c.action === 'ALREADY_ENROLLED') setScreen({ name: 'alreadyEnrolled', message: c.message });
    else if (c.action === 'NEW_CHALLENGE') {
      setScreen({ name: 'liveness', notice: { code: c.code, message: t('challengeRenewed'), attemptsRemaining: null } });
    }
    else if (c.action === 'RETAKE_LIVENESS' || c.action === 'TOO_LARGE') {
      setScreen({ name: 'liveness', notice: { code: c.code, message: c.message, attemptsRemaining: c.attemptsRemaining } });
    } else setScreen({ name: 'error', error: c, retry: () => setScreen({ name: 'upload', normal, challenge }) });
  }, [report, t]);

  switch (screen.name) {
    case 'primer':
      return (
        <SelfiePrimerScreen kind={texts.primer} onContinue={() => {
          void requestMotionPermission();
          setScreen({ name: 'liveness', notice: null });
        }} />
      );
    case 'liveness':
      return (
        <LivenessScreen notice={screen.notice} challengeRequired={challengeRequired(caps, flow)}
                        challengeRequest={challengeRequest(caps, flow, faceChallengeTarget(flow, subjectRef))}
                        loadChallenge={(body) => client.createLivenessChallenge(body)}
                        onChallengeError={onChallengeError}
                        onCaptured={(normal, challenge) => setScreen({ name: 'upload', normal, challenge })} />
      );
    case 'upload': {
      const { normal, challenge } = screen;
      return (
        <UploadStep<SelfieFlowResponse> title={t(texts.uploading)} context="FACE_AUTH"
                                        run={(signal) => upload(client, flow, subjectRef, normal, signal, challenge)}
                                        onSuccess={(res) => setScreen({ name: 'decided', res })}
                                        onFailure={(c) => onFailure(c, normal, challenge)} />
      );
    }
    case 'decided': {
      const { res } = screen;
      const entry: VerificationResult = {
        flow, sessionId: res.sessionId, status: 'COMPLETED', decision: res.decision,
        resultToken: res.resultToken, resultTokenExpiresAt: res.resultTokenExpiresAt,
      };
      const done = { label: doneLabel, onClick: () => onDone(entry) };
      switch (faceOutcome(res)) {
        case 'approved':
          return <ResultScreen tone="success" title={t(texts.approved[0])} body={t(texts.approved[1])} primary={done} />;
        case 'review':
          return <ResultScreen tone="warning" title={t('enrollReviewTitle')} body={t('enrollReviewBody')} reference={res.sessionId} primary={done} />;
        case 'duplicate':
          return (
            <ResultScreen tone="danger" title={t(texts.rejected[0])} body={t('enrollDuplicateBody', { name: branding.displayName })}
                          message={res.message} reference={res.sessionId} primary={done} />
          );
        default:
          return (
            <ResultScreen tone="danger" title={t(texts.rejected[0])} body={t(texts.rejected[1])} message={res.message}
                          reference={res.sessionId}
                          primary={{ label: t('tryAgain'), onClick: () => setScreen({ name: 'liveness', notice: null }) }}
                          secondary={done} />
          );
      }
    }
    case 'notEnrolled':
      return (
        <ResultScreen tone="neutral" title={t('notEnrolledTitle')} body={t('notEnrolledBody')} message={screen.message}
                      primary={{ label: doneLabel, onClick: () => onDone(null) }} />
      );
    case 'alreadyEnrolled':
      return (
        <ResultScreen tone="success" title={t('alreadyEnrolledTitle')} body={t('alreadyEnrolledBody')} message={screen.message}
                      primary={{ label: doneLabel, onClick: () => onDone(null) }} />
      );
    case 'error':
      return (
        <ErrorScreen error={screen.error}
                     onRetry={screen.retry && !isFatal(screen.error.action) ? screen.retry : undefined}
                     onStartAgain={() => setScreen({ name: 'liveness', notice: null })}
                     onClose={() => onDone(null)} />
      );
    default:
      return <></>;
  }
}

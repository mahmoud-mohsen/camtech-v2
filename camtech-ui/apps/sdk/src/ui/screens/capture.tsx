import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { documentKindOf, fileToJpeg, type HintCode } from '@camtech/capture-core';
import type { ChallengeSubmission, LivenessChallenge, LivenessChallengeRequest, ScanDocumentType } from '@camtech/api-client';
import { classifyError, isFatal, type ClassifiedError } from '../../core/errors';
import { withRetry } from '../../core/retry';
import type { Notice } from '../../core/selfie-flow';
import type { MessageKey } from '../../i18n';
import { useDocumentCapture } from '../capture/useDocumentCapture';
import { useCamera } from '../capture/useCamera';
import { useSelfieCapture } from '../capture/useSelfieCapture';
import { ChallengeOverlay, DocumentStage, guideFor, LivenessStage } from '../capture/views';
import { Alert, Button, LiveRegion } from '../components/base';
import { useElementSize } from '../components/hooks';
import { IconClose, IconFlash, IconSwitch, IconUpload } from '../components/icons';
import { JourneyPill } from '../components/steps';
import { useImmersive, useSdk } from '../context';
import { CameraProblemScreen } from './common';

/** Over the camera: close (asks to confirm) and where the user is in the journey. */
function CaptureTopBar(): ReactElement {
  const { i18n, journey, requestCancel, preview } = useSdk();
  return (
    <div className="ct-capture__top">
      <span className="ct-capture__top-side" />
      {journey ? <JourneyPill journey={journey} i18n={i18n} /> : <span />}
      <span className="ct-capture__top-side">
        {!preview && (
          <button type="button" className="ct-icon-btn ct-icon-btn--glass" onClick={requestCancel} aria-label={i18n.t('closeVerification')}>
            <IconClose size={22} />
          </button>
        )}
      </span>
    </div>
  );
}

function CaptureHeading({ title, sub }: { title: string; sub?: string }): ReactElement {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, [title]);
  return (
    // Keyed by title so a new step (e.g. the challenge after the selfie) animates in.
    <div key={title} className="ct-capture__head">
      <h1 ref={ref} tabIndex={-1} className="ct-title ct-title--sm">{title}</h1>
      {sub && <p className="ct-capture__sub">{sub}</p>}
    </div>
  );
}

function Shutter({ label, onClick, busy }: { label: string; onClick: () => void; busy: boolean }): ReactElement {
  return (
    <button type="button" className="ct-shutter" onClick={onClick} disabled={busy} aria-label={label}>
      <span className="ct-shutter__inner" aria-hidden="true" />
    </button>
  );
}

export interface LivenessScreenProps {
  notice?: Notice | null;
  /** The challenge to request, or null when the flow's liveness is PASSIVE (no challenge, no challenge frames). */
  challengeRequest: LivenessChallengeRequest | null;
  /** Requests a new active-liveness challenge (called once per screen, and again when one expires). */
  loadChallenge: (body: LivenessChallengeRequest) => Promise<LivenessChallenge>;
  /** The server rejects uploads without a challenge (no fallback to the normal selfie only). */
  challengeRequired: boolean;
  /** The normal selfie (the only fixed photo) and the challenge frames, if any. */
  onCaptured: (normal: Blob, challenge: ChallengeSubmission | null) => void;
  /** A challenge request failed: return true when the flow handles it (e.g. FACE_ALREADY_ENROLLED ends the flow). */
  onChallengeError?: (error: ClassifiedError) => boolean;
}

type ChallengeLoad =
  | { status: 'loading' }
  | { status: 'ready'; challenge: LivenessChallenge | null }
  | { status: 'error'; error: ClassifiedError };

export function LivenessScreen({ notice, challengeRequest, loadChallenge, challengeRequired, onCaptured, onChallengeError }: LivenessScreenProps): ReactElement {
  const { i18n, config, reportError } = useSdk();
  const { t, tk, tn } = i18n;
  const camera = useCamera({ facing: 'user', minShortSide: 720, maxLongSide: 1280, scene: 'face' });
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const live = camera.state.status === 'live';
  const [load, setLoad] = useState<ChallengeLoad>({ status: 'loading' });
  const [nonce, setNonce] = useState(0);
  const loader = useRef(loadChallenge);
  loader.current = loadChallenge;
  const onLoadError = useRef(onChallengeError);
  onLoadError.current = onChallengeError;
  const request = useRef(challengeRequest);
  request.current = challengeRequest;
  const passive = challengeRequest === null;

  // A fresh challenge right before the liveness (once the camera works), and a new one when it expires.
  // PASSIVE: none at all (the normal selfie only).
  useEffect(() => {
    if (passive) {
      setLoad({ status: 'ready', challenge: null });
      return;
    }
    const body = request.current;
    if (!live || !body) return;
    let cancelled = false;
    setLoad({ status: 'loading' });
    withRetry(() => loader.current(body)).then((challenge) => {
      if (!cancelled) setLoad({ status: 'ready', challenge });
    }, (e: unknown) => {
      if (cancelled) return;
      const c = classifyError(e, 'LIVENESS');
      if (onLoadError.current?.(c)) return;
      // CHALLENGE_NOT_USED: the flow switched to PASSIVE after the capabilities were read.
      if (c.code === 'CHALLENGE_NOT_USED' || (!challengeRequired && c.action !== 'RETRY' && !isFatal(c.action))) {
        setLoad({ status: 'ready', challenge: null }); // fall back to the normal selfie only
      } else {
        reportError({ code: c.code, message: c.message ?? c.code, fatal: isFatal(c.action), status: c.status });
        setLoad({ status: 'error', error: c });
      }
    });
    return () => { cancelled = true; };
  }, [live, nonce, passive, challengeRequired, reportError]);

  const capture = useSelfieCapture({
    video: camera.video, live, stage, sim: camera.sim, vision: config.vision,
    challenge: load.status === 'ready' ? load.challenge : undefined,
    onChallengeExpired: () => setNonce((n) => n + 1),
    onDone: onCaptured,
  });
  useImmersive(!camera.error);

  if (camera.error) return <CameraProblemScreen code={camera.error.code} onRetry={camera.restart} />;

  const ch = capture.phase === 'CHALLENGE';
  const view = capture.challenge;
  let hintText: string | null = null;
  let challengeText: string | null = null;
  let challengeSub: string | null = null;
  if (ch) {
    if (load.status === 'error') challengeText = load.error.message ?? t('challengeLoadFailed');
    else if (!view) challengeText = t('challengeLoading');
    else {
      challengeText = view.hint === 'NO_FACE' || view.hint === 'MULTIPLE_FACES' ? tk(`hint_${view.hint}`) : tk(`challenge_${view.hint}`);
      if (view.restarted) challengeSub = t('challengeRestart');
      else if (view.slow) challengeSub = t('challengeSlow');
      else if (view.timed && view.hint !== 'LOOK_STRAIGHT') challengeSub = t('challengeTimed');
    }
  } else if (capture.warning === 'TRACKING_LOST') hintText = t('trackingLost');
  else if (capture.model === 'failed') {
    hintText = capture.hint && capture.hint !== 'GOOD' ? tk(`hint_${capture.hint}`) : t('manualHint');
  } else if (capture.hint) {
    hintText = tk(`hint_${capture.hint satisfies HintCode}`);
  }
  const loading = !live || capture.model === 'loading';
  const title = ch ? t('challengeTitle') : t('livenessNormalTitle');
  const total = view?.actions.length ?? 0;
  const sub = ch && view ? t('challengeStep', { n: Math.min(view.index + 1, total), total }) : undefined;
  const announce = ch
    ? [challengeText, challengeSub].filter(Boolean).join('. ')
    : capture.shots > 0 && capture.busy ? t('photoTaken') : hintText ?? '';
  return (
    <section className={`ct-capture${ch && load.status !== 'error' ? ' ct-capture--challenge' : ''}`} aria-label={title}>
      <CaptureTopBar />
      <CaptureHeading title={title} sub={sub} />
      {notice && capture.phase === 'NORMAL' && (
        <div className="ct-capture__notice">
          <Alert tone="warning" role="alert">
            {notice.message ?? tk(`hint_${notice.code}`, undefined, t('unknownErrorBody'))}
            {notice.attemptsRemaining !== null && <> · {tn('attemptsLeft', notice.attemptsRemaining)}</>}
          </Alert>
        </div>
      )}
      <LivenessStage stageRef={stageRef} stage={stage} videoRef={camera.videoRef} mirrored={camera.state.mirrored}
                     phase={capture.phase} closer={ch && view?.hint === 'MOVE_CLOSER'} progress={capture.progress} ready={capture.ready}
                     hintText={loading || ch ? null : hintText} loading={loading} loadingText={t(live ? 'preparingCamera' : 'startingCamera')}
                     flashKey={capture.shots} videoLabel={t('cameraPreview')}>
        {ch && challengeText && (
          <ChallengeOverlay actions={view?.actions ?? []} index={view?.index ?? 0} hint={view?.hint ?? 'LOADING'}
                            text={challengeText} sub={challengeSub} mirrored={camera.state.mirrored}
                            completedCount={view?.completedCount ?? 0}
                            stepLabel={(n) => t('challengeStep', { n, total })} />
        )}
      </LivenessStage>
      <LiveRegion text={announce} minIntervalMs={ch ? 900 : 2500} />
      <div className="ct-capture__controls">
        {capture.model === 'failed' && <p className="ct-small ct-capture__info">{t('autoCaptureUnavailable')}</p>}
        {camera.state.lowResolution && <p className="ct-small ct-capture__info">{t('cameraLowRes')}</p>}
        {ch && load.status === 'error' && (
          <Button variant="secondary" onClick={() => setNonce((n) => n + 1)}>{t('tryAgain')}</Button>
        )}
        <div className="ct-capture__buttons">
          <span className="ct-capture__side">
            {camera.state.canSwitch && !camera.sim && !ch && (
              <button type="button" className="ct-icon-btn" onClick={camera.switchCamera} aria-label={t('switchCamera')}>
                <IconSwitch />
              </button>
            )}
          </span>
          {capture.manual && live ? <Shutter label={t('takePhoto')} onClick={capture.shoot} busy={capture.busy} /> : <span className="ct-shutter-placeholder" />}
          <span className="ct-capture__side" />
        </div>
      </div>
    </section>
  );
}

export interface DocumentCaptureScreenProps {
  documentType: ScanDocumentType;
  /** "Side 1 of 2" etc. */
  sub?: string;
  uploadAllowed: boolean;
  onCaptured: (image: Blob) => void;
}

const PORTRAIT_TYPES: ScanDocumentType[] = ['EMIRATES_ID', 'EMIRATES_ID_FRONT', 'PASSPORT'];

/** No touch screen and a fine pointer: a laptop or desktop, where the document is held up to a webcam. */
function isLaptopLike(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return navigator.maxTouchPoints === 0 && window.matchMedia('(pointer: fine)').matches;
}

export function DocumentCaptureScreen({ documentType, sub, uploadAllowed, onCaptured }: DocumentCaptureScreenProps): ReactElement {
  const { i18n, config } = useSdk();
  const { t, tk } = i18n;
  const kind = documentKindOf(documentType);
  const camera = useCamera({ facing: 'environment', minShortSide: 720, scene: kind });
  const [stageRef, stage] = useElementSize<HTMLDivElement>();
  const live = camera.state.status === 'live';
  const guide = guideFor(kind, stage);
  const [fileError, setFileError] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [laptop] = useState(isLaptopLike);
  const fileId = useId();
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    camera.sim?.setSide(documentType === 'EMIRATES_ID_BACK' ? 'back' : 'front');
  }, [camera.sim, documentType]);

  const capture = useDocumentCapture({
    video: camera.video, live: live && !preparing, stage, guide, kind,
    requirePortrait: PORTRAIT_TYPES.includes(documentType), requireMrz: documentType === 'PASSPORT',
    sim: camera.sim, vision: config.vision, captureKey: documentType, onCaptured,
  });
  useImmersive(!camera.error);

  const onFile = async (file: File | undefined): Promise<void> => {
    if (!file) return;
    setFileError(false);
    setPreparing(true);
    try {
      const { blob } = await fileToJpeg(file);
      onCaptured(blob);
    } catch {
      setFileError(true);
    } finally {
      setPreparing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const uploadInput = uploadAllowed ? (
    <input ref={fileRef} id={fileId} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/*"
           className="ct-visually-hidden" tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
  ) : null;

  if (camera.error) {
    return (
      <>
        {uploadInput}
        <CameraProblemScreen code={camera.error.code} onRetry={camera.restart}
                             onUpload={uploadAllowed ? () => fileRef.current?.click() : undefined} />
        {fileError && <Alert tone="danger" role="alert">{t('fileUnusable')}</Alert>}
      </>
    );
  }

  const titleKey = `capture_${documentType}` as MessageKey;
  let hintKey: string | null = capture.hint ? `dochint_${capture.hint}` : null;
  if (capture.hint === 'ALIGN_DOCUMENT' && kind === 'PASSPORT') hintKey = 'dochint_ALIGN_PASSPORT';
  const hintText = preparing ? t('preparingPhoto') : hintKey ? tk(hintKey) : null;
  return (
    <section className={`ct-capture${uploadAllowed ? ' ct-capture--upload' : ''}`} aria-label={t(titleKey)}>
      {uploadInput}
      <CaptureTopBar />
      <CaptureHeading title={t(titleKey)} sub={sub} />
      {fileError && <div className="ct-capture__notice"><Alert tone="danger" role="alert">{t('fileUnusable')}</Alert></div>}
      <DocumentStage stageRef={stageRef} stage={stage} kind={kind} videoRef={camera.videoRef} ready={capture.ready}
                     progress={capture.progress} hintText={live ? hintText : null} flashKey={capture.shots}
                     videoLabel={t('cameraPreview')}>
        {!live && (
          <div className="ct-stage__loading">
            <span className="ct-spinner ct-spinner--lg" aria-hidden="true" />
            <span>{t('startingCamera')}</span>
          </div>
        )}
      </DocumentStage>
      <LiveRegion text={hintText ?? ''} />
      <div className="ct-capture__controls">
        {laptop && live && !capture.manual && <p className="ct-small ct-capture__info">{t('tipDocLaptop')}</p>}
        {capture.manual && <p className="ct-small ct-capture__info">{t('dochint_MANUAL')}</p>}
        <div className="ct-capture__buttons">
          <span className="ct-capture__side">
            {camera.state.torchSupported && (
              <button type="button" className={`ct-icon-btn${camera.state.torchOn ? ' ct-icon-btn--on' : ''}`}
                      aria-pressed={camera.state.torchOn} onClick={() => camera.setTorch(!camera.state.torchOn)}
                      aria-label={t(camera.state.torchOn ? 'torchOff' : 'torchOn')}>
                <IconFlash />
              </button>
            )}
          </span>
          {capture.manual && live ? <Shutter label={t('takePhoto')} onClick={capture.shoot} busy={capture.busy || preparing} /> : <span className="ct-shutter-placeholder" />}
          <span className="ct-capture__side">
            {camera.state.canSwitch && !camera.sim && (
              <button type="button" className="ct-icon-btn" onClick={camera.switchCamera} aria-label={t('switchCamera')}>
                <IconSwitch />
              </button>
            )}
          </span>
        </div>
        {uploadAllowed && (
          <button type="button" className="ct-capture__upload" onClick={() => fileRef.current?.click()} disabled={preparing}>
            <IconUpload size={18} />
            <span>{t('uploadInstead')}</span>
          </button>
        )}
      </div>
    </section>
  );
}


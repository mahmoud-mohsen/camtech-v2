import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import type { CameraErrorCode } from '@camtech/capture-core';
import type { JourneyFlow } from '../../config/options';
import type { StageKey } from '../../core/journey-progress';
import { classifyError, type ClassifiedError, type ErrorContext } from '../../core/errors';
import type { FlowResult } from '../../core/protocol';
import { isAbort, withRetry } from '../../core/retry';
import type { MessageKey } from '../../i18n';
import { safeLink } from '../../theme/theme';
import { Alert, Button, ExternalLink, ProgressBar, Reference, Screen } from '../components/base';
import {
  IconAlert, IconCamera, IconCheck, IconClock, IconClose, IconDocument, IconFace, IconGlasses, IconIdCard, IconInfo, IconLock,
  IconPhone, IconRefresh, IconSun, IconWifiOff,
} from '../components/icons';
import { useSdk, useT } from '../context';

/** Placeholder in the shape of a real screen while the SDK starts. */
export function LoadingScreen({ text }: { text?: string }): ReactElement {
  const { t } = useT();
  return (
    <section className="ct-screen ct-skeleton" aria-busy="true">
      <div className="ct-screen__body">
        <div className="ct-skeleton__circle" />
        <div className="ct-skeleton__lines">
          <div className="ct-skeleton__line ct-skeleton__line--wide" />
          <div className="ct-skeleton__line ct-skeleton__line--mid" />
          <div className="ct-skeleton__line" />
        </div>
        <div className="ct-skeleton__card" />
        <div className="ct-skeleton__card" />
        <div className="ct-skeleton__card" />
      </div>
      <p className="ct-skeleton__text" role="status">{text ?? t('loadingTitle')}…</p>
    </section>
  );
}

export function Tips({ items, highlight }: { items: { icon: ReactNode; text: string }[]; highlight?: number }): ReactElement {
  return (
    <ul className="ct-tips">
      {items.map((it, i) => (
        <li key={it.text} className={`ct-tips__item${i === highlight ? ' ct-tips__item--highlight' : ''}`}>
          <span className="ct-tips__icon" aria-hidden="true">{it.icon}</span>
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}

type Need = 'selfie' | 'idDocument' | 'scanDocument' | 'face' | 'faceRegistration';

export interface WelcomeProps {
  needs: Need[];
  onStart: () => void;
  busy?: boolean;
  error?: ReactNode;
}

const STAGE_STEP: Record<StageKey, string> = {
  selfie: 'selfie', document: 'idDocument', faceAuth: 'face', faceEnroll: 'faceEnroll', liveness: 'selfie', scan: 'scanDocument',
};

export function WelcomeScreen({ needs, onStart, busy, error }: WelcomeProps): ReactElement {
  const { branding, i18n, stages } = useSdk();
  const { t, tk, tn } = i18n;
  const [agreed, setAgreed] = useState(false);
  const [showError, setShowError] = useState(false);
  const texts = branding.texts[i18n.lang] ?? branding.texts.en ?? {};
  const privacy = safeLink(branding.privacyUrl);
  // The whole journey, so the count matches "Step 1 of N" later. Face registration is something the user agrees
  // to, not a step: it goes into the consent text.
  const steps: string[] = stages.length
    ? stages.map((s) => STAGE_STEP[s])
    : needs.filter((n) => n !== 'faceRegistration');
  const enroll = needs.includes('faceRegistration');
  return (
    <Screen title={texts.welcomeTitle || t('welcomeTitle')}
            lead={texts.welcomeBody || tn('welcomeSteps', steps.length)}
            actions={(
              <Button onClick={() => (agreed ? onStart() : setShowError(true))} loading={busy} aria-describedby={showError && !agreed ? 'ct-consent-err' : undefined}>
                {t('start')}
              </Button>
            )}>
      <ol className="ct-steplist">
        {steps.map((n, i) => (
          <li key={`${n}-${i}`} className="ct-steplist__item">
            <span className={`ct-steplist__num${i === 0 ? ' ct-steplist__num--first' : ''}`} aria-hidden="true">{i + 1}</span>
            <span className="ct-steplist__text">
              <span className="ct-steplist__label">{tk(`welcomeStep_${n}`)}</span>
              <span className="ct-steplist__desc">{tk(`welcomeStep_${n}_desc`)}</span>
            </span>
          </li>
        ))}
      </ol>
      {error}
      <div className="ct-consent">
        <label className="ct-check">
          <input type="checkbox" checked={agreed} onChange={(e) => { setAgreed(e.target.checked); setShowError(false); }}
                 aria-invalid={showError && !agreed ? true : undefined} />
          <span>{t(enroll ? 'consentWithEnroll' : 'consent', { name: branding.displayName })}</span>
        </label>
        {showError && !agreed && <p id="ct-consent-err" className="ct-field__error" role="alert">{t('consentRequired')}</p>}
        {privacy && <p className="ct-small ct-consent__link"><IconLock size={14} /> <ExternalLink href={privacy}>{t('privacyNotice')}</ExternalLink></p>}
      </div>
    </Screen>
  );
}

export type PrimerKind = 'selfie' | 'faceAuth' | 'livenessCheck' | 'faceEnroll';

const PRIMER_TEXT: Record<PrimerKind, [MessageKey, MessageKey]> = {
  selfie: ['primerSelfieTitle', 'primerSelfieBody'],
  faceAuth: ['primerFaceAuthTitle', 'primerFaceAuthBody'],
  livenessCheck: ['primerLivenessCheckTitle', 'primerLivenessCheckBody'],
  faceEnroll: ['primerFaceEnrollTitle', 'primerFaceEnrollBody'],
};

export function SelfiePrimerScreen({ kind = 'selfie', onContinue }: { kind?: PrimerKind; onContinue: () => void }): ReactElement {
  const { t } = useT();
  const [title, body] = PRIMER_TEXT[kind];
  return (
    <Screen title={t(title)} icon={<IconFace size={30} />}
            lead={(
              <>
                <p>{t(body)}</p>
                <p className="ct-duration"><IconClock size={14} /> {t('primerDuration')}</p>
              </>
            )}
            actions={<Button onClick={onContinue} icon={<IconCamera size={20} />}>{t('allowCamera')}</Button>}>
      <Tips items={[
        { icon: <IconSun />, text: t('tipLight') },
        { icon: <IconGlasses />, text: t('tipFace') },
        { icon: <IconPhone />, text: t('tipEyeLevel') },
      ]} />
    </Screen>
  );
}

type Platform = 'ios' | 'android' | 'desktop';

export function detectPlatform(): Platform {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent;
  if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'ios';
  if (/Android/.test(ua)) return 'android';
  return 'desktop';
}

const CAMERA_TEXT: Record<CameraErrorCode, [MessageKey, MessageKey]> = {
  PERMISSION_DENIED: ['cameraDeniedTitle', 'cameraDeniedBody'],
  IN_USE: ['cameraInUseTitle', 'cameraInUseBody'],
  NOT_FOUND: ['cameraNotFoundTitle', 'cameraNotFoundBody'],
  INSECURE_CONTEXT: ['cameraInsecureTitle', 'cameraInsecureBody'],
  UNSUPPORTED: ['cameraUnsupportedTitle', 'cameraUnsupportedBody'],
  OVERCONSTRAINED: ['cameraUnknownTitle', 'cameraUnknownBody'],
  UNKNOWN: ['cameraUnknownTitle', 'cameraUnknownBody'],
};

const PLATFORM_HELP: Record<Platform, MessageKey> = {
  ios: 'cameraDeniedIos', android: 'cameraDeniedAndroid', desktop: 'cameraDeniedDesktop',
};
const PLATFORMS: Platform[] = ['ios', 'android', 'desktop'];

export function CameraProblemScreen({ code, onRetry, onUpload }: { code: CameraErrorCode; onRetry: () => void; onUpload?: () => void }): ReactElement {
  const { t, tk } = useT();
  const [title, body] = CAMERA_TEXT[code];
  const [platform, setPlatform] = useState<Platform>(detectPlatform);
  const canRetry = code !== 'INSECURE_CONTEXT' && code !== 'UNSUPPORTED';
  const denied = code === 'PERMISSION_DENIED';
  return (
    <Screen title={t(title)} lead={t(body)} icon={<IconCamera size={28} />} tone="danger"
            actions={(
              <>
                {canRetry && <Button onClick={onRetry} icon={<IconRefresh size={20} />}>{t('tryAgain')}</Button>}
                {denied && <Button variant="secondary" onClick={() => window.location.reload()}>{t('reloadPage')}</Button>}
                {onUpload && <Button variant="ghost" onClick={onUpload}>{t('uploadInstead')}</Button>}
              </>
            )}>
      {denied && (
        <div className="ct-device">
          <div className="ct-segmented" role="radiogroup" aria-label={t('cameraDevice')}>
            {PLATFORMS.map((p) => (
              <button key={p} type="button" role="radio" aria-checked={p === platform}
                      className={`ct-segmented__item${p === platform ? ' ct-segmented__item--on' : ''}`} onClick={() => setPlatform(p)}>
                {tk(`device_${p}`)}
              </button>
            ))}
          </div>
          <Alert tone="info">{t(PLATFORM_HELP[platform])}</Alert>
        </div>
      )}
    </Screen>
  );
}

export interface UploadStepProps<T> {
  title: string;
  /** Runs the upload; called again with the same inputs on "Try again". */
  run: (signal: AbortSignal) => Promise<T>;
  onSuccess: (value: T) => void;
  /** Non-retryable failures (the flow decides what to do). */
  onFailure: (error: ClassifiedError) => void;
  context: ErrorContext;
  /** Show the upload progress bar (multipart uploads). */
  showProgress?: boolean;
  /** After the automatic retries, offer "Try again" (default) or hand the error to onFailure. */
  offerRetry?: boolean;
}

/**
 * Sends an upload with automatic retries (twice, with backoff) for retryable errors, keeping the captured images.
 * After that it offers "Try again" without recapturing.
 */
export function UploadStep<T>({ title, run, onSuccess, onFailure, context, showProgress = true, offerRetry = true }: UploadStepProps<T>): ReactElement {
  const { progress, i18n } = useSdk();
  const { t } = i18n;
  const [fraction, setFraction] = useState<number | null>(null);
  const [retry, setRetry] = useState<number | null>(null);
  const [failed, setFailed] = useState<ClassifiedError | null>(null);
  const [round, setRound] = useState(0);
  const cbs = useRef({ run, onSuccess, onFailure });
  cbs.current = { run, onSuccess, onFailure };

  useEffect(() => {
    const controller = new AbortController();
    setFailed(null);
    setRetry(null);
    setFraction(showProgress ? 0 : null);
    const stop = progress.listen((f) => setFraction(f));
    withRetry(() => cbs.current.run(controller.signal), {
      signal: controller.signal,
      onRetry: (n) => {
        setRetry(n);
        setFraction(showProgress ? 0 : null);
      },
    }).then((v) => {
      if (!controller.signal.aborted) cbs.current.onSuccess(v);
    }, (e: unknown) => {
      if (controller.signal.aborted || isAbort(e)) return;
      const c = classifyError(e, context);
      if (c.action === 'RETRY' && offerRetry) setFailed(c);
      else cbs.current.onFailure(c);
    }).finally(stop);
    return () => {
      controller.abort();
      stop();
    };
  }, [round, context, progress, showProgress, offerRetry]);

  if (failed) {
    return (
      <ResultScreen tone="warning" icon={<IconWifiOff size={36} />} title={t('uploadFailedTitle')}
                    body={failed.message ?? t('networkErrorBody')} note={t('uploadFailedBody')}
                    primary={{ label: t('tryAgain'), onClick: () => setRound((r) => r + 1) }} />
    );
  }
  return (
    <Screen title={title} centered className="ct-processing">
      <div className="ct-upload">
        <ProgressBar value={fraction !== null && fraction < 1 ? fraction : null} label={t('uploadProgress')} />
        <p className="ct-muted" role="status">{retry !== null ? t('retrying', { n: retry, max: 2 }) : t('uploadKeepOpen')}</p>
      </div>
    </Screen>
  );
}

/** What usually fixes an unreadable document photo. */
export function documentTips(t: (key: MessageKey) => string): { icon: ReactNode; text: string }[] {
  return [
    { icon: <IconIdCard />, text: t('tipDocFrame') },
    { icon: <IconSun />, text: t('tipDocGlare') },
    { icon: <IconDocument />, text: t('tipDocFlat') },
  ];
}

export interface NoticeProps {
  title: string;
  message: string | null;
  fallback: string;
  attemptsRemaining: number | null;
  actionLabel: string;
  onAction: () => void;
  secondary?: { label: string; onClick: () => void };
  /** What usually fixes it (e.g. document photo tips). */
  tips?: { icon: ReactNode; text: string }[];
}

/** "Let's try again" with the server message, the attempts left and what to do differently. */
export function NoticeScreen({ title, message, fallback, attemptsRemaining, actionLabel, onAction, secondary, tips }: NoticeProps): ReactElement {
  const { tn } = useT();
  return (
    <Screen title={title} icon={<IconRefresh size={30} />} tone="warning" lead={message ?? fallback}
            actions={(
              <>
                <Button onClick={onAction} icon={<IconRefresh size={20} />}>{actionLabel}</Button>
                {secondary && <Button variant="ghost" onClick={secondary.onClick}>{secondary.label}</Button>}
              </>
            )}>
      {attemptsRemaining !== null && attemptsRemaining >= 0 && (
        <p className="ct-pill ct-pill--warning"><IconClock size={16} /> {tn('attemptsLeft', attemptsRemaining)}</p>
      )}
      {tips && tips.length > 0 && <Tips items={tips} />}
    </Screen>
  );
}

export interface ResultProps {
  tone: 'success' | 'danger' | 'warning' | 'neutral';
  title: string;
  body: string;
  /** Server message shown in addition to the body. */
  message?: string | null;
  /** Extra guidance in a box under the body. */
  note?: string | null;
  attemptsRemaining?: number | null;
  /** Session reference for support. */
  reference?: string | null;
  icon?: ReactNode;
  primary: { label: string; onClick: () => void };
  secondary?: { label: string; onClick: () => void };
  children?: ReactNode;
}

const RESULT_ICON = { success: IconCheck, warning: IconClock, danger: IconClose, neutral: IconInfo } as const;

export function ResultScreen({ tone, title, body, message, note, attemptsRemaining, reference, icon, primary, secondary, children }: ResultProps): ReactElement {
  const { tn } = useT();
  const Icon = RESULT_ICON[tone];
  const extra = message && message !== body ? message : null;
  return (
    <Screen title={title} tone={tone} centered className="ct-result" icon={icon ?? <Icon size={40} />} lead={body}
            actions={(
              <>
                <Button onClick={primary.onClick}>{primary.label}</Button>
                {secondary && <Button variant="ghost" onClick={secondary.onClick}>{secondary.label}</Button>}
                {reference && <Reference value={reference} />}
              </>
            )}>
      {(extra || note) && (
        <div className="ct-note">
          {extra && <p>{extra}</p>}
          {note && <p>{note}</p>}
        </div>
      )}
      {attemptsRemaining !== null && attemptsRemaining !== undefined && attemptsRemaining >= 0 && (
        <p className="ct-pill ct-pill--warning ct-pill--center">{tn('attemptsLeft', attemptsRemaining)}</p>
      )}
      {children}
    </Screen>
  );
}

export interface ErrorScreenProps {
  error: ClassifiedError | null;
  /** Override the title / body. */
  titleKey?: MessageKey;
  bodyKey?: MessageKey;
  onRetry?: () => void;
  onStartAgain?: () => void;
  onClose?: () => void;
}

/** Error screen chosen from the classified error's action (guide §5). */
export function ErrorScreen({ error, titleKey, bodyKey, onRetry, onStartAgain, onClose }: ErrorScreenProps): ReactElement {
  const { i18n, branding } = useSdk();
  const { t } = i18n;
  const action = error?.action ?? 'UNKNOWN';
  let tk: MessageKey = 'unknownErrorTitle';
  let bk: MessageKey = 'unknownErrorBody';
  if (action === 'SERVICE_BUSY') [tk, bk] = ['busyTitle', 'busyBody'];
  else if (action === 'CONFIG') [tk, bk] = ['configTitle', 'configBody'];
  else if (action === 'TOKEN_EXPIRED') [tk, bk] = ['tokenExpiredTitle', 'tokenExpiredBody'];
  else if (action === 'FEATURE_UNAVAILABLE') [tk, bk] = ['featureTitle', 'featureBody'];
  else if (action === 'START_AGAIN') [tk, bk] = ['overSESSIONTitle', 'overSESSIONBody'];
  else if (action === 'TOO_LARGE') bk = 'tooLargeBody';
  else if (error?.code === 'NETWORK_ERROR') bk = 'networkErrorBody';
  const support = safeLink(branding.supportUrl) ?? (branding.supportEmail ? `mailto:${branding.supportEmail}` : null);
  // Configuration problems are for the integrator: the end user gets a generic message.
  const message = action === 'CONFIG' ? null : error?.message ?? null;
  const offline = error?.code === 'NETWORK_ERROR';
  return (
    <Screen title={t(titleKey ?? tk)} icon={offline ? <IconWifiOff size={36} /> : <IconAlert size={36} />} tone={offline ? 'warning' : 'danger'}
            centered className="ct-result"
            lead={message ?? t(bodyKey ?? bk, { name: branding.displayName })}
            actions={(
              <>
                {onRetry && <Button onClick={onRetry} icon={<IconRefresh size={20} />}>{t('tryAgain')}</Button>}
                {onStartAgain && <Button variant={onRetry ? 'secondary' : 'primary'} onClick={onStartAgain}>{t('startAgain')}</Button>}
                {onClose && <Button variant="ghost" onClick={onClose}>{t('close')}</Button>}
              </>
            )}>
      {(action === 'CONFIG' || action === 'SERVICE_BUSY') && support && (
        <p className="ct-small ct-center"><ExternalLink href={support}>{t('contactSupport')}</ExternalLink></p>
      )}
    </Screen>
  );
}

type Outcome = 'approved' | 'review' | 'rejected' | 'scanned' | 'incomplete';

function outcomeOf(result: FlowResult | undefined): Outcome {
  if (!result) return 'incomplete';
  if (result.flow === 'DOCUMENT_SCAN') return 'scanned';
  if (result.decision === 'APPROVED') return 'approved';
  if (result.decision === 'REVIEW') return 'review';
  if (result.decision === 'REJECTED') return 'rejected';
  return 'incomplete';
}

const OUTCOME_ICON: Record<Outcome, ReactNode> = {
  approved: <IconCheck size={14} />, scanned: <IconCheck size={14} />, review: <IconClock size={14} />,
  rejected: <IconClose size={14} />, incomplete: <IconInfo size={14} />,
};

/** End of the journey: what was done, flow by flow (only when there was more than one). */
export function JourneyDoneScreen({ flows, results, redirecting }: { flows: readonly JourneyFlow[]; results: readonly FlowResult[]; redirecting: boolean }): ReactElement {
  const { t, tk } = useT();
  return (
    <Screen title={t('finishedTitle')} tone="success" centered className="ct-result" icon={<IconCheck size={40} />}
            lead={flows.length > 1 ? t('finishedSummary') : redirecting ? t('finishedRedirect') : t('finishedBody')}>
      {flows.length > 1 && (
        <ul className="ct-summary">
          {flows.map((f) => {
            const o = outcomeOf(results.find((r) => r.flow === f));
            return (
              <li key={f} className="ct-summary__item">
                <span className={`ct-summary__icon ct-summary__icon--${o}`} aria-hidden="true">{OUTCOME_ICON[o]}</span>
                <span className="ct-summary__text">
                  <span className="ct-summary__label">{tk(`flow_${f}`)}</span>
                  <span className="ct-summary__status">{tk(`summary_${o}`)}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {flows.length > 1 && <p className="ct-muted ct-center" role="status">{redirecting ? t('finishedRedirect') : t('finishedBody')}</p>}
    </Screen>
  );
}

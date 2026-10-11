// The SDK application: loads capabilities and branding, runs the journey's flows in order, handles cancel,
// and reports to the host through the bridge.
import {
  Component, lazy, Suspense, useCallback, useEffect, useMemo, useReducer, useRef, useState, type ReactElement, type ReactNode,
} from 'react';
import {
  CamtechPublicClient, type Branding, type Capabilities, type Lang, type Transport,
} from '@camtech/api-client';
import { subjectFromSdkToken, type JourneyFlow, type SdkConfig } from '../config/options';
import type { HostBridge } from '../core/bridge';
import { classifyError, isFatal, type ClassifiedError } from '../core/errors';
import { isFaceFlow } from '../core/face-flow';
import { currentFlow, initialJourney, journeyReducer, planJourney } from '../core/journey';
import { FLOW_STAGES, isNeutralStep, journeyProgress } from '../core/journey-progress';
import type { CompletePayload, DocumentScanResult, StepName, VerificationResult } from '../core/protocol';
import { withRetry } from '../core/retry';
import { clearSession } from '../core/session-store';
import { instrumented, ProgressChannel, xhrTransport } from '../core/transport';
import { createTranslator } from '../i18n';
import { mergeBranding } from '../theme/theme';
import { SDK_VERSION } from '../version';
import { ConfirmDialog } from './components/dialog';
import { SdkContext, type CancelInfo, type SdkContextValue, type SimulateMode } from './context';
import { ErrorScreen, JourneyDoneScreen, LoadingScreen, ResultScreen } from './screens/common';
import { Shell, type ShellMode } from './Shell';

export interface AppProps {
  config: SdkConfig;
  bridge: HostBridge;
  mode: ShellMode;
  /** Language override from the host (setLang). */
  lang?: Lang;
  simulate: SimulateMode;
  /** Replaces the network (mock mode). Receives the upload progress channel. */
  createTransport?: (progress: ProgressChannel) => Transport;
  /** Esc asks to cancel. */
  escToCancel?: boolean;
  /** Called after complete / cancel when the host should close the SDK (modal). */
  onFinished?: (outcome: 'complete' | 'cancel' | 'error') => void;
  /** Increment to show the cancel confirmation (host asked to close). */
  cancelRequest?: number;
}

// Each flow (with its capture screens) is its own chunk in the hosted page, fetched while the app boots
// (preloadFlows). The embed library is one file (vite.lib.config.ts): there these import()s are inlined.
const loadSelfieVerification = () => import('./flows/SelfieVerificationFlow');
const loadSelfieOnly = () => import('./flows/SelfieOnlyFlow');
const loadDocumentScan = () => import('./flows/DocumentScanFlow');

/** A flow's code could not be downloaded (network). */
class FlowLoadError extends Error {}

function loaded<T>(load: () => Promise<T>): Promise<T> {
  return load().catch((e: unknown) => {
    throw new FlowLoadError(e instanceof Error ? e.message : String(e));
  });
}

/** React.lazy keeps a failed load: a retry makes new components (see FlowLoadBoundary). */
function lazyFlows() {
  return {
    SelfieVerificationFlow: lazy(() => loaded(loadSelfieVerification).then((m) => ({ default: m.SelfieVerificationFlow }))),
    SelfieOnlyFlow: lazy(() => loaded(loadSelfieOnly).then((m) => ({ default: m.SelfieOnlyFlow }))),
    DocumentScanFlow: lazy(() => loaded(loadDocumentScan).then((m) => ({ default: m.DocumentScanFlow }))),
  };
}

const FLOW_LOAD_ERROR: ClassifiedError = {
  action: 'RETRY', code: 'NETWORK_ERROR', message: null, status: -1, attemptsRemaining: null, nextStep: null, retryable: true,
};

/** Shows `fallback` when a flow's code fails to download; any other error goes up as before. */
class FlowLoadBoundary extends Component<{ children: ReactNode; fallback: ReactElement }, { error: unknown }> {
  override state = { error: null as unknown };

  static getDerivedStateFromError(error: unknown): { error: unknown } {
    return { error };
  }

  override render(): ReactNode {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (error instanceof FlowLoadError) return this.props.fallback;
    throw error;
  }
}

/** Starts downloading the code of the requested flows (a failed download is retried when the flow renders). */
function preloadFlows(flows: readonly JourneyFlow[]): void {
  const ignore = () => undefined;
  if (flows.includes('SELFIE_ID_VERIFICATION')) void loadSelfieVerification().catch(ignore);
  if (flows.some((f) => f !== 'SELFIE_ID_VERIFICATION' && isFaceFlow(f))) void loadSelfieOnly().catch(ignore);
  if (flows.some((f) => f !== 'SELFIE_ID_VERIFICATION' && !isFaceFlow(f))) void loadDocumentScan().catch(ignore);
}

type Boot =
  | { status: 'loading' }
  | { status: 'ready'; caps: Capabilities | null; branding: Branding | null; flows: JourneyFlow[] }
  | { status: 'error'; error: ClassifiedError };

function deviceId(): string | undefined {
  try {
    const key = 'camtech.device';
    let id = window.sessionStorage.getItem(key);
    if (!id) {
      id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Math.random()).slice(2);
      window.sessionStorage.setItem(key, id);
    }
    return id;
  } catch {
    return undefined;
  }
}

export function App({ config, bridge, mode, lang: langOverride, simulate, createTransport, escToCancel, onFinished, cancelRequest }: AppProps): ReactElement {
  const [lang, setLang] = useState<Lang>(langOverride ?? config.lang);
  useEffect(() => {
    if (langOverride) setLang(langOverride);
  }, [langOverride]);
  const i18n = useMemo(() => createTranslator(lang), [lang]);

  const bridgeRef = useRef(bridge);
  bridgeRef.current = bridge;
  const progress = useMemo(() => new ProgressChannel(), []);
  const client = useMemo(() => {
    const base = createTransport ? createTransport(progress) : xhrTransport(progress);
    const transport = config.debug
      ? instrumented(base, config.apiBaseUrl, (e) => bridgeRef.current.event(e))
      : base;
    return new CamtechPublicClient({
      baseUrl: config.apiBaseUrl,
      auth: { sdkToken: config.sdkToken ?? undefined },
      lang: config.lang,
      deviceId: deviceId(),
      appVersion: `camtech-web-sdk/${SDK_VERSION}`,
      transport,
    });
  }, [config.apiBaseUrl, config.sdkToken, config.debug, config.lang, createTransport, progress]);
  useEffect(() => client.setLang(lang), [client, lang]);

  const [boot, setBoot] = useState<Boot>({ status: 'loading' });
  const [bootAttempt, setBootAttempt] = useState(0);
  const [journey, dispatch] = useReducer(journeyReducer, [], initialJourney);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancelInfo = useRef<CancelInfo | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const lastStep = useRef<{ flow: JourneyFlow | null; step: StepName }>({ flow: null, step: 'LOADING' });
  const readySent = useRef(false);
  const subjectRef = config.subjectRef ?? subjectFromSdkToken(config.sdkToken);
  /** Last step that says where the user is (loading / error steps keep the previous one). */
  const [position, setPosition] = useState<{ flow: JourneyFlow | null; step: StepName | null }>({ flow: null, step: null });
  const [immersive, setImmersive] = useState(false);

  // ---------------------------------------------------------------- boot
  useEffect(() => preloadFlows(config.journey), [config.journey]);
  const [flowLoad, setFlowLoad] = useState(0);
  // A new `flowLoad` (retry after a failed download) makes new lazy components.
  const flows = useMemo(lazyFlows, [flowLoad]);

  useEffect(() => {
    let cancelled = false;
    setBoot({ status: 'loading' });
    void (async () => {
      const [capsRes, brandRes] = await Promise.allSettled([
        withRetry(() => client.capabilities()),
        withRetry(() => client.branding()),
      ]);
      if (cancelled) return;
      let caps: Capabilities | null = null;
      if (capsRes.status === 'fulfilled') caps = capsRes.value;
      else {
        const c = classifyError(capsRes.reason, 'CONFIG');
        // A session-token-only integration may not be allowed to read capabilities: let the server decide.
        const sessionOnly = !config.sdkToken && Boolean(config.sessionToken);
        if (!sessionOnly || c.action === 'RETRY') {
          bridgeRef.current.error({ code: c.code, message: c.message ?? c.code, fatal: isFatal(c.action), flow: null, status: c.status });
          setBoot({ status: 'error', error: c });
          return;
        }
      }
      const plan = planJourney(config.journey, caps, subjectRef);
      for (const s of plan.skipped) {
        bridgeRef.current.error({
          code: s.reason === 'SUBJECT_REQUIRED' ? 'SUBJECT_REF_REQUIRED' : 'FEATURE_NOT_ALLOWED',
          message: s.reason === 'SUBJECT_REQUIRED' ? `${s.flow} needs a subjectRef` : `${s.flow} is not allowed for this app`,
          fatal: false, flow: s.flow,
        });
      }
      dispatch({ type: 'RESET', flows: plan.flows });
      setBoot({ status: 'ready', caps, branding: brandRes.status === 'fulfilled' ? brandRes.value : null, flows: plan.flows });
    })();
    return () => { cancelled = true; };
  }, [client, bootAttempt, config.journey, config.sdkToken, config.sessionToken, subjectRef]);

  const branding = useMemo(
    () => mergeBranding(boot.status === 'ready' ? boot.branding : null, config.branding),
    [boot, config.branding],
  );

  useEffect(() => {
    if (boot.status !== 'ready' || readySent.current) return;
    readySent.current = true;
    if (boot.flows.length === 0) {
      bridgeRef.current.error({ code: 'NO_FLOWS', message: 'None of the requested flows is available', fatal: true, flow: null });
    }
    bridgeRef.current.ready();
  }, [boot]);

  // ---------------------------------------------------------------- journey end
  const reported = useRef(false);
  useEffect(() => {
    if (journey.status === 'complete' && boot.status === 'ready' && boot.flows.length > 0 && !reported.current) {
      reported.current = true;
      const payload: CompletePayload = { results: journey.results };
      bridgeRef.current.complete(payload);
      onFinished?.('complete');
    }
  }, [journey, boot, onFinished]);

  // ---------------------------------------------------------------- context
  const reportStep = useCallback((flow: JourneyFlow | null, step: StepName) => {
    lastStep.current = { flow, step };
    setPosition((p) => (isNeutralStep(step) ? (p.flow === flow ? p : { flow, step: null }) : { flow, step }));
    bridgeRef.current.step({ flow, step });
    if (config.debug) bridgeRef.current.event({ type: 'step', flow, step });
  }, [config.debug]);

  const reportError = useCallback<SdkContextValue['reportError']>((e) => {
    bridgeRef.current.error({ ...e, flow: e.flow ?? lastStep.current.flow });
  }, []);

  const setCancelInfo = useCallback((info: CancelInfo | null) => { cancelInfo.current = info; }, []);
  const setSessionId = useCallback((id: string | null) => { sessionIdRef.current = id; }, []);
  const requestCancel = useCallback(() => setConfirming(true), []);
  useEffect(() => {
    if (cancelRequest) setConfirming(true);
  }, [cancelRequest]);

  const running = boot.status === 'ready' && journey.status === 'running';
  const journeyView = useMemo(() => {
    if (!running || !position.flow || !position.step) return null;
    return journeyProgress(journey.flows, journey.flows.indexOf(position.flow), position.step);
  }, [running, position, journey.flows]);

  const stages = useMemo(() => journey.flows.flatMap((f) => FLOW_STAGES[f]), [journey.flows]);

  const ctx = useMemo<SdkContextValue>(() => ({
    config, client, progress, caps: boot.status === 'ready' ? boot.caps : null, branding, i18n, bridge, simulate, preview: false,
    subjectRef, setCancelInfo, reportStep, reportError, requestCancel, setSessionId, journey: journeyView, stages, setImmersive,
  }), [boot, config, client, progress, branding, i18n, bridge, simulate, subjectRef, setCancelInfo, reportStep, reportError, requestCancel,
    setSessionId, journeyView, stages]);

  const confirmCancel = async () => {
    if (journey.status !== 'running') {
      setConfirming(false);
      onFinished?.('cancel');
      return;
    }
    setCancelling(true);
    const info = cancelInfo.current;
    try {
      // Best effort: the user is leaving either way.
      await Promise.race([Promise.resolve(info?.onCancel?.()), new Promise((r) => setTimeout(r, 4000))]);
    } catch {
      /* ignore */
    }
    clearSession();
    setCancelling(false);
    setConfirming(false);
    bridgeRef.current.cancel({ flow: lastStep.current.flow, step: lastStep.current.step, sessionId: info?.sessionId ?? sessionIdRef.current });
    dispatch({ type: 'CANCEL' });
    onFinished?.('cancel');
  };

  const locales = boot.status === 'ready' ? boot.caps?.locales ?? ['en', 'ar'] : ['en', 'ar'];

  // ---------------------------------------------------------------- render
  let content: ReactElement;
  if (boot.status === 'loading') content = <LoadingScreen />;
  else if (boot.status === 'error') {
    const fatal = isFatal(boot.error.action);
    content = (
      <ErrorScreen error={boot.error} onRetry={fatal ? undefined : () => setBootAttempt((n) => n + 1)}
                   onClose={onFinished ? () => onFinished('error') : undefined} />
    );
  } else if (boot.flows.length === 0) {
    content = <ErrorScreen error={null} titleKey="nothingTitle" bodyKey="nothingBody" onClose={onFinished ? () => onFinished('error') : undefined} />;
  } else if (journey.status === 'cancelled') {
    content = (
      <ResultScreen tone="neutral" title={i18n.t('overCANCELLEDTitle')} body={i18n.t('overCANCELLEDBody')}
                    primary={{ label: i18n.t('startAgain'), onClick: () => { reported.current = false; dispatch({ type: 'RESET', flows: boot.flows }); } }} />
    );
  } else if (journey.status === 'complete') {
    content = <JourneyDoneScreen flows={journey.flows} results={journey.results} redirecting={Boolean(config.returnUrl)} />;
  } else {
    const flow = currentFlow(journey);
    const isLast = journey.index === journey.flows.length - 1;
    const done = (r: VerificationResult | DocumentScanResult | null) => dispatch({ type: 'FLOW_DONE', result: r });
    content = flow === 'SELFIE_ID_VERIFICATION'
      ? <flows.SelfieVerificationFlow key={`f${journey.index}`} isLast={isLast} onDone={done} />
      : isFaceFlow(flow)
        ? <flows.SelfieOnlyFlow key={`f${journey.index}`} flow={flow} isLast={isLast} onDone={done} />
        : <flows.DocumentScanFlow key={`f${journey.index}`} isLast={isLast} onDone={done} />;
  }

  return (
    <Shell branding={branding} i18n={i18n} mode={mode} journey={journeyView} immersive={immersive && running}
           onClose={running ? requestCancel : mode === 'modal' ? () => onFinished?.('cancel') : undefined}
           onToggleLang={locales.includes('ar') && locales.includes('en') ? () => setLang((l) => (l === 'ar' ? 'en' : 'ar')) : undefined}
           onEscape={escToCancel && running ? requestCancel : undefined}
           overlay={confirming ? (
             <ConfirmDialog title={i18n.t('cancelTitle')} body={i18n.t('cancelBody')} confirmLabel={i18n.t('cancelConfirm')}
                            cancelLabel={i18n.t('cancelKeep')} busy={cancelling} onConfirm={() => void confirmCancel()}
                            onClose={() => setConfirming(false)} />
           ) : undefined}>
      <SdkContext.Provider value={ctx}>
        <FlowLoadBoundary key={flowLoad} fallback={<ErrorScreen error={FLOW_LOAD_ERROR} onRetry={() => setFlowLoad((n) => n + 1)} />}>
          <Suspense fallback={<LoadingScreen />}>{content}</Suspense>
        </FlowLoadBoundary>
      </SdkContext.Provider>
    </Shell>
  );
}

// Static preview of one screen for the portal's branding editor: no camera, no API, sample data only.
// It re-themes live from `{ source: 'camtech-portal', type: 'branding', payload }` messages. Any origin is
// accepted here because the preview shows no user data and sends nothing back except a readiness ping.
import { useEffect, useMemo, useState, type ReactElement, type ReactNode } from 'react';
import { CamtechPublicClient, type Branding, type Lang } from '@camtech/api-client';
import type { PreviewScreen } from '../config/hosted';
import { normalizeOptions } from '../config/options';
import { noopBridge } from '../core/bridge';
import { isPortalBrandingMessage, originOf, sdkMessage } from '../core/protocol';
import { ProgressChannel } from '../core/transport';
import { createTranslator, type MessageKey } from '../i18n';
import { DEFAULT_BRANDING, mergeBranding } from '../theme/theme';
import { CardIllustration, DocumentStage, FaceIllustration, LivenessStage } from '../ui/capture/views';
import { useElementSize } from '../ui/components/hooks';
import { SdkContext, useT, type SdkContextValue } from '../ui/context';
import { ResultScreen, WelcomeScreen } from '../ui/screens/common';
import { UnderReviewScreen } from '../ui/screens/review';
import { Shell } from '../ui/Shell';

function PreviewCapture({ title, sub, children }: { title: MessageKey; sub?: string; children: ReactNode }): ReactElement {
  const { t } = useT();
  return (
    <section className="ct-capture" aria-label={t(title)}>
      <div className="ct-capture__head">
        <h1 className="ct-title ct-title--sm">{t(title)}</h1>
        {sub && <p className="ct-capture__sub">{sub}</p>}
      </div>
      {children}
      <div className="ct-capture__controls">
        <div className="ct-capture__buttons"><span /><span className="ct-shutter-placeholder" /><span /></div>
      </div>
    </section>
  );
}

function LivenessPreview(): ReactElement {
  const { t } = useT();
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <PreviewCapture title="livenessNormalTitle">
      <LivenessStage stageRef={ref} stage={size} mirrored={false} phase="NORMAL" progress={0.32} ready hintText={t('hint_GOOD')}
                     loading={false} loadingText="" flashKey={0} videoLabel={t('cameraPreview')} illustration={<FaceIllustration />} />
    </PreviewCapture>
  );
}

function DocumentPreview(): ReactElement {
  const { t } = useT();
  const [ref, size] = useElementSize<HTMLDivElement>();
  return (
    <PreviewCapture title="capture_EMIRATES_ID">
      <DocumentStage stageRef={ref} stage={size} kind="ID_CARD" ready={false} progress={0} hintText={t('dochint_ALIGN_DOCUMENT')}
                     flashKey={0} videoLabel={t('cameraPreview')} illustration={<CardIllustration />} />
    </PreviewCapture>
  );
}

export function PreviewApp({ screen, lang, parentOrigin }: { screen: PreviewScreen; lang: Lang; parentOrigin: string | null }): ReactElement {
  const [branding, setBranding] = useState<Branding>(DEFAULT_BRANDING);
  const i18n = useMemo(() => createTranslator(lang), [lang]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (isPortalBrandingMessage(e.data)) setBranding(mergeBranding(e.data.payload, null));
    };
    window.addEventListener('message', onMessage);
    // Tell the portal the preview is listening (only to its own origin, when known).
    const target = originOf(parentOrigin);
    if (window.parent !== window && target) {
      window.parent.postMessage(sdkMessage('ready', { phase: 'handshake' }), target);
    }
    return () => window.removeEventListener('message', onMessage);
  }, [parentOrigin]);

  const ctx = useMemo<SdkContextValue>(() => ({
    config: normalizeOptions({ lang }),
    client: new CamtechPublicClient({ baseUrl: 'http://preview.invalid', auth: {}, transport: () => Promise.reject(new TypeError('preview')) }),
    progress: new ProgressChannel(),
    caps: null,
    branding,
    i18n,
    bridge: noopBridge,
    simulate: 'never',
    preview: true,
    subjectRef: null,
    setCancelInfo: () => undefined,
    reportStep: () => undefined,
    reportError: () => undefined,
    requestCancel: () => undefined,
    setSessionId: () => undefined,
    journey: null,
    stages: [],
    setImmersive: () => undefined,
  }), [branding, i18n, lang]);

  const noop = () => undefined;
  const { t } = i18n;
  let content: ReactElement;
  switch (screen) {
    case 'liveness':
      content = <LivenessPreview />;
      break;
    case 'document':
      content = <DocumentPreview />;
      break;
    case 'result-approved':
      content = (
        <ResultScreen tone="success" title={branding.texts[lang]?.doneTitle || t('approvedTitle')}
                      body={branding.texts[lang]?.doneBody || t('approvedBody')} primary={{ label: t('done'), onClick: noop }} />
      );
      break;
    case 'result-review':
      content = <UnderReviewScreen sessionId="preview" doneLabel={t('done')} onDecided={noop} onResult={noop} onDone={noop} />;
      break;
    case 'result-rejected':
      content = (
        <ResultScreen tone="danger" title={t('rejectedTitle')} body={t('rejectedBody')}
                      primary={{ label: t('done'), onClick: noop }} secondary={{ label: t('startAgain'), onClick: noop }} />
      );
      break;
    default:
      content = <WelcomeScreen needs={['selfie', 'idDocument']} onStart={noop} />;
  }
  return (
    <SdkContext.Provider value={ctx}>
      <Shell branding={branding} i18n={i18n} mode="hosted" onClose={noop}>{content}</Shell>
    </SdkContext.Provider>
  );
}

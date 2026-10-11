// Hosted page entry (index.html). Three ways to run:
//  - preview:    ?preview=1&screen=…            static screen for the portal's branding editor
//  - iframe:     ?parentOrigin=https://host…    embedded by Camtech.init({ mode: 'iframe' }); options arrive by postMessage
//  - standalone: #sdkToken=… or #sessionId=…&sessionToken=…, optional returnUrl for the end
import { useEffect, useState, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Lang, Transport } from '@camtech/api-client';
import { buildReturnUrl, parseHostedLocation, stripHash } from './config/hosted';
import { DEFAULT_API_BASE_URL, normalizeOptions, type SdkConfig } from './config/options';
import { combineBridges, noopBridge, postMessageBridge, type HostBridge } from './core/bridge';
import { isHostMessage, isTrustedEvent, type CompletePayload } from './core/protocol';
import type { ProgressChannel } from './core/transport';
import { createTranslator } from './i18n';
import { PreviewApp } from './preview/PreviewApp';
import { DEFAULT_BRANDING } from './theme/theme';
import { App } from './ui/App';
import type { SimulateMode } from './ui/context';
import { Shell } from './ui/Shell';

const MOCK = import.meta.env.VITE_USE_MOCKS === 'true';
const DEV = import.meta.env.DEV;
// /env-config.js (written at container start from the environment, see docker/env-config.sh) wins over the build-time value.
const RUNTIME_API_BASE_URL = (window as { __CAMTECH_ENV__?: { VITE_API_BASE_URL?: string } }).__CAMTECH_ENV__?.VITE_API_BASE_URL;
const API_BASE_URL = RUNTIME_API_BASE_URL || (import.meta.env.VITE_API_BASE_URL as string | undefined) || DEFAULT_API_BASE_URL;
const HANDSHAKE_TIMEOUT_MS = 15000;

const launch = parseHostedLocation(window.location.href);
// Secrets never stay in the address bar (or in the history / bookmarks / screenshots).
const dropHash = (): void => {
  if (window.location.hash) window.history.replaceState(window.history.state, '', stripHash(window.location.href));
};
dropHash();
// A hash set later (same-document navigation) is never read: remove it too.
window.addEventListener('hashchange', dropHash);

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root is missing');
const root = createRoot(rootEl);

type CreateTransport = (progress: ProgressChannel) => Transport;

async function mockTransport(): Promise<CreateTransport | undefined> {
  if (!MOCK) return undefined;
  const { createMockTransport } = await import('./mocks/server');
  return (progress) => createMockTransport({ scenarios: launch.mockScenarios, progress });
}

/**
 * The hosted page always talks to its own configured API and loads models from its configured URLs: these are
 * not taken from the URL or from postMessage (a hostile embedder could otherwise redirect the camera images).
 */
function hostedConfig(raw: Record<string, unknown>): SdkConfig {
  const trusted = DEV || MOCK;
  const config = normalizeOptions({ ...raw, apiBaseUrl: trusted && raw.apiBaseUrl ? raw.apiBaseUrl : API_BASE_URL, vision: undefined },
    { apiBaseUrl: API_BASE_URL });
  if (MOCK && !config.sdkToken && !config.sessionToken) config.sdkToken = 'mock';
  return config;
}

function simulateMode(config: SdkConfig): SimulateMode {
  if (!(DEV || MOCK)) return 'never';
  if (config.simulateCamera) return 'always';
  return MOCK ? 'fallback' : 'never';
}

function setDocumentLang(lang: Lang): void {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

/** Posts the page height to the host so an inline iframe can size itself. */
function watchHeight(post: (height: number) => void): void {
  let last = 0;
  const send = () => {
    const h = Math.ceil(document.documentElement.scrollHeight);
    if (Math.abs(h - last) > 2) {
      last = h;
      post(h);
    }
  };
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(send).observe(document.body);
  send();
}

function WaitingForHost({ lang, timedOut }: { lang: Lang; timedOut: boolean }): ReactElement {
  const i18n = createTranslator(lang);
  return (
    <Shell branding={DEFAULT_BRANDING} i18n={i18n} mode="iframe">
      <section className="ct-screen ct-screen--centered" aria-busy={!timedOut}>
        <div className="ct-screen__body">
          {!timedOut && <span className="ct-spinner ct-spinner--lg" aria-hidden="true" />}
          <h1 className="ct-title">{i18n.t('waitingHostTitle')}</h1>
          <p className="ct-lead" role="status">{i18n.t(timedOut ? 'hostTimeoutBody' : 'waitingHostBody')}</p>
        </div>
      </section>
    </Shell>
  );
}

/** Embedded by Camtech.init({ mode: 'iframe' }): handshake, then options (with secrets) by postMessage. */
function IframeChild({ parentOrigin, createTransport }: { parentOrigin: string; createTransport?: CreateTransport }): ReactElement {
  const [config, setConfig] = useState<SdkConfig | null>(() => (launch.hasSecrets ? hostedConfig(launch.options) : null));
  const [lang, setLang] = useState<Lang>(config?.lang ?? (launch.options.lang === 'ar' ? 'ar' : 'en'));
  const [cancelRequest, setCancelRequest] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [bridge] = useState(() => postMessageBridge(window.parent, parentOrigin));

  useEffect(() => setDocumentLang(lang), [lang]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (!isTrustedEvent(e, parentOrigin, window.parent) || !isHostMessage(e.data)) return;
      const msg = e.data;
      if (msg.type === 'init') {
        // Non-secret options from the URL, then the host's options (which carry the secrets).
        setConfig((cur) => cur ?? hostedConfig({ ...launch.options, ...msg.payload } as Record<string, unknown>));
        if (msg.payload.lang === 'ar' || msg.payload.lang === 'en') setLang(msg.payload.lang);
      } else if (msg.type === 'setLang') {
        setLang(msg.payload.lang === 'ar' ? 'ar' : 'en');
      } else if (msg.type === 'close') {
        setCancelRequest((n) => n + 1);
      }
    };
    window.addEventListener('message', onMessage);
    bridge.post('ready', { phase: 'handshake' });
    watchHeight((height) => bridge.post('resize', { height }));
    const timer = setTimeout(() => setTimedOut(true), HANDSHAKE_TIMEOUT_MS);
    return () => {
      window.removeEventListener('message', onMessage);
      clearTimeout(timer);
    };
  }, [parentOrigin, bridge]);

  if (!config) return <WaitingForHost lang={lang} timedOut={timedOut} />;
  return (
    <App config={config} bridge={bridge} mode="iframe" lang={lang} simulate={simulateMode(config)} createTransport={createTransport}
         escToCancel cancelRequest={cancelRequest} />
  );
}

/** Opened directly: finish by going back to returnUrl (only the session id and a status are added). */
function Standalone({ createTransport }: { createTransport?: CreateTransport }): ReactElement {
  const [config] = useState(() => hostedConfig(launch.options));
  const [bridge] = useState<HostBridge>(() => {
    let sessionId: string | null = null;
    const go = (status: 'completed' | 'cancelled' | 'failed', delay: number) => {
      if (!config.returnUrl) return;
      const url = buildReturnUrl(config.returnUrl, sessionId, status);
      if (url) setTimeout(() => window.location.assign(url), delay);
    };
    const tracker: HostBridge = {
      ...noopBridge,
      complete: (p: CompletePayload) => {
        const first = p.results.find((r) => 'sessionId' in r) ?? null;
        sessionId = first && 'sessionId' in first ? first.sessionId : p.results[0] && 'scanId' in p.results[0] ? p.results[0].scanId : null;
        go('completed', 1200);
      },
      cancel: (p) => {
        sessionId = p.sessionId;
        go('cancelled', 300);
      },
    };
    return combineBridges(tracker);
  });
  useEffect(() => setDocumentLang(config.lang), [config.lang]);
  return (
    <App config={config} bridge={bridge} mode="hosted" simulate={simulateMode(config)} createTransport={createTransport}
         onFinished={(outcome) => {
           if (outcome === 'error' && config.returnUrl) {
             const url = buildReturnUrl(config.returnUrl, null, 'failed');
             if (url) window.location.assign(url);
           }
         }} />
  );
}

void (async () => {
  if (launch.preview) {
    setDocumentLang(launch.preview.lang);
    root.render(<PreviewApp screen={launch.preview.screen} lang={launch.preview.lang} parentOrigin={launch.parentOrigin} />);
    return;
  }
  const createTransport = await mockTransport();
  const embedded = window.parent !== window && launch.parentOrigin;
  if (embedded && launch.parentOrigin) {
    root.render(<IframeChild parentOrigin={launch.parentOrigin} createTransport={createTransport} />);
  } else {
    root.render(<Standalone createTransport={createTransport} />);
  }
})();

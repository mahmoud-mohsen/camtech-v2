// Renders the SDK into a Shadow DOM root (style isolation from the host page) for the inline and modal modes.
// Loaded on demand by embed.ts (lazyMount), which also defines the public mount().
import { createRoot, type Root } from 'react-dom/client';
import type { Lang } from '@camtech/api-client';
import { normalizeOptions, type CamtechOptions } from './config/options';
import { callbackBridge } from './core/bridge';
import { App } from './ui/App';
import type { SimulateMode } from './ui/context';

export interface MountHandle {
  /** Removes the SDK from the page. */
  unmount: () => void;
  setLang: (lang: Lang) => void;
}

export interface InternalMountOptions {
  mode: 'inline' | 'modal';
  escToCancel?: boolean;
  onFinished?: (outcome: 'complete' | 'cancel' | 'error') => void;
}

function simulateMode(options: CamtechOptions): SimulateMode {
  // The simulated camera only exists in development and mock builds.
  const allowed = import.meta.env.DEV || import.meta.env.VITE_USE_MOCKS === 'true';
  return allowed && options.simulateCamera ? 'always' : 'never';
}

export function mountInto(host: HTMLElement, options: CamtechOptions, internal: InternalMountOptions): MountHandle {
  const shadow = host.shadowRoot ?? host.attachShadow({ mode: 'open' });
  const container = document.createElement('div');
  container.className = 'ct-shadow-container';
  shadow.replaceChildren(container);
  const root: Root = createRoot(container);
  const config = normalizeOptions(options);
  const bridge = callbackBridge(options);
  let lang: Lang = config.lang;
  const render = () => {
    root.render(
      <App config={config} bridge={bridge} mode={internal.mode} lang={lang} simulate={simulateMode(options)}
           escToCancel={internal.escToCancel} onFinished={internal.onFinished} />,
    );
  };
  render();
  return {
    unmount: () => {
      root.unmount();
      container.remove();
    },
    setLang: (l) => {
      lang = l === 'ar' ? 'ar' : 'en';
      render();
    },
  };
}

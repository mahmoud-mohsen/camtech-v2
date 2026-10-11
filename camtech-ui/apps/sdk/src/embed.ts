// Embed loader (library entry): window.Camtech.init(options) → { open, close, destroy, setLang }.
//   modal  – full-screen overlay rendered in a Shadow DOM root (focus trapped, Esc asks to cancel)
//   inline – rendered in a Shadow DOM root inside options.container
//   iframe – loads the hosted page (options.hostedUrl); secrets are sent with postMessage after a handshake
import type { Lang } from '@camtech/api-client';
import { serializableOptions, type CamtechOptions } from './config/options';
import {
  isSdkMessage, isTrustedEvent, originOf, PROTOCOL_VERSION, type HostMessage, type SdkMessage,
} from './core/protocol';
import type { InternalMountOptions, MountHandle } from './mount';
import { releaseVision } from './ui/capture/vision';
import { SDK_VERSION } from './version';

export type { MountHandle } from './mount';
export type { CamtechOptions, CamtechCallbacks, JourneyFlow, ScanType } from './config/options';
export type {
  CancelPayload, CompletePayload, DebugEvent, DocumentScanResult, ErrorPayload, FlowResult, StepEvent, VerificationResult,
} from './core/protocol';

export const version = SDK_VERSION;

export type EmbedMode = 'modal' | 'inline' | 'iframe';

export interface EmbedOptions extends CamtechOptions {
  mode?: EmbedMode;
  /** inline (required) and iframe (optional: inline iframe instead of a modal one). Element or CSS selector. */
  container?: HTMLElement | string;
  /** iframe mode: URL of the hosted SDK page. */
  hostedUrl?: string;
  /** Close the modal automatically after complete / cancel (default true). */
  autoClose?: boolean;
}

export interface CamtechHandle {
  /** Shows the SDK (modal: opens the overlay; inline: mounts it if it was closed). */
  open: () => void;
  /** Removes the UI. The current verification can be resumed in this tab by opening again. */
  close: () => void;
  /** Closes and frees everything (listeners, face models). The handle cannot be used afterwards. */
  destroy: () => void;
  setLang: (lang: Lang) => void;
}

const OVERLAY_Z = '2147483000';

let mountModule: Promise<typeof import('./mount')> | null = null;

/**
 * Renders the SDK into `host` (Shadow DOM). The UI (React, the flows) is loaded with import() on first use, so a page
 * that only uses the iframe mode does not need it (in the one-file builds of dist-lib the import is inlined). The
 * handle works right away: calls made before the UI is ready are applied once it is.
 */
function lazyMount(host: HTMLElement, options: CamtechOptions, internal: InternalMountOptions): MountHandle {
  // An element that cannot have a shadow root still fails here, synchronously.
  if (!host.shadowRoot) host.attachShadow({ mode: 'open' });
  let handle: MountHandle | null = null;
  let removed = false;
  let lang: Lang | null = null;
  if (!mountModule) mountModule = import('./mount');
  mountModule.then((m) => {
    if (removed) return;
    handle = m.mountInto(host, options, internal);
    if (lang) handle.setLang(lang);
  }, (e: unknown) => {
    mountModule = null;
    if (removed) return;
    options.onError?.({ code: 'SDK_LOAD_FAILED', message: `camtech: the SDK could not be loaded (${e instanceof Error ? e.message : String(e)})`, fatal: true, flow: null });
    internal.onFinished?.('error');
  });
  return {
    unmount: () => {
      removed = true;
      handle?.unmount();
      handle = null;
    },
    setLang: (l) => {
      lang = l;
      handle?.setLang(l);
    },
  };
}

/**
 * npm usage: renders the SDK inline into `element` (same options as the inline embed mode).
 * Returns a handle to change the language or remove it.
 */
export function mount(element: HTMLElement, options: CamtechOptions): MountHandle {
  if (typeof document === 'undefined') throw new Error('camtech: mount() needs a browser');
  return lazyMount(element, options, { mode: 'inline' });
}

function resolveContainer(c: HTMLElement | string | undefined): HTMLElement | null {
  if (!c) return null;
  if (typeof c === 'string') return document.querySelector<HTMLElement>(c);
  return c;
}

interface ScrollLock {
  release: () => void;
}

/** Locks page scroll and makes the rest of the page inert (keyboard and screen readers stay in the modal). */
function lockPage(modal: HTMLElement): ScrollLock {
  const body = document.body;
  const previous = body.style.overflow;
  body.style.overflow = 'hidden';
  const made: Element[] = [];
  for (const el of Array.from(body.children)) {
    if (el === modal || el.hasAttribute('inert') || el.tagName === 'SCRIPT') continue;
    el.setAttribute('inert', '');
    made.push(el);
  }
  return {
    release: () => {
      body.style.overflow = previous;
      made.forEach((el) => el.removeAttribute('inert'));
    },
  };
}

export function init(options: EmbedOptions): CamtechHandle {
  if (typeof window === 'undefined' || typeof document === 'undefined') throw new Error('camtech: init() needs a browser');
  const mode: EmbedMode = options.mode ?? 'modal';
  const autoClose = options.autoClose !== false;
  let lang: Lang = options.lang === 'ar' ? 'ar' : 'en';
  let destroyed = false;
  let restoreFocus: HTMLElement | null = null;
  let scroll: ScrollLock | null = null;

  // ------------------------------------------------------------------ shadow DOM modes
  if (mode === 'modal' || mode === 'inline') {
    let host: HTMLElement | null = null;
    let handle: MountHandle | null = null;
    const ownsHost = mode === 'modal';

    const close = (): void => {
      handle?.unmount();
      handle = null;
      if (ownsHost) {
        host?.remove();
        host = null;
        scroll?.release();
        scroll = null;
        restoreFocus?.focus?.();
        restoreFocus = null;
      }
    };

    const open = (): void => {
      if (destroyed || handle) return;
      if (mode === 'inline') {
        host = resolveContainer(options.container);
        if (!host) throw new Error('camtech: inline mode needs an existing `container`');
      } else {
        restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        host = document.createElement('div');
        host.setAttribute('data-camtech', 'modal');
        host.style.cssText = `position:fixed;inset:0;z-index:${OVERLAY_Z};`;
        document.body.appendChild(host);
        scroll = lockPage(host);
      }
      handle = lazyMount(host, { ...options, lang }, {
        mode,
        escToCancel: mode === 'modal',
        onFinished: (outcome) => {
          if (mode === 'modal' && (autoClose || outcome === 'error')) setTimeout(close, outcome === 'complete' ? 1200 : 0);
        },
      });
    };

    if (mode === 'inline') open();
    return {
      open,
      close,
      destroy: () => {
        close();
        destroyed = true;
        releaseVision();
      },
      setLang: (l) => {
        lang = l === 'ar' ? 'ar' : 'en';
        handle?.setLang(lang);
      },
    };
  }

  // ------------------------------------------------------------------ iframe mode
  const hostedUrl = options.hostedUrl;
  const hostedOrigin = originOf(hostedUrl ?? null, window.location.href);
  if (!hostedUrl || !hostedOrigin) throw new Error('camtech: iframe mode needs a valid `hostedUrl` (http or https)');
  const inlineContainer = resolveContainer(options.container);
  let frame: HTMLIFrameElement | null = null;
  let wrapper: HTMLElement | null = null;
  let initSent = false;

  const post = (msg: HostMessage): void => {
    frame?.contentWindow?.postMessage(msg, hostedOrigin);
  };

  const onMessage = (e: MessageEvent): void => {
    if (!frame || !isTrustedEvent(e, hostedOrigin, frame.contentWindow) || !isSdkMessage(e.data)) return;
    const msg = e.data as SdkMessage;
    switch (msg.type) {
      case 'ready':
        if (msg.payload.phase === 'handshake') {
          if (!initSent) {
            initSent = true;
            post({ source: 'camtech-host', version: PROTOCOL_VERSION, type: 'init', payload: { ...serializableOptions(options as EmbedOptions & Record<string, unknown>), lang } });
          }
        } else {
          options.onReady?.();
        }
        break;
      case 'step':
        options.onStep?.(msg.payload);
        break;
      case 'event':
        options.onEvent?.(msg.payload);
        break;
      case 'error':
        options.onError?.(msg.payload);
        break;
      case 'resize':
        if (inlineContainer && frame) frame.style.height = `${Math.max(420, Math.min(4000, Math.round(msg.payload.height)))}px`;
        break;
      case 'complete':
        options.onComplete?.(msg.payload);
        if (!inlineContainer && autoClose) setTimeout(close, 1200);
        break;
      case 'cancel':
        options.onCancel?.(msg.payload);
        if (!inlineContainer && autoClose) close();
        break;
      default:
        break;
    }
  };

  const onKey = (e: KeyboardEvent): void => {
    // Esc while the focus is on the host page (outside the iframe): ask the SDK to confirm cancel.
    if (e.key === 'Escape' && frame && !inlineContainer) post({ source: 'camtech-host', type: 'close', payload: {} });
  };

  function close(): void {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('keydown', onKey);
    frame?.remove();
    wrapper?.remove();
    frame = null;
    wrapper = null;
    initSent = false;
    scroll?.release();
    scroll = null;
    restoreFocus?.focus?.();
    restoreFocus = null;
  }

  function open(): void {
    if (destroyed || frame) return;
    const url = new URL(hostedUrl as string, window.location.href);
    url.searchParams.set('parentOrigin', window.location.origin);
    url.searchParams.set('lang', lang);
    url.hash = '';
    frame = document.createElement('iframe');
    frame.src = url.toString();
    frame.title = 'Identity verification';
    frame.allow = 'camera; fullscreen';
    frame.setAttribute('allowfullscreen', '');
    frame.referrerPolicy = 'strict-origin';
    frame.style.cssText = 'border:0;display:block;width:100%;';
    window.addEventListener('message', onMessage);
    if (inlineContainer) {
      frame.style.height = '640px';
      inlineContainer.appendChild(frame);
    } else {
      restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      wrapper = document.createElement('div');
      wrapper.setAttribute('data-camtech', 'modal');
      wrapper.setAttribute('role', 'dialog');
      wrapper.setAttribute('aria-modal', 'true');
      wrapper.setAttribute('aria-label', 'Identity verification');
      wrapper.style.cssText = `position:fixed;inset:0;z-index:${OVERLAY_Z};background:rgba(9,12,18,.55);display:flex;align-items:center;justify-content:center;`;
      const desktop = window.matchMedia?.('(min-width: 640px) and (min-height: 640px)').matches;
      frame.style.cssText += desktop
        ? 'width:440px;height:min(780px,94vh);border-radius:16px;box-shadow:0 24px 64px rgba(0,0,0,.35);background:#fff;'
        : 'width:100%;height:100%;background:#fff;';
      wrapper.appendChild(frame);
      document.body.appendChild(wrapper);
      scroll = lockPage(wrapper);
      window.addEventListener('keydown', onKey);
      frame.addEventListener('load', () => frame?.focus(), { once: true });
    }
  }

  if (inlineContainer) open();
  return {
    open,
    close,
    destroy: () => {
      close();
      destroyed = true;
    },
    setLang: (l) => {
      lang = l === 'ar' ? 'ar' : 'en';
      if (initSent) post({ source: 'camtech-host', type: 'setLang', payload: { lang } });
    },
  };
}

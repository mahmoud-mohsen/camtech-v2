// How the SDK reports to its host: callbacks (embed / npm), postMessage (iframe) or nothing (preview).
import type { CamtechCallbacks } from '../config/options';
import {
  sdkMessage, type CancelPayload, type CompletePayload, type DebugEvent, type ErrorPayload, type SdkMessageType,
  type SdkMessagePayloads, type StepEvent,
} from './protocol';

export interface HostBridge {
  ready: () => void;
  step: (e: StepEvent) => void;
  complete: (p: CompletePayload) => void;
  cancel: (p: CancelPayload) => void;
  error: (e: ErrorPayload) => void;
  /** Debug events; only sent when `debug` is on. */
  event: (e: DebugEvent) => void;
}

function safe<A extends unknown[]>(fn: ((...args: A) => void) | undefined): (...args: A) => void {
  return (...args: A) => {
    if (!fn) return;
    try {
      fn(...args);
    } catch (e) {
      // An integrator callback must never break the SDK.
      console.error('[camtech] callback threw', e);
    }
  };
}

export function callbackBridge(cbs: CamtechCallbacks): HostBridge {
  return {
    ready: safe(cbs.onReady),
    step: safe(cbs.onStep),
    complete: safe(cbs.onComplete),
    cancel: safe(cbs.onCancel),
    error: safe(cbs.onError),
    event: safe(cbs.onEvent),
  };
}

/** Posts protocol messages to `target` with an explicit target origin (never '*'). */
export function postMessageBridge(target: Window, targetOrigin: string): HostBridge & { post: <K extends SdkMessageType>(type: K, payload: SdkMessagePayloads[K]) => void } {
  const post = <K extends SdkMessageType>(type: K, payload: SdkMessagePayloads[K]): void => {
    try {
      target.postMessage(sdkMessage(type, payload), targetOrigin);
    } catch {
      /* the host went away */
    }
  };
  return {
    post,
    ready: () => post('ready', { phase: 'loaded' }),
    step: (e) => post('step', e),
    complete: (p) => post('complete', p),
    cancel: (p) => post('cancel', p),
    error: (e) => post('error', e),
    event: (e) => post('event', e),
  };
}

export const noopBridge: HostBridge = {
  ready: () => undefined,
  step: () => undefined,
  complete: () => undefined,
  cancel: () => undefined,
  error: () => undefined,
  event: () => undefined,
};

export function combineBridges(...bridges: HostBridge[]): HostBridge {
  return {
    ready: () => bridges.forEach((b) => b.ready()),
    step: (e) => bridges.forEach((b) => b.step(e)),
    complete: (p) => bridges.forEach((b) => b.complete(p)),
    cancel: (p) => bridges.forEach((b) => b.cancel(p)),
    error: (e) => bridges.forEach((b) => b.error(e)),
    event: (e) => bridges.forEach((b) => b.event(e)),
  };
}

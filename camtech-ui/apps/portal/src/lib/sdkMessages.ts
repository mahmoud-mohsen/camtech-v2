// postMessage protocol between the portal and the SDK running in an iframe.
//   SDK -> portal: { source: 'camtech-sdk', version: 1, type, payload }
//   portal -> SDK: { source: 'camtech-portal', type: 'branding', payload: Branding }

import type { Branding } from '@camtech/api-client';

export const SDK_MESSAGE_TYPES = ['ready', 'step', 'complete', 'cancel', 'error', 'event', 'resize'] as const;
export type SdkMessageType = (typeof SDK_MESSAGE_TYPES)[number];

export interface SdkMessage {
  source: 'camtech-sdk';
  version: number;
  type: SdkMessageType;
  payload: unknown;
}

/** An API call the SDK made (type 'event'). */
export interface SdkApiCall {
  method: string;
  path: string;
  status: number | null;
  ms: number | null;
}

export interface PortalBrandingMessage {
  source: 'camtech-portal';
  type: 'branding';
  payload: Branding;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Returns the message when `data` is a well-formed SDK message, otherwise null (ignore it). */
export function parseSdkMessage(data: unknown): SdkMessage | null {
  if (!isRecord(data) || data.source !== 'camtech-sdk') return null;
  const type = data.type;
  if (typeof type !== 'string' || !(SDK_MESSAGE_TYPES as readonly string[]).includes(type)) return null;
  const version = typeof data.version === 'number' ? data.version : 1;
  return { source: 'camtech-sdk', version, type: type as SdkMessageType, payload: data.payload ?? null };
}

/** Reads an API-call description out of an 'event' payload, when it has one. */
export function asApiCall(payload: unknown): SdkApiCall | null {
  if (!isRecord(payload)) return null;
  const src = isRecord(payload.request) ? { ...payload, ...payload.request } : payload;
  if (typeof src.method !== 'string' || typeof src.path !== 'string') return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  return { method: src.method.toUpperCase(), path: src.path, status: num(src.status), ms: num(src.ms ?? src.durationMs) };
}

export interface FoundToken {
  /** Where it was found, e.g. "results[0].resultToken". */
  path: string;
  token: string;
  /** The flow it belongs to, when the surrounding object says so. */
  flow: string | null;
}

/** Collects every `resultToken` string anywhere in a payload (the shape of 'complete' may grow). */
export function findResultTokens(payload: unknown, maxDepth = 6): FoundToken[] {
  const out: FoundToken[] = [];
  const walk = (v: unknown, path: string, depth: number) => {
    if (depth > maxDepth) return;
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${path}[${i}]`, depth + 1));
      return;
    }
    if (!isRecord(v)) return;
    for (const [k, x] of Object.entries(v)) {
      const p = path ? `${path}.${k}` : k;
      if (k === 'resultToken' && typeof x === 'string' && x) {
        const flow = typeof v.flow === 'string' ? v.flow : typeof v.flowCode === 'string' ? v.flowCode : typeof v.journey === 'string' ? v.journey : null;
        out.push({ path: p, token: x, flow });
      } else {
        walk(x, p, depth + 1);
      }
    }
  };
  walk(payload, '', 0);
  return out;
}

/** One-line summary of a message for the event log. */
export function summarize(msg: SdkMessage): string {
  const p = msg.payload;
  switch (msg.type) {
    case 'ready':
      return 'SDK loaded and ready';
    case 'step': {
      if (isRecord(p)) {
        const name = p.step ?? p.screen ?? p.name;
        if (typeof name === 'string') return `Step: ${name}${typeof p.flow === 'string' ? ` (${p.flow})` : ''}`;
      }
      return 'Step changed';
    }
    case 'complete':
      return `Journey complete${findResultTokens(p).length ? ` · ${findResultTokens(p).length} result token(s)` : ''}`;
    case 'cancel':
      return 'The user closed the flow';
    case 'error': {
      if (isRecord(p)) {
        const code = typeof p.code === 'string' ? p.code : null;
        const message = typeof p.message === 'string' ? p.message : null;
        return [code, message].filter(Boolean).join(': ') || 'Error';
      }
      return typeof p === 'string' ? p : 'Error';
    }
    case 'event': {
      const call = asApiCall(p);
      if (call) return `${call.method} ${call.path}${call.status !== null ? ` → ${call.status}` : ''}${call.ms !== null ? ` · ${Math.round(call.ms)} ms` : ''}`;
      if (isRecord(p) && typeof p.name === 'string') return p.name;
      return 'Event';
    }
    case 'resize':
      return isRecord(p) && typeof p.height === 'number' ? `Resized to ${Math.round(p.height)}px` : 'Resized';
  }
}

// postMessage protocol between the embedding page (host) and the hosted SDK page in an iframe.
// Every message carries `source` and is only accepted from the expected origin and window.
import type { Decision, Lang, SessionStatus } from '@camtech/api-client';
import type { JourneyFlow, ScanType, SerializableOptions } from '../config/options';
import type { Branding } from '@camtech/api-client';

export const PROTOCOL_VERSION = 1;

export type StepName =
  | 'LOADING'
  | 'WELCOME'
  | 'CAMERA_PERMISSION'
  | 'CAMERA_PROBLEM'
  | 'LIVENESS'
  | 'LIVENESS_UPLOAD'
  | 'DOCUMENT_CHOICE'
  | 'DOCUMENT_FORMAT'
  | 'DOCUMENT_CAPTURE'
  | 'DOCUMENT_READING'
  | 'DOCUMENT_CONFIRM'
  | 'DOCUMENT_UPLOAD'
  | 'DOCUMENT_RESCAN'
  | 'SCAN_RESULT'
  | 'UNDER_REVIEW'
  | 'RESULT'
  | 'ERROR';

export interface StepEvent {
  flow: JourneyFlow | null;
  step: StepName;
}

/** Flows that end with a decision and a result token. */
export type VerificationFlow = Exclude<JourneyFlow, 'DOCUMENT_SCAN'>;

export interface VerificationResult {
  flow: VerificationFlow;
  sessionId: string;
  status: SessionStatus;
  decision: Decision | null;
  resultToken: string | null;
  resultTokenExpiresAt: string | null;
}

export interface DocumentScanResult {
  flow: 'DOCUMENT_SCAN';
  documentType: ScanType;
  /** Scan id (the front side for an Emirates ID). */
  scanId: string | null;
  /** Every scan made (front and back for an Emirates ID). */
  scanIds: string[];
  /** The reviewed details: both sides merged, with the user's corrections. */
  fields: Record<string, string>;
  /** Keys of `fields` the user changed. */
  editedFields: string[];
}

export type FlowResult = VerificationResult | DocumentScanResult;

export interface CompletePayload {
  results: FlowResult[];
}

export interface CancelPayload {
  flow: JourneyFlow | null;
  step: StepName | null;
  sessionId: string | null;
}

export interface ErrorPayload {
  /** API error code (e.g. QUOTA_EXCEEDED), camera code (e.g. CAMERA_PERMISSION_DENIED) or SDK code. */
  code: string;
  message: string;
  /** The SDK cannot continue (configuration problem, expired token...). */
  fatal: boolean;
  flow: JourneyFlow | null;
  status?: number;
}

export interface ApiCallEvent {
  type: 'api';
  method: string;
  /** Path relative to the API base, without the query string. */
  path: string;
  /** HTTP status, 0 for a network failure. */
  status: number;
  ms: number;
}

export interface StepDebugEvent {
  type: 'step';
  flow: JourneyFlow | null;
  step: StepName;
}

export type DebugEvent = ApiCallEvent | StepDebugEvent;

export interface ReadyPayload {
  /** `handshake`: the iframe is listening for `init`. `loaded`: the first screen is shown. */
  phase: 'handshake' | 'loaded';
}

export interface ResizePayload {
  height: number;
}

export interface SdkMessagePayloads {
  ready: ReadyPayload;
  step: StepEvent;
  complete: CompletePayload;
  cancel: CancelPayload;
  error: ErrorPayload;
  event: DebugEvent;
  resize: ResizePayload;
}

export type SdkMessageType = keyof SdkMessagePayloads;

export type SdkMessage = {
  [K in SdkMessageType]: { source: 'camtech-sdk'; version: typeof PROTOCOL_VERSION; type: K; payload: SdkMessagePayloads[K] };
}[SdkMessageType];

export interface HostMessagePayloads {
  init: SerializableOptions;
  setLang: { lang: Lang };
  /** Ask the SDK to show the cancel confirmation. */
  close: Record<string, never>;
}

export type HostMessage = {
  [K in keyof HostMessagePayloads]: { source: 'camtech-host'; version?: number; type: K; payload: HostMessagePayloads[K] };
}[keyof HostMessagePayloads];

export interface PortalBrandingMessage {
  source: 'camtech-portal';
  type: 'branding';
  payload: Branding;
}

const SDK_TYPES: readonly SdkMessageType[] = ['ready', 'step', 'complete', 'cancel', 'error', 'event', 'resize'];
const HOST_TYPES: readonly (keyof HostMessagePayloads)[] = ['init', 'setLang', 'close'];

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function isSdkMessage(data: unknown): data is SdkMessage {
  return isObject(data) && data.source === 'camtech-sdk' && data.version === PROTOCOL_VERSION
    && typeof data.type === 'string' && (SDK_TYPES as readonly string[]).includes(data.type) && isObject(data.payload);
}

export function isHostMessage(data: unknown): data is HostMessage {
  return isObject(data) && data.source === 'camtech-host' && typeof data.type === 'string'
    && (HOST_TYPES as readonly string[]).includes(data.type) && isObject(data.payload);
}

export function isPortalBrandingMessage(data: unknown): data is PortalBrandingMessage {
  return isObject(data) && data.source === 'camtech-portal' && data.type === 'branding' && isObject(data.payload);
}

export function sdkMessage<K extends SdkMessageType>(type: K, payload: SdkMessagePayloads[K]): SdkMessage {
  return { source: 'camtech-sdk', version: PROTOCOL_VERSION, type, payload } as SdkMessage;
}

/**
 * The origin (scheme://host[:port]) of a URL, or null when it is not an absolute http(s) URL.
 * Used for `targetOrigin` and to compare `event.origin`: never '*'.
 */
export function originOf(url: string | null | undefined, base?: string): string | null {
  if (!url) return null;
  try {
    const u = base ? new URL(url, base) : new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Accepts a message event only from `expectedOrigin` (exact match) and, when given, from `expectedSource`. */
export function isTrustedEvent(event: Pick<MessageEvent, 'origin' | 'source'>, expectedOrigin: string | null,
                               expectedSource?: MessageEventSource | null): boolean {
  if (!expectedOrigin || expectedOrigin === '*' || expectedOrigin === 'null') return false;
  if (event.origin !== expectedOrigin) return false;
  if (expectedSource !== undefined && expectedSource !== null && event.source !== expectedSource) return false;
  return true;
}

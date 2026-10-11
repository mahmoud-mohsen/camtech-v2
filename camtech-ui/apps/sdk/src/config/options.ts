import type { Branding, IdDocumentType, Lang } from '@camtech/api-client';
import type { CancelPayload, CompletePayload, DebugEvent, ErrorPayload, StepEvent } from '../core/protocol';

export type JourneyFlow = 'SELFIE_ID_VERIFICATION' | 'FACE_AUTHENTICATION' | 'LIVENESS_CHECK' | 'FACE_ENROLLMENT' | 'DOCUMENT_SCAN';
export type ScanType = 'EMIRATES_ID' | 'PASSPORT' | 'TRADE_LICENCE';

export const JOURNEY_FLOWS: readonly JourneyFlow[] = ['SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'FACE_ENROLLMENT', 'DOCUMENT_SCAN'];
export const SCAN_TYPES: readonly ScanType[] = ['EMIRATES_ID', 'PASSPORT', 'TRADE_LICENCE'];
export const ID_DOCUMENT_TYPES: readonly IdDocumentType[] = ['EMIRATES_ID', 'PASSPORT'];

export const DEFAULT_API_BASE_URL = 'http://localhost:8080/camtech-service';

/** Where the MediaPipe files are loaded from (defaults: jsDelivr for the wasm, Google storage for the models). */
export interface VisionUrls {
  wasmBaseUrl?: string;
  faceLandmarkerModelUrl?: string;
  faceDetectorModelUrl?: string;
}

export interface CamtechCallbacks {
  /** The SDK has loaded its configuration and shows its first screen. */
  onReady?: () => void;
  /** A new screen is shown. */
  onStep?: (event: StepEvent) => void;
  /** Every flow of the journey finished. Send the result tokens' session ids to your backend; it reads the results. */
  onComplete?: (result: CompletePayload) => void;
  /** The user cancelled. */
  onCancel?: (event: CancelPayload) => void;
  /** Something went wrong (`fatal`: the SDK cannot continue). */
  onError?: (error: ErrorPayload) => void;
  /** Debug events (API calls with method, path, status and duration) when `debug` is on. */
  onEvent?: (event: DebugEvent) => void;
}

/** Options shared by every integration mode. All are optional except the auth (an SDK token or a session). */
export interface CamtechOptions extends CamtechCallbacks {
  apiBaseUrl?: string;
  /** Short-lived token minted by your backend (POST /v2/sdk-tokens). Allows every flow. */
  sdkToken?: string;
  /** A selfie verification your backend already started (both required together). */
  sessionId?: string;
  sessionToken?: string;
  /** Flows to run, in order. Default: SELFIE_ID_VERIFICATION. */
  journey?: JourneyFlow[];
  /** Your id for the user (required for FACE_AUTHENTICATION and FACE_ENROLLMENT unless the SDK token carries it). */
  subjectRef?: string;
  lang?: Lang;
  /** Skip the document choice of the selfie verification. */
  documentType?: IdDocumentType;
  /** Selfie verification: register the face when approved (true) or verify only (false). Omitted: the server decides. */
  enrollFace?: boolean;
  /** Documents offered by DOCUMENT_SCAN. Default: all three. */
  scanTypes?: ScanType[];
  /** Overrides on top of the tenant branding. */
  branding?: Partial<Branding>;
  /** Emit debug events for every API call. */
  debug?: boolean;
  vision?: VisionUrls;
  /** Use a simulated camera (development and mock builds only). */
  simulateCamera?: boolean;
}

/** Normalized configuration used by the app. */
export interface SdkConfig {
  apiBaseUrl: string;
  sdkToken: string | null;
  sessionId: string | null;
  sessionToken: string | null;
  journey: JourneyFlow[];
  subjectRef: string | null;
  lang: Lang;
  documentType: IdDocumentType | null;
  /** null = not sent (the server registers the face when the app may). */
  enrollFace: boolean | null;
  scanTypes: ScanType[];
  branding: Partial<Branding> | null;
  debug: boolean;
  vision: VisionUrls;
  simulateCamera: boolean;
  /** Hosted page only: where to send the user at the end. */
  returnUrl: string | null;
}

const str = (v: unknown, max = 512): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s && s.length <= max ? s : null;
};

export function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

function list<T extends string>(v: unknown, allowed: readonly T[]): T[] {
  const raw = Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : [];
  const out: T[] = [];
  for (const item of raw) {
    const s = typeof item === 'string' ? item.trim().toUpperCase() : '';
    if ((allowed as readonly string[]).includes(s) && !out.includes(s as T)) out.push(s as T);
  }
  return out;
}

/** true / false from an option or a query value ('true' | '1' / 'false' | '0'); anything else = null. */
function flag(v: unknown): boolean | null {
  if (v === true || v === 'true' || v === '1') return true;
  if (v === false || v === 'false' || v === '0') return false;
  return null;
}

function urls(v: unknown): VisionUrls {
  if (!v || typeof v !== 'object') return {};
  const o = v as Record<string, unknown>;
  const pick = (k: string): string | undefined => {
    const s = str(o[k], 2048);
    return s && isHttpUrl(s) ? s : undefined;
  };
  return {
    wasmBaseUrl: pick('wasmBaseUrl'),
    faceLandmarkerModelUrl: pick('faceLandmarkerModelUrl'),
    faceDetectorModelUrl: pick('faceDetectorModelUrl'),
  };
}

/** Validates and normalizes untrusted options (from a URL, a postMessage or an integrator). */
export function normalizeOptions(raw: Partial<Record<keyof CamtechOptions | 'returnUrl', unknown>>, defaults: { apiBaseUrl?: string } = {}): SdkConfig {
  const base = str(raw.apiBaseUrl, 2048);
  const journey = list(raw.journey, JOURNEY_FLOWS);
  const scanTypes = list(raw.scanTypes, SCAN_TYPES);
  const docType = list(raw.documentType, ID_DOCUMENT_TYPES)[0] ?? null;
  const returnUrl = str(raw.returnUrl, 2048);
  const branding = raw.branding && typeof raw.branding === 'object' ? raw.branding as Partial<Branding> : null;
  return {
    apiBaseUrl: (base && isHttpUrl(base) ? base : defaults.apiBaseUrl ?? DEFAULT_API_BASE_URL).replace(/\/+$/, ''),
    sdkToken: str(raw.sdkToken, 4096),
    sessionId: str(raw.sessionId, 128),
    sessionToken: str(raw.sessionToken, 1024),
    journey: journey.length ? journey : ['SELFIE_ID_VERIFICATION'],
    subjectRef: str(raw.subjectRef, 128),
    lang: raw.lang === 'ar' ? 'ar' : 'en',
    documentType: docType,
    enrollFace: flag(raw.enrollFace),
    scanTypes: scanTypes.length ? scanTypes : [...SCAN_TYPES],
    branding,
    debug: raw.debug === true || raw.debug === '1' || raw.debug === 'true',
    vision: urls(raw.vision),
    simulateCamera: raw.simulateCamera === true || raw.simulateCamera === '1' || raw.simulateCamera === 'true',
    returnUrl: returnUrl && isHttpUrl(returnUrl) ? returnUrl : null,
  };
}

/** The options that can cross a postMessage boundary (no functions, no DOM nodes). */
export type SerializableOptions = Omit<CamtechOptions, keyof CamtechCallbacks>;

export function serializableOptions(o: CamtechOptions & Record<string, unknown>): SerializableOptions {
  const keys: (keyof SerializableOptions)[] = ['apiBaseUrl', 'sdkToken', 'sessionId', 'sessionToken', 'journey', 'subjectRef',
    'lang', 'documentType', 'enrollFace', 'scanTypes', 'branding', 'debug', 'vision', 'simulateCamera'];
  const out: Record<string, unknown> = {};
  for (const k of keys) if (o[k] !== undefined) out[k] = o[k];
  return JSON.parse(JSON.stringify(out)) as SerializableOptions;
}

/** Best-effort read of the subject bound to an SDK token (JWT `sub` / `subjectRef` claim). Not verified. */
export function subjectFromSdkToken(token: string | null): string | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  try {
    const b64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
    const claims = JSON.parse(json) as Record<string, unknown>;
    return str(claims.subjectRef, 128) ?? str(claims.sub, 128);
  } catch {
    return null;
  }
}

import { Http, type Transport } from './http';
import type {
  Branding, Capabilities, ChallengeSubmission, DocumentResponse, DocumentScanResponse, DocumentSubmission, FaceAuthResponse,
  FaceEnrollmentResponse, Lang, LivenessChallenge, LivenessChallengeRequest, LivenessCheckResponse, LivenessResponse, ReasonMessage,
  ScanDocumentType, SessionResult, SessionState, StartSelfieRequest, StartSelfieResponse,
} from './types';

/**
 * How the browser proves who it is, without ever holding a client secret:
 * - `sdkToken`: short-lived token your backend gets from POST /v2/sdk-tokens (all flows).
 * - `sessionToken` (+ `sessionId`): one verification your backend already started.
 * `clientId` / `clientSecret` are for server-side or test use only.
 */
export interface PublicAuth {
  sdkToken?: string;
  sessionToken?: string;
  clientId?: string;
  clientSecret?: string;
}

export interface PublicClientOptions {
  baseUrl: string;
  auth: PublicAuth;
  lang?: Lang;
  /** Stable per-browser id (not personal data). */
  deviceId?: string;
  appVersion?: string;
  transport?: Transport;
}

/** Client for the end-user /v2 API, used by the SDK screens. */
export class CamtechPublicClient {
  readonly http: Http;
  private auth: PublicAuth;
  private lang: Lang;

  constructor(private readonly opts: PublicClientOptions) {
    this.auth = { ...opts.auth };
    this.lang = opts.lang ?? 'en';
    this.http = new Http({ baseUrl: opts.baseUrl, transport: opts.transport, headers: () => this.headers() });
  }

  setLang(lang: Lang): void {
    this.lang = lang;
  }

  /** Called after a verification starts, so later calls carry its session token. */
  setSessionToken(token: string | undefined): void {
    this.auth = { ...this.auth, sessionToken: token };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Accept-Language': this.lang, 'X-Platform': 'WEB' };
    if (this.opts.deviceId) h['X-Device-Id'] = this.opts.deviceId;
    if (this.opts.appVersion) h['X-App-Version'] = this.opts.appVersion;
    if (typeof navigator !== 'undefined') {
      h['X-Device-Model'] = deviceModel();
      h['X-OS-Version'] = osVersion();
    }
    if (this.auth.sdkToken) h['X-Sdk-Token'] = this.auth.sdkToken;
    if (this.auth.clientId && this.auth.clientSecret) {
      h['X-Client-Id'] = this.auth.clientId;
      h['X-Client-Secret'] = this.auth.clientSecret;
    }
    if (this.auth.sessionToken) h.Authorization = `Bearer ${this.auth.sessionToken}`;
    return h;
  }

  capabilities(): Promise<Capabilities> {
    return this.http.json('GET', '/v2/capabilities');
  }

  branding(): Promise<Branding> {
    return this.http.json('GET', '/v2/branding');
  }

  reasonCodes(): Promise<ReasonMessage[]> {
    return this.http.json('GET', '/v2/reason-codes');
  }

  // ------------------------------------------------ selfie ID verification

  async startSelfieVerification(body: StartSelfieRequest = {}): Promise<StartSelfieResponse> {
    const res = await this.http.json<StartSelfieResponse>('POST', '/v2/selfie-verifications', { json: body });
    this.setSessionToken(res.sessionToken);
    return res;
  }

  /**
   * A random active-liveness challenge: `{ sessionId }` for a selfie verification, `{ subjectRef }` for face authentication,
   * `{ subjectRef, flow: 'FACE_ENROLLMENT' }` / `{ flow: 'LIVENESS_CHECK' }` for the other session-less flows.
   */
  createLivenessChallenge(target: LivenessChallengeRequest): Promise<LivenessChallenge> {
    return this.http.json('POST', '/v2/liveness-challenges', { json: target });
  }

  submitLiveness(sessionId: string, normal: Blob, closer: Blob | null, deviceAntispoofScore?: number,
                 signal?: AbortSignal, challenge?: ChallengeSubmission): Promise<LivenessResponse> {
    const form = new FormData();
    form.append('normal', normal, 'normal.jpg');
    // No separate closer selfie any more: "move closer" is the MOVE_CLOSER challenge. Released apps still send one.
    if (closer) form.append('closer', closer, 'closer.jpg');
    if (deviceAntispoofScore !== undefined) form.append('deviceAntispoofScore', String(deviceAntispoofScore));
    appendChallenge(form, challenge);
    return this.http.json('POST', `/v2/selfie-verifications/${enc(sessionId)}/liveness`, { form, signal });
  }

  submitDocument(sessionId: string, doc: DocumentSubmission, signal?: AbortSignal): Promise<DocumentResponse> {
    const form = new FormData();
    form.append('documentType', doc.documentType);
    form.append('document', doc.document, 'document.jpg');
    if (doc.documentBack) form.append('documentBack', doc.documentBack, 'document-back.jpg');
    for (const key of ['documentNumber', 'expiryDate', 'mrzLine2', 'fullName', 'dateOfBirth', 'issuingCountry'] as const) {
      const v = doc[key];
      if (v) form.append(key, v);
    }
    return this.http.json('POST', `/v2/selfie-verifications/${enc(sessionId)}/document`, { form, signal });
  }

  getSession(sessionId: string): Promise<SessionState> {
    return this.http.json('GET', `/v2/selfie-verifications/${enc(sessionId)}`);
  }

  getResult(sessionId: string): Promise<SessionResult> {
    return this.http.json('GET', `/v2/selfie-verifications/${enc(sessionId)}/result`);
  }

  cancel(sessionId: string): Promise<SessionState> {
    return this.http.json('POST', `/v2/selfie-verifications/${enc(sessionId)}/cancel`);
  }

  // ------------------------------------------------ face authentication

  faceAuthenticate(subjectRef: string, normal: Blob, closer: Blob | null, deviceAntispoofScore?: number,
                   signal?: AbortSignal, challenge?: ChallengeSubmission): Promise<FaceAuthResponse> {
    const form = selfieForm(subjectRef, normal, closer, deviceAntispoofScore, challenge);
    return this.http.json('POST', '/v2/face-authentications', { form, signal });
  }

  // ------------------------------------------------ liveness check / face enrollment (selfies only, one call)

  /** Proves a live person is in front of the camera; no document, no face registered. A failed liveness is a 200 REJECTED. */
  livenessCheck(subjectRef: string | null | undefined, normal: Blob, closer: Blob | null, deviceAntispoofScore?: number,
                signal?: AbortSignal, challenge?: ChallengeSubmission): Promise<LivenessCheckResponse> {
    const form = selfieForm(subjectRef, normal, closer, deviceAntispoofScore, challenge);
    return this.http.json('POST', '/v2/liveness-checks', { form, signal });
  }

  /** Registers the face for `subjectRef` (409 FACE_ALREADY_ENROLLED when it already has one). */
  faceEnroll(subjectRef: string, normal: Blob, closer: Blob | null, deviceAntispoofScore?: number,
             signal?: AbortSignal, challenge?: ChallengeSubmission): Promise<FaceEnrollmentResponse> {
    const form = selfieForm(subjectRef, normal, closer, deviceAntispoofScore, challenge);
    return this.http.json('POST', '/v2/face-enrollments', { form, signal });
  }

  // ------------------------------------------------ document scanning (server OCR)

  /** `store: false` uses /scan-only: fields are returned and nothing is saved. */
  scanDocument(image: Blob, documentType: ScanDocumentType, opts: { format?: string; subjectRef?: string; store?: boolean } = {},
               signal?: AbortSignal): Promise<DocumentScanResponse> {
    const form = new FormData();
    form.append('image', image, 'document.jpg');
    form.append('documentType', documentType);
    if (opts.format) form.append('format', opts.format);
    if (opts.subjectRef && opts.store !== false) form.append('userId', opts.subjectRef);
    const path = opts.store === false ? '/v2/documents/scan-only' : '/v2/documents/scan';
    return this.http.json('POST', path, { form, signal });
  }
}

function enc(s: string): string {
  return encodeURIComponent(s);
}

function deviceModel(): string {
  const ua = navigator.userAgent;
  const m = /\(([^)]+)\)/.exec(ua);
  return (m ? m[1] : 'Browser').slice(0, 100);
}

function osVersion(): string {
  const ua = navigator.userAgent;
  const m = /(Android [\d.]+|iPhone OS [\d_]+|CPU OS [\d_]+|Mac OS X [\d_.]+|Windows NT [\d.]+)/.exec(ua);
  return (m ? m[1].replace(/_/g, '.') : 'unknown').slice(0, 50);
}

/** Multipart body of the session-less selfie flows. */
function selfieForm(subjectRef: string | null | undefined, normal: Blob, closer: Blob | null, deviceAntispoofScore: number | undefined,
                    challenge: ChallengeSubmission | undefined): FormData {
  const form = new FormData();
  if (subjectRef) form.append('subjectRef', subjectRef);
  form.append('normal', normal, 'normal.jpg');
  // No separate closer selfie any more: "move closer" is the MOVE_CLOSER challenge. Released apps still send one.
  if (closer) form.append('closer', closer, 'closer.jpg');
  if (deviceAntispoofScore !== undefined) form.append('deviceAntispoofScore', String(deviceAntispoofScore));
  appendChallenge(form, challenge);
  return form;
}

function appendChallenge(form: FormData, challenge: ChallengeSubmission | undefined): void {
  if (!challenge) return;
  form.append('challengeId', challenge.challengeId);
  challenge.frames.forEach((f, i) => form.append('challengeFrames', f, `challenge-${i + 1}.jpg`));
}

// In-memory mock of the public /v2 API (integration guide §4), used when VITE_USE_MOCKS=true.
// It is a fetch-compatible function, so the real API client and SDK code paths run end to end.
// Scenarios: ?mock=TOO_DARK,ID_EXPIRED,… (see SCENARIOS below).
import {
  CHALLENGE_ACTIONS, type Branding, type Capabilities, type ChallengeAction, type Decision, type DocumentScanResponse,
  type LivenessMode, type NextStep, type ReasonMessage, type SessionStatus,
} from '@camtech/api-client';
import type { Transport } from '@camtech/api-client';
import type { ProgressChannel } from '../core/transport';
import { luhnValid, toIsoDate, todayIso, validateMrzLine2 } from '../core/validators';

export const SCENARIOS = [
  // liveness (first attempt fails with this code)
  'TOO_DARK', 'TOO_BRIGHT', 'BLURRY', 'FACE_TOO_SMALL', 'MULTIPLE_FACES', 'HEAD_TURNED', 'HEAD_TILTED', 'NO_FACE',
  'FACE_CHANGED', 'NOT_CLOSER', 'SPOOF_SUSPECTED', 'FACE_NOT_VISIBLE',
  // liveness: every attempt fails until none are left
  'LIVENESS_EXHAUSTED',
  // document (first attempt fails with this code)
  'ID_NUMBER_INVALID', 'MRZ_INVALID', 'ID_EXPIRED', 'PASSPORT_EXPIRED', 'DOC_NO_FACE',
  // match outcomes
  'NO_MATCH', 'REVIEW', 'REVIEW_STUCK', 'REJECTED',
  // service problems
  'FACE_SERVICE_UNAVAILABLE', 'FACE_SERVICE_ERROR', 'NETWORK', 'QUOTA_EXCEEDED', 'SESSION_EXPIRED',
  'CLIENT_AUTH_INVALID', 'SDK_TOKEN_EXPIRED', 'ORIGIN_NOT_ALLOWED', 'TOO_MANY_ATTEMPTS',
  // face authentication / OCR (NO_ENROLLED_FACE: until a FACE_ENROLLMENT or an approved selfie verification for the subject)
  'NO_ENROLLED_FACE', 'OCR_FAILED', 'NO_UPLOAD',
  // face enrollment: 409 FACE_ALREADY_ENROLLED (challenge and upload) / REVIEW with DUPLICATE_IDENTITY (+ REJECTED: rejected instead)
  'ALREADY_ENROLLED', 'DUPLICATE',
  // active liveness: first upload fails the challenge (422, uses an attempt) / reports it expired (409);
  // challenges optional; challenge endpoint not available (falls back to the normal selfie only when optional);
  // PASSIVE liveness mode (no challenge at all); only the newer actions (look up / down, smile, move closer) are drawn;
  // every challenge includes MOVE_CLOSER
  'CHALLENGE_FAILED', 'CHALLENGE_EXPIRED', 'CHALLENGE_OPTIONAL', 'NO_CHALLENGE', 'PASSIVE', 'NEW_ACTIONS', 'WITH_MOVE_CLOSER',
] as const;
export type Scenario = (typeof SCENARIOS)[number];

const LIVENESS_MESSAGES: Record<string, string> = {
  TOO_DARK: 'It is too dark. Move to a brighter place and try again.',
  TOO_BRIGHT: 'It is too bright. Avoid direct light on your face and try again.',
  BLURRY: 'The photo is blurry. Hold the phone steady and try again.',
  FACE_TOO_SMALL: 'Your face is too small in the photo. Move closer and try again.',
  MULTIPLE_FACES: 'More than one face was found. Make sure you are alone in the photo.',
  HEAD_TURNED: 'Look straight at the camera and try again.',
  HEAD_TILTED: 'Keep your head straight and try again.',
  NO_FACE: 'No face was found. Keep your face inside the oval.',
  FACE_CHANGED: 'The two selfies do not show the same person. Please try again.',
  NOT_CLOSER: 'The second selfie was not closer. Bring the phone closer for the second photo.',
  SPOOF_SUSPECTED: 'We could not confirm a live person. Please try again without screens or printed photos.',
  FACE_NOT_VISIBLE: 'We lost sight of your face during the check. Keep your face in the frame and try again.',
};
const LIVENESS_MESSAGES_AR: Record<string, string> = {
  TOO_DARK: 'المكان مظلم جدًا. انتقل إلى مكان أكثر إضاءة وحاول مرة أخرى.',
  TOO_BRIGHT: 'الإضاءة قوية جدًا. تجنب الضوء المباشر على وجهك وحاول مرة أخرى.',
  BLURRY: 'الصورة غير واضحة. ثبّت الهاتف وحاول مرة أخرى.',
  FACE_TOO_SMALL: 'وجهك صغير جدًا في الصورة. اقترب وحاول مرة أخرى.',
  MULTIPLE_FACES: 'تم العثور على أكثر من وجه. تأكد من أنك وحدك في الصورة.',
  HEAD_TURNED: 'انظر مباشرة إلى الكاميرا وحاول مرة أخرى.',
  HEAD_TILTED: 'أبقِ رأسك مستقيمًا وحاول مرة أخرى.',
  NO_FACE: 'لم يتم العثور على وجه. أبقِ وجهك داخل الشكل البيضاوي.',
  FACE_CHANGED: 'الصورتان لا تظهران الشخص نفسه. يُرجى المحاولة مرة أخرى.',
  NOT_CLOSER: 'لم تكن الصورة الثانية أقرب. قرّب الهاتف عند التقاط الصورة الثانية.',
  SPOOF_SUSPECTED: 'تعذّر التأكد من وجود شخص حقيقي. حاول مرة أخرى من دون شاشات أو صور مطبوعة.',
  FACE_NOT_VISIBLE: 'فقدنا رؤية وجهك أثناء التحقق. أبقِ وجهك داخل الإطار وحاول مرة أخرى.',
};
const DOCUMENT_MESSAGES: Record<string, [string, string]> = {
  ID_NUMBER_INVALID: ['This Emirates ID number is not valid. Check the number and try again.', 'رقم الهوية الإماراتية غير صالح. تحقق من الرقم وحاول مرة أخرى.'],
  MRZ_INVALID: ['The code lines of the passport could not be verified. Rescan the photo page.', 'تعذّر التحقق من سطور الرموز في جواز السفر. امسح صفحة الصورة مرة أخرى.'],
  ID_EXPIRED: ['This Emirates ID has expired. Please use a valid document.', 'انتهت صلاحية بطاقة الهوية الإماراتية هذه. يُرجى استخدام مستند ساري المفعول.'],
  PASSPORT_EXPIRED: ['This passport has expired. Please use a valid document.', 'انتهت صلاحية جواز السفر هذا. يُرجى استخدام مستند ساري المفعول.'],
  NO_FACE: ['No portrait photo was found on the document. Rescan it so the photo is visible.', 'لم يتم العثور على صورة شخصية على المستند. امسحه مرة أخرى بحيث تظهر الصورة.'],
};
const ALREADY_ENROLLED_MSG = ['A face is already registered for this person.', 'يوجد وجه مسجّل بالفعل لهذا الشخص.'];
const DUPLICATE_MSG = ['This face may already belong to another person.', 'قد يكون هذا الوجه مسجّلًا بالفعل لشخص آخر.'];

interface MockSession {
  id: string;
  token: string;
  status: SessionStatus;
  decision: Decision | null;
  documentType: 'EMIRATES_ID' | 'PASSPORT' | null;
  subjectRef: string | null;
  /** Register the face when approved. */
  enrollFace: boolean;
  expiresAt: number;
  livenessUsed: number;
  livenessPassed: boolean;
  documentUsed: number;
  lastDocStatus: string;
  decidedAt: string | null;
  reviewUntil: number | null;
}

const LIVENESS_MAX = 5;
const DOCUMENT_MAX = 3;

const svgLogo = 'data:image/svg+xml;base64,' + btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" width="150" height="32" viewBox="0 0 150 32"><rect width="32" height="32" rx="8" fill="#1554F0"/>'
  + '<path d="M9 16l5 5 9-10" stroke="#fff" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>'
  + '<text x="40" y="22" font-family="Arial" font-size="16" font-weight="700" fill="#101828">Demo Bank</text></svg>',
);

export const MOCK_BRANDING: Branding = {
  tenant: 'DEMO',
  displayName: 'Demo Bank',
  logoDataUrl: svgLogo,
  primaryColor: '#1554F0',
  accentColor: '#0EA5A4',
  backgroundColor: '#F4F6FB',
  surfaceColor: '#FFFFFF',
  textColor: '#101828',
  borderRadius: 14,
  fontFamily: 'Inter',
  themeMode: 'AUTO',
  supportEmail: 'support@demobank.example',
  supportUrl: 'https://demobank.example/help',
  privacyUrl: 'https://demobank.example/privacy',
  showPoweredBy: true,
  texts: {
    en: { welcomeTitle: 'Verify your identity with Demo Bank', welcomeBody: null, doneTitle: null, doneBody: null },
    ar: { welcomeTitle: 'تحقق من هويتك مع ديمو بنك', welcomeBody: null, doneTitle: null, doneBody: null },
  },
  updatedAt: '2026-10-01T10:00:00Z',
};

export interface MockOptions {
  scenarios: string[];
  progress?: ProgressChannel;
  /** Multiplies every delay (tests use 0). */
  speed?: number;
}

class MockHttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string,
              readonly extra: { step?: string; attemptsRemaining?: number; nextStep?: NextStep } = {}) {
    super(message);
  }
}

const json = (data: unknown, status = 200): Response =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

const uuid = (): string => (typeof crypto !== 'undefined' && 'randomUUID' in crypto
  ? crypto.randomUUID()
  : `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`);

const fakeJwt = (claims: Record<string, unknown>): string => {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'RS256', typ: 'JWT', kid: 'camtech-1' })}.${b64(claims)}.mock-signature`;
};

export function createMockTransport(opts: MockOptions): Transport {
  const scenarios = new Set(opts.scenarios.map((s) => s.toUpperCase()));
  const has = (s: Scenario) => scenarios.has(s);
  const speed = opts.speed ?? 1;
  const sessions = new Map<string, MockSession>();
  let serviceFailures = 0;
  let networkFailed = false;
  /** A challenge only works for the flow it was issued for. */
  const challenges = new Map<string, { actions: string[]; expiresAt: number; used: boolean; flow: LivenessFlow }>();
  /** Subjects with a registered face (FACE_ENROLLMENT, or an approved selfie verification with enrollFace). */
  const enrolled = new Set<string>();
  let selfieOnlyAttempts = 0;
  let challengeFailedOnce = false;
  let challengeExpiredOnce = false;
  type LivenessFlow = 'SELFIE_ID_VERIFICATION' | 'FACE_AUTHENTICATION' | 'LIVENESS_CHECK' | 'FACE_ENROLLMENT';
  /** PASSIVE (scenario) applies to face authentication and liveness check: selfie verification and face enrollment are always ACTIVE. */
  const livenessMode = (flow: LivenessFlow): LivenessMode =>
    ((flow === 'FACE_AUTHENTICATION' || flow === 'LIVENESS_CHECK') && has('PASSIVE') ? 'PASSIVE' : 'ACTIVE');
  const challengeRequired = (flow: LivenessFlow): boolean =>
    livenessMode(flow) === 'ACTIVE' && !has('CHALLENGE_OPTIONAL') && !has('NO_CHALLENGE');
  /** The tenant's selection; each challenge draws CHALLENGE_COUNT of them (∩ the client's supportedActions). */
  const challengeActions: ChallengeAction[] = has('NEW_ACTIONS') ? ['LOOK_UP', 'LOOK_DOWN', 'SMILE', 'MOVE_CLOSER'] : [...CHALLENGE_ACTIONS];
  const CHALLENGE_COUNT = has('NEW_ACTIONS') ? 3 : 2;
  /** Clients that send no supportedActions only know the original three. */
  const LEGACY_ACTIONS: ChallengeAction[] = ['TURN_LEFT', 'TURN_RIGHT', 'BLINK'];

  /** Validates the challenge part of a liveness upload. Errors here do not use an attempt (except CHALLENGE_FAILED). */
  function checkChallenge(form: FormData, ar: boolean, flow: LivenessFlow): string | null {
    const id = form.get('challengeId');
    if (typeof id !== 'string' || !id) {
      if (challengeRequired(flow)) throw new MockHttpError(400, 'CHALLENGE_REQUIRED', ar ? 'يلزم إجراء تحقق نشط.' : 'An active liveness challenge is required.');
      return null;
    }
    const c = challenges.get(id);
    if (!c || c.used || c.flow !== flow) throw new MockHttpError(409, 'CHALLENGE_INVALID', ar ? 'التحقق غير صالح.' : 'This challenge is not valid. Request a new one.');
    if (Date.now() > c.expiresAt || (has('CHALLENGE_EXPIRED') && !challengeExpiredOnce)) {
      challengeExpiredOnce = true;
      c.used = true;
      throw new MockHttpError(409, 'CHALLENGE_EXPIRED', ar ? 'انتهت صلاحية التحقق.' : 'The challenge has expired. Request a new one.');
    }
    const frames = form.getAll('challengeFrames');
    if (frames.length === 0 || frames.length > 16) throw new MockHttpError(400, 'VALIDATION_ERROR', 'challengeFrames: 1 to 16 images expected');
    for (const f of frames) {
      if (!(f instanceof Blob) || f.size === 0 || f.size >= 1024 * 1024) throw new MockHttpError(400, 'VALIDATION_ERROR', 'each challenge frame must be an image under 1 MB');
    }
    c.used = true;
    return id;
  }

  /** Called after the attempt is counted: the scripted challenge failure. */
  function challengeOutcome(id: string | null): boolean {
    if (id && has('CHALLENGE_FAILED') && !challengeFailedOnce) {
      challengeFailedOnce = true;
      return false;
    }
    return true;
  }
  const CHALLENGE_FAILED_MSG = ['We could not confirm the head movements. Follow the instructions and try again.', 'تعذّر تأكيد حركات الرأس. اتبع التعليمات وحاول مرة أخرى.'];

  const delay = (ms: number, signal?: AbortSignal | null) => new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms * speed);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

  const lang = (h: Headers): 'en' | 'ar' => (h.get('Accept-Language') === 'ar' ? 'ar' : 'en');

  function requireAuth(h: Headers): void {
    if (has('CLIENT_AUTH_INVALID')) throw new MockHttpError(401, 'CLIENT_AUTH_INVALID', 'The client credentials are not valid.');
    if (has('SDK_TOKEN_EXPIRED')) throw new MockHttpError(401, 'SDK_TOKEN_EXPIRED', 'The SDK token has expired.');
    if (has('ORIGIN_NOT_ALLOWED')) throw new MockHttpError(403, 'ORIGIN_NOT_ALLOWED', 'This website is not allowed to use this app.');
    if (!h.get('X-Sdk-Token') && !h.get('Authorization')) {
      throw new MockHttpError(401, 'CLIENT_AUTH_REQUIRED', 'Authentication is required.');
    }
  }

  function session(id: string, h: Headers): MockSession {
    const s = sessions.get(id);
    if (!s) throw new MockHttpError(404, 'SESSION_NOT_FOUND', 'This verification does not exist.');
    const auth = h.get('Authorization');
    if (auth && auth !== `Bearer ${s.token}`) throw new MockHttpError(401, 'SESSION_TOKEN_INVALID', 'The session token is not valid.');
    if (s.status !== 'COMPLETED' && s.status !== 'FAILED' && s.status !== 'CANCELLED' && Date.now() > s.expiresAt) {
      s.status = 'EXPIRED';
    }
    return s;
  }

  function open(s: MockSession): void {
    if (s.status === 'EXPIRED') throw new MockHttpError(410, 'SESSION_EXPIRED', 'This verification has expired. Please start again.');
    if (s.status === 'COMPLETED' || s.status === 'FAILED' || s.status === 'CANCELLED') {
      throw new MockHttpError(409, 'SESSION_CLOSED', 'This verification is closed.');
    }
  }

  /** An approved selfie verification asked to register the face makes face authentication work for its subject. */
  function registerFace(s: MockSession): void {
    if (s.decision === 'APPROVED' && s.enrollFace && s.subjectRef) enrolled.add(s.subjectRef);
  }

  function nextStepOf(s: MockSession): NextStep {
    if (s.status === 'COMPLETED' || s.status === 'FAILED' || s.status === 'EXPIRED' || s.status === 'CANCELLED') return 'DONE';
    return s.livenessPassed ? 'DOCUMENT' : 'LIVENESS';
  }

  function state(s: MockSession) {
    return {
      sessionId: s.id, flow: 'SELFIE_ID_VERIFICATION', status: s.status, decision: s.decision, documentType: s.documentType,
      expiresAt: new Date(s.expiresAt).toISOString(), nextStep: nextStepOf(s),
      steps: [
        { step: 'LIVENESS', status: s.livenessPassed ? 'PASSED' : s.livenessUsed ? 'FAILED' : 'PENDING', attemptsUsed: s.livenessUsed, attemptsMax: LIVENESS_MAX },
        { step: 'DOCUMENT', status: s.lastDocStatus, attemptsUsed: s.documentUsed, attemptsMax: DOCUMENT_MAX },
      ],
    };
  }

  /** Simulates the face service being down for the first 3 uploads (2 automatic retries + 1 manual). */
  function faceService(): void {
    if ((has('FACE_SERVICE_UNAVAILABLE') || has('FACE_SERVICE_ERROR')) && serviceFailures < 3) {
      serviceFailures++;
      if (has('FACE_SERVICE_ERROR')) throw new MockHttpError(502, 'FACE_SERVICE_ERROR', 'The face service returned an error. Please try again.');
      throw new MockHttpError(503, 'FACE_SERVICE_UNAVAILABLE', 'The face service is busy. Please try again in a few seconds.');
    }
  }

  function requireImage(form: FormData, field: string): Blob {
    const v = form.get(field);
    if (!(v instanceof Blob) || v.size === 0) throw new MockHttpError(400, 'VALIDATION_ERROR', `${field} is required`);
    if (v.size > 10 * 1024 * 1024) throw new MockHttpError(413, 'FILE_TOO_LARGE', 'The image is too large.');
    return v;
  }

  async function uploadDelay(init: RequestInit, ms: number): Promise<void> {
    if (!(init.body instanceof FormData)) return delay(ms, init.signal);
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      await delay(ms * 0.6 / steps, init.signal);
      opts.progress?.emit(i / steps);
    }
    await delay(ms * 0.4, init.signal);
  }

  type Handler = (p: string[], init: RequestInit, h: Headers, form: FormData | null, body: Record<string, unknown>) => Promise<Response>;
  const routes: { method: string; re: RegExp; fn: Handler }[] = [];
  const on = (method: string, path: string, fn: Handler) => {
    routes.push({ method, re: new RegExp('^' + path.replace(/\{[^}]+\}/g, '([^/]+)') + '$'), fn });
  };

  on('GET', '/v2/capabilities', async (_p, init, h) => {
    requireAuth(h);
    await delay(250, init.signal);
    const settings = (live: number, doc: number) => ({
      livenessMaxAttempts: live, documentMaxAttempts: doc, sessionTtlMinutes: 15, deviceAntispoofRequired: false,
      fileUploadAllowed: !has('NO_UPLOAD'),
      livenessChallengeRequired: challengeRequired('SELFIE_ID_VERIFICATION'),
    });
    const quota = { perDay: null, remainingToday: null };
    const liveness = (flow: LivenessFlow) => ({
      livenessChallengeRequired: challengeRequired(flow), livenessMode: livenessMode(flow), challengeActions,
      challengeCount: CHALLENGE_COUNT,
    });
    const caps: Capabilities = {
      tenant: 'DEMO', clientApp: 'WEB_APP', channel: 'WEB',
      flows: [
        { code: 'SELFIE_ID_VERIFICATION', documents: ['EMIRATES_ID', 'PASSPORT'], steps: ['LIVENESS', 'DOC_CAPTURE', 'FACE_DOC_MATCH'], settings: { ...settings(LIVENESS_MAX, DOCUMENT_MAX), ...liveness('SELFIE_ID_VERIFICATION'), faceEnrollmentAvailable: true }, quota },
        { code: 'FACE_AUTHENTICATION', documents: [], steps: ['LIVENESS', 'FACE_TEMPLATE_MATCH'], settings: { ...settings(1, 1), ...liveness('FACE_AUTHENTICATION') }, quota },
        { code: 'LIVENESS_CHECK', documents: [], steps: ['LIVENESS'], settings: { ...settings(1, 1), ...liveness('LIVENESS_CHECK') }, quota },
        { code: 'FACE_ENROLLMENT', documents: [], steps: ['LIVENESS', 'DEDUP_SEARCH'], settings: { ...settings(1, 1), ...liveness('FACE_ENROLLMENT') }, quota },
        { code: 'DOCUMENT_SCAN', documents: ['EMIRATES_ID', 'EMIRATES_ID_FRONT', 'EMIRATES_ID_BACK', 'PASSPORT', 'TRADE_LICENCE'], steps: ['SERVER_OCR'], settings: settings(1, 3), quota },
      ],
      features: ['FACE_COMPARE', 'MANUAL_REVIEW', 'SERVER_OCR', 'WEBHOOKS'],
      locales: ['en', 'ar'],
    };
    return json(caps);
  });

  on('POST', '/v2/liveness-challenges', async (_p, init, h, _f, body) => {
    requireAuth(h);
    await delay(250, init.signal);
    if (has('NO_CHALLENGE')) throw new MockHttpError(403, 'FEATURE_NOT_ENABLED', 'Active liveness is not enabled.');
    // sessionId → selfie verification; otherwise `flow` (default FACE_AUTHENTICATION).
    const flow = (typeof body.sessionId === 'string' ? 'SELFIE_ID_VERIFICATION' : body.flow ?? 'FACE_AUTHENTICATION') as LivenessFlow;
    if (!['SELFIE_ID_VERIFICATION', 'FACE_AUTHENTICATION', 'LIVENESS_CHECK', 'FACE_ENROLLMENT'].includes(flow)) {
      throw new MockHttpError(400, 'VALIDATION_ERROR', 'flow must be FACE_AUTHENTICATION, FACE_ENROLLMENT or LIVENESS_CHECK');
    }
    if (livenessMode(flow) === 'PASSIVE') {
      throw new MockHttpError(409, 'CHALLENGE_NOT_USED', 'This flow uses passive liveness: no challenge is needed.');
    }
    const subjectRef = typeof body.subjectRef === 'string' && body.subjectRef ? body.subjectRef : null;
    if (typeof body.sessionId === 'string') {
      const s = session(body.sessionId, h);
      open(s);
    } else if (!subjectRef && flow !== 'LIVENESS_CHECK') {
      throw new MockHttpError(400, 'VALIDATION_ERROR', 'sessionId or subjectRef is required');
    }
    if (flow === 'FACE_ENROLLMENT' && subjectRef && (has('ALREADY_ENROLLED') || enrolled.has(subjectRef))) {
      throw new MockHttpError(409, 'FACE_ALREADY_ENROLLED', ALREADY_ENROLLED_MSG[lang(h) === 'ar' ? 1 : 0]);
    }
    const supported = Array.isArray(body.supportedActions) ? body.supportedActions as string[] : LEGACY_ACTIONS;
    const pool: string[] = challengeActions.filter((a) => supported.includes(a));
    if (pool.length < CHALLENGE_COUNT) throw new MockHttpError(400, 'CHALLENGE_REQUIRED', 'Please update the app.');
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    // WITH_MOVE_CLOSER: put it first so it is always drawn (then shuffle the drawn ones again).
    if (has('WITH_MOVE_CLOSER') && pool.includes('MOVE_CLOSER')) pool.unshift(...pool.splice(pool.indexOf('MOVE_CLOSER'), 1));
    const actions = pool.slice(0, CHALLENGE_COUNT).sort(() => Math.random() - 0.5);
    const challengeId = uuid();
    const expiresAt = Date.now() + 3 * 60_000;
    challenges.set(challengeId, { actions, expiresAt, used: false, flow });
    return json({ challengeId, actions, expiresAt: new Date(expiresAt).toISOString() }, 201);
  });

  on('GET', '/v2/branding', async (_p, init, h) => {
    requireAuth(h);
    await delay(200, init.signal);
    return json(MOCK_BRANDING);
  });

  on('GET', '/v2/reason-codes', async (_p, init, h) => {
    await delay(150, init.signal);
    const msgs = lang(h) === 'ar' ? LIVENESS_MESSAGES_AR : LIVENESS_MESSAGES;
    const out: ReasonMessage[] = Object.entries(msgs).map(([code, message]) => ({ code, category: 'LIVENESS', message }));
    out.push({ code: 'FACE_ALREADY_ENROLLED', category: 'MATCH', message: ALREADY_ENROLLED_MSG[lang(h) === 'ar' ? 1 : 0] });
    return json(out);
  });

  on('POST', '/v2/selfie-verifications', async (_p, init, h, _f, body) => {
    requireAuth(h);
    await delay(400, init.signal);
    if (has('QUOTA_EXCEEDED')) throw new MockHttpError(429, 'QUOTA_EXCEEDED', 'The daily limit has been reached. Please try again later.');
    const s: MockSession = {
      id: uuid(), token: Array.from({ length: 4 }, () => Math.random().toString(36).slice(2)).join(''),
      status: 'CREATED', decision: null,
      documentType: body.documentType === 'PASSPORT' || body.documentType === 'EMIRATES_ID' ? body.documentType : null,
      subjectRef: typeof body.subjectRef === 'string' ? body.subjectRef : null,
      // Omitted = register (this mock app may register faces: faceEnrollmentAvailable).
      enrollFace: body.enrollFace !== false,
      expiresAt: Date.now() + (has('SESSION_EXPIRED') ? 75_000 : 15 * 60_000),
      livenessUsed: has('TOO_MANY_ATTEMPTS') ? LIVENESS_MAX : 0, livenessPassed: false, documentUsed: 0,
      lastDocStatus: 'PENDING', decidedAt: null, reviewUntil: null,
    };
    sessions.set(s.id, s);
    return json({
      sessionId: s.id, sessionToken: s.token, flow: 'SELFIE_ID_VERIFICATION', status: s.status, expiresAt: new Date(s.expiresAt).toISOString(),
      nextStep: 'LIVENESS', enrollFace: s.enrollFace,
    }, 201);
  });

  on('POST', '/v2/selfie-verifications/{id}/liveness', async ([id], init, h, form) => {
    const s = session(id, h);
    open(s);
    if (s.livenessPassed) throw new MockHttpError(409, 'LIVENESS_ALREADY_DONE', 'The selfies were already accepted.');
    if (s.livenessUsed >= LIVENESS_MAX) throw new MockHttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please start a new verification.');
    if (!form) throw new MockHttpError(400, 'VALIDATION_ERROR', 'multipart/form-data expected');
    requireImage(form, 'normal');
    // The closer selfie is optional: released apps still send it, the SDK uses the MOVE_CLOSER challenge instead.
    if (form.has('closer')) requireImage(form, 'closer');
    const challengeId = checkChallenge(form, lang(h) === 'ar', 'SELFIE_ID_VERIFICATION');
    await uploadDelay(init, 1600);
    faceService();
    s.livenessUsed++;
    s.status = 'IN_PROGRESS';
    if (!challengeOutcome(challengeId)) {
      const remaining = LIVENESS_MAX - s.livenessUsed;
      if (remaining <= 0) s.status = 'FAILED';
      throw new MockHttpError(422, 'CHALLENGE_FAILED', CHALLENGE_FAILED_MSG[lang(h) === 'ar' ? 1 : 0],
        { step: 'LIVENESS', attemptsRemaining: remaining, nextStep: remaining > 0 ? 'LIVENESS' : 'DONE' });
    }
    const failCode = [...scenarios].find((c) => c in LIVENESS_MESSAGES);
    const fails = has('LIVENESS_EXHAUSTED') || (failCode && s.livenessUsed === 1);
    if (fails) {
      const code = failCode ?? 'SPOOF_SUSPECTED';
      const remaining = LIVENESS_MAX - s.livenessUsed;
      if (remaining <= 0) s.status = 'FAILED';
      const msg = (lang(h) === 'ar' ? LIVENESS_MESSAGES_AR : LIVENESS_MESSAGES)[code];
      throw new MockHttpError(422, code, msg, { step: 'LIVENESS', attemptsRemaining: remaining, nextStep: remaining > 0 ? 'LIVENESS' : 'DONE' });
    }
    s.livenessPassed = true;
    return json({ sessionId: s.id, step: 'LIVENESS', result: 'PASSED', status: s.status, attemptsRemaining: LIVENESS_MAX - s.livenessUsed, nextStep: 'DOCUMENT' });
  });

  on('POST', '/v2/selfie-verifications/{id}/document', async ([id], init, h, form) => {
    const s = session(id, h);
    open(s);
    if (!s.livenessPassed) throw new MockHttpError(409, 'LIVENESS_REQUIRED', 'Take the selfies first.');
    if (s.documentUsed >= DOCUMENT_MAX) throw new MockHttpError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please start a new verification.');
    if (!form) throw new MockHttpError(400, 'VALIDATION_ERROR', 'multipart/form-data expected');
    requireImage(form, 'document');
    // Optional Emirates ID back (MRZ side); validated like the front when sent.
    if (form.get('documentBack') !== null) requireImage(form, 'documentBack');
    const type = form.get('documentType');
    if (type !== 'EMIRATES_ID' && type !== 'PASSPORT') throw new MockHttpError(400, 'VALIDATION_ERROR', 'documentType must be EMIRATES_ID or PASSPORT');
    await uploadDelay(init, 2200);
    faceService();
    s.documentType = type;
    s.documentUsed++;
    const remaining = DOCUMENT_MAX - s.documentUsed;
    const ar = lang(h) === 'ar';
    const reject = (code: string) => {
      const [enMsg, arMsg] = DOCUMENT_MESSAGES[code];
      if (remaining <= 0) {
        s.status = 'COMPLETED';
        s.decision = 'REJECTED';
        s.decidedAt = new Date().toISOString();
      }
      throw new MockHttpError(422, code, ar ? arMsg : enMsg, { step: 'DOCUMENT', attemptsRemaining: remaining, nextStep: remaining > 0 ? 'DOCUMENT' : 'DONE' });
    };
    // Server-side checks, as the real service does them.
    const num = String(form.get('documentNumber') ?? '');
    const exp = toIsoDate(String(form.get('expiryDate') ?? ''));
    if (type === 'EMIRATES_ID' && num && !luhnValid(num.replace(/\D/g, ''))) reject('ID_NUMBER_INVALID');
    const mrz = String(form.get('mrzLine2') ?? '');
    if (type === 'PASSPORT' && mrz && validateMrzLine2(mrz).errors.length) reject('MRZ_INVALID');
    if (exp && exp < todayIso()) reject(type === 'PASSPORT' ? 'PASSPORT_EXPIRED' : 'ID_EXPIRED');
    if (s.documentUsed === 1) {
      if (has('ID_NUMBER_INVALID')) reject('ID_NUMBER_INVALID');
      if (has('MRZ_INVALID')) reject('MRZ_INVALID');
      if (has('ID_EXPIRED')) reject('ID_EXPIRED');
      if (has('PASSPORT_EXPIRED')) reject('PASSPORT_EXPIRED');
      if (has('DOC_NO_FACE')) reject('NO_FACE');
    }
    const docName = type === 'PASSPORT' ? (ar ? 'جواز سفرك' : 'your passport') : (ar ? 'هويتك الإماراتية' : 'your Emirates ID');
    const borderline = ar
      ? 'لم نتمكن من تأكيد التطابق بثقة كافية. امسح المستند مرة أخرى في إضاءة جيدة ومن دون وهج.'
      : 'We could not confirm the match with enough confidence. Rescan the document in good light, without glare.';
    const mismatch = ar ? 'الوجه في الصور لا يطابق صورة المستند.' : 'Your face does not match the photo on the document.';
    let result: 'MATCH' | 'REVIEW' | 'NO_MATCH' = 'MATCH';
    let reasonCode: string | null = null;
    let message = ar ? `وجهك يطابق ${docName}.` : `Your face matches ${docName}.`;
    if (has('REJECTED')) {
      result = 'NO_MATCH';
      reasonCode = 'FACE_MISMATCH';
      message = mismatch;
    } else if (has('NO_MATCH') && s.documentUsed === 1) {
      result = 'NO_MATCH';
      reasonCode = 'FACE_MISMATCH';
      message = mismatch;
    } else if (has('REVIEW') || has('REVIEW_STUCK')) {
      result = 'REVIEW';
      reasonCode = 'LOW_CONFIDENCE';
      message = borderline;
    }
    if (result === 'MATCH') {
      s.status = 'COMPLETED';
      s.decision = 'APPROVED';
    } else if (has('REVIEW') || has('REVIEW_STUCK')) {
      // Borderline on any attempt: straight to manual review in this mock.
      s.status = 'COMPLETED';
      s.decision = 'REVIEW';
      s.reviewUntil = has('REVIEW_STUCK') ? null : Date.now() + 12_000;
    } else if (remaining <= 0) {
      s.status = 'COMPLETED';
      s.decision = 'REJECTED';
    }
    s.lastDocStatus = result;
    if (s.decision) s.decidedAt = new Date().toISOString();
    registerFace(s);
    return json({
      sessionId: s.id, step: 'DOCUMENT', result, status: s.status, decision: s.decision,
      attemptsRemaining: s.status === 'COMPLETED' ? 0 : remaining, nextStep: s.status === 'COMPLETED' ? 'DONE' : 'DOCUMENT',
      reasonCode, message,
    });
  });

  on('GET', '/v2/selfie-verifications/{id}', async ([id], init, h) => {
    const s = session(id, h);
    await delay(200, init.signal);
    return json(state(s));
  });

  on('GET', '/v2/selfie-verifications/{id}/result', async ([id], init, h) => {
    const s = session(id, h);
    await delay(300, init.signal);
    if (s.decision === 'REVIEW' && s.reviewUntil && Date.now() > s.reviewUntil) {
      s.decision = 'APPROVED';
      s.decidedAt = new Date().toISOString();
      registerFace(s);
    }
    const decided = s.decision !== null;
    return json({
      sessionId: s.id, status: s.status, decision: s.decision, decidedAt: s.decidedAt,
      resultToken: decided ? fakeJwt({ iss: 'camtech', sub: s.subjectRef, sid: s.id, flow: 'SELFIE_ID_VERIFICATION', decision: s.decision }) : null,
      resultTokenExpiresAt: decided ? new Date(Date.now() + 10 * 60_000).toISOString() : null,
    });
  });

  on('POST', '/v2/selfie-verifications/{id}/cancel', async ([id], init, h) => {
    const s = session(id, h);
    await delay(200, init.signal);
    if (s.status !== 'COMPLETED' && s.status !== 'FAILED') s.status = 'CANCELLED';
    return json(state(s));
  });

  on('POST', '/v2/face-authentications', async (_p, init, h, form) => {
    requireAuth(h);
    if (!form) throw new MockHttpError(400, 'VALIDATION_ERROR', 'multipart/form-data expected');
    const subjectRef = form.get('subjectRef');
    if (typeof subjectRef !== 'string' || !subjectRef) throw new MockHttpError(400, 'VALIDATION_ERROR', 'subjectRef is required');
    requireImage(form, 'normal');
    // The closer selfie is optional: released apps still send it, the SDK uses the MOVE_CLOSER challenge instead.
    if (form.has('closer')) requireImage(form, 'closer');
    const challengeId = checkChallenge(form, lang(h) === 'ar', 'FACE_AUTHENTICATION');
    await uploadDelay(init, 1800);
    faceService();
    const ar = lang(h) === 'ar';
    if (!challengeOutcome(challengeId)) {
      throw new MockHttpError(422, 'CHALLENGE_FAILED', CHALLENGE_FAILED_MSG[ar ? 1 : 0], { step: 'LIVENESS', nextStep: 'LIVENESS' });
    }
    if (has('NO_ENROLLED_FACE') && !enrolled.has(subjectRef)) {
      throw new MockHttpError(404, 'NO_ENROLLED_FACE', ar
        ? 'لم يتم العثور على وجه مسجّل لهذا الشخص. سجّل الوجه أولًا.'
        : 'No registered face was found for this person. Register the face first.');
    }
    const sessionId = uuid();
    const failCode = [...scenarios].find((c) => c in LIVENESS_MESSAGES);
    const rejected = has('REJECTED') || Boolean(failCode);
    const reasonCode = rejected ? failCode ?? 'FACE_MISMATCH' : null;
    return json({
      sessionId,
      decision: rejected ? 'REJECTED' : 'APPROVED',
      reasonCode,
      message: rejected
        ? (failCode ? (ar ? LIVENESS_MESSAGES_AR : LIVENESS_MESSAGES)[failCode] : ar ? 'الوجه لا يطابق الوجه المسجّل.' : 'The face does not match the enrolled face.')
        : ar ? 'تم التعرف على الوجه.' : 'Face recognised.',
      resultToken: fakeJwt({ iss: 'camtech', sub: subjectRef, sid: sessionId, flow: 'FACE_AUTHENTICATION', decision: rejected ? 'REJECTED' : 'APPROVED' }),
      resultTokenExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  });

  /**
   * Liveness check / face enrollment: one call, 200 with the decision. A failed liveness (first attempt with a liveness
   * scenario, CHALLENGE_FAILED, REJECTED) is a 200 REJECTED with the liveness reasonCode.
   */
  const selfieOnly = (flow: 'LIVENESS_CHECK' | 'FACE_ENROLLMENT'): Handler => async (_p, init, h, form) => {
    requireAuth(h);
    if (!form) throw new MockHttpError(400, 'VALIDATION_ERROR', 'multipart/form-data expected');
    const ar = lang(h) === 'ar';
    const raw = form.get('subjectRef');
    const subjectRef = typeof raw === 'string' && raw ? raw : null;
    if (flow === 'FACE_ENROLLMENT') {
      if (!subjectRef) throw new MockHttpError(400, 'VALIDATION_ERROR', 'subjectRef is required');
      if (has('ALREADY_ENROLLED') || enrolled.has(subjectRef)) throw new MockHttpError(409, 'FACE_ALREADY_ENROLLED', ALREADY_ENROLLED_MSG[ar ? 1 : 0]);
    }
    requireImage(form, 'normal');
    if (form.has('closer')) requireImage(form, 'closer');
    const challengeId = checkChallenge(form, ar, flow);
    await uploadDelay(init, 1800);
    faceService();
    selfieOnlyAttempts++;
    const failCode = [...scenarios].find((c) => c in LIVENESS_MESSAGES);
    let decision: Decision = 'APPROVED';
    let reasonCode: string | null = null;
    let message: string | null = null;
    if (!challengeOutcome(challengeId)) {
      [decision, reasonCode, message] = ['REJECTED', 'CHALLENGE_FAILED', CHALLENGE_FAILED_MSG[ar ? 1 : 0]];
    } else if (failCode && selfieOnlyAttempts === 1) {
      [decision, reasonCode, message] = ['REJECTED', failCode, (ar ? LIVENESS_MESSAGES_AR : LIVENESS_MESSAGES)[failCode]];
    } else if (flow === 'FACE_ENROLLMENT' && has('DUPLICATE')) {
      // The face already belongs to another person: a reviewer decides (rejected when manual review is off).
      [decision, reasonCode, message] = [has('REJECTED') ? 'REJECTED' : 'REVIEW', 'DUPLICATE_IDENTITY', DUPLICATE_MSG[ar ? 1 : 0]];
    } else if (has('REJECTED')) {
      [decision, reasonCode, message] = ['REJECTED', 'SPOOF_SUSPECTED', (ar ? LIVENESS_MESSAGES_AR : LIVENESS_MESSAGES).SPOOF_SUSPECTED];
    }
    if (flow === 'FACE_ENROLLMENT' && decision === 'APPROVED' && subjectRef) enrolled.add(subjectRef);
    const sessionId = uuid();
    return json({
      sessionId, decision, reasonCode, message,
      resultToken: fakeJwt({ iss: 'camtech', ...(subjectRef ? { sub: subjectRef } : {}), sid: sessionId, flow, decision }),
      resultTokenExpiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
  };
  on('POST', '/v2/liveness-checks', selfieOnly('LIVENESS_CHECK'));
  on('POST', '/v2/face-enrollments', selfieOnly('FACE_ENROLLMENT'));

  const scan = (store: boolean): Handler => async (_p, init, h, form) => {
    requireAuth(h);
    if (!form) throw new MockHttpError(400, 'VALIDATION_ERROR', 'multipart/form-data expected');
    requireImage(form, 'image');
    const type = String(form.get('documentType') ?? '');
    await uploadDelay(init, 2000);
    if (has('OCR_FAILED')) {
      return json({ success: false, documentType: type, message: lang(h) === 'ar' ? 'تعذّرت قراءة المستند.' : 'The document could not be read.' } satisfies DocumentScanResponse);
    }
    const expiry = new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    const ddmmyyyy = `${expiry.slice(8, 10)}/${expiry.slice(5, 7)}/${expiry.slice(0, 4)}`;
    const yymmdd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
    let fields: Record<string, unknown>;
    let validations: Record<string, unknown> | undefined;
    if (type === 'PASSPORT') {
      const mrz2 = buildMrzLine2('A12345678', 'EGY', '900115', 'M', yymmdd);
      fields = {
        passportNumber: 'A12345678', surname: 'HASSAN', givenNames: 'AHMED MOHAMED', nationality: 'EGY',
        dateOfBirth: '15/01/1990', sex: 'M', expiryDate: ddmmyyyy, issuingCountry: 'EGY',
        mrzLine1: 'P<EGYHASSAN<<AHMED<MOHAMED<<<<<<<<<<<<<<<<<<<', mrzLine2: mrz2,
      };
    } else if (type === 'TRADE_LICENCE') {
      fields = {
        licenseNo: '1234567', companyName: 'AL NOOR GENERAL TRADING L.L.C', legalType: 'Limited Liability Company',
        issueDate: '01/03/2025', expiryDate: ddmmyyyy, activities: ['General Trading', 'Import and Export'],
        issuer: form.get('format') ?? 'DET',
      };
    } else if (type === 'EMIRATES_ID_BACK') {
      // MRZ-derived fields are only returned when its check digits passed (mrzVerified).
      // Like the real OCR, the MRZ name has lost a word break.
      fields = {
        emiratesIdNumber: '784-1990-1234567-6', emiratesIdNumber_confidence: 0.99, cardNumber: '123456789', cardNumber_confidence: 0.99,
        dateOfBirth: '15/01/1990', dateOfBirth_confidence: 0.99, expiryDate: ddmmyyyy, expiryDate_confidence: 0.99,
        gender: 'Male', genderAr: 'ذكر', nationalityCode: 'EGY', fullNameEn: 'AHMEDMOHAMED HASSAN', fullNameEn_confidence: 0.64,
        mrzVerified: true, occupation: 'Engineer', occupation_confidence: 0.72, employer: 'Demo Company LLC', employer_confidence: 0.72,
        issuingPlaceAr: 'دبي', issuingPlaceAr_confidence: 0.7,
      };
      validations = {
        emiratesIdNumber: { status: 'VALID', source: 'MRZ_VERIFIED', message: 'Check digit matches' },
        dateOfBirth: { status: 'VALID', source: 'MRZ_VERIFIED', message: null },
        expiryDate: { status: 'VALID', source: 'MRZ_VERIFIED', message: null },
        cardNumber: { status: 'VALID', source: 'MRZ_VERIFIED', message: null },
        gender: { status: 'VALID', source: 'MRZ', message: null },
        fullNameEn: { status: 'UNVERIFIED', source: 'MRZ', message: null },
      };
    } else if (type === 'EMIRATES_ID_FRONT' || type === 'EMIRATES_ID') {
      // A typical front read: the printed English name has OCR typos, the expiry day is misread.
      fields = {
        emiratesIdNumber: '784-1990-1234567-6', emiratesIdNumber_confidence: 0.97, fullNameEn: 'Ahmed Mohaned Hassan', fullNameEn_confidence: 0.77,
        fullNameAr: 'أحمد محمد حسن', fullNameAr_confidence: 0.72, nationality: 'Egypt', nationality_confidence: 0.95, nationalityAr: 'مصر',
        dateOfBirth: '15/01/1990', dateOfBirth_confidence: 0.95, issueDate: '01/02/2025', issueDate_confidence: 0.95,
        expiryDate: `2${ddmmyyyy.slice(1)}`, expiryDate_confidence: 0.95,
      };
      validations = {
        emiratesIdNumber: { status: 'VALID', source: 'PATTERN', message: 'Check digit matches' },
        dateOfBirth: { status: 'VALID', source: 'LAYOUT', message: null },
        fullNameEn: { status: 'UNVERIFIED', source: 'LAYOUT', message: null },
      };
    } else {
      fields = {
        idNumber: '784-1990-1234567-6', nameEn: 'Ahmed Mohamed Hassan', nameAr: 'أحمد محمد حسن', nationality: 'Egypt',
        dateOfBirth: '15/01/1990', expiryDate: ddmmyyyy, sex: 'M',
      };
    }
    return json({
      success: true, scanId: store ? uuid() : null, documentType: type, confidence: 0.94, fields, validations,
      rawText: null, processingTimeMs: 1830, message: 'Document processed successfully',
    } satisfies DocumentScanResponse);
  };
  on('POST', '/v2/documents/scan', scan(true));
  on('POST', '/v2/documents/scan-only', scan(false));

  return async (url, init) => {
    const u = new URL(url, 'http://mock.local');
    const path = u.pathname.replace(/^.*?(\/v2\/)/, '/v2/');
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = new Headers(init.headers);
    if (has('NETWORK') && !networkFailed && method === 'POST') {
      networkFailed = true;
      await delay(600, init.signal);
      throw new TypeError('Failed to fetch');
    }
    for (const r of routes) {
      const m = r.method === method ? r.re.exec(path) : null;
      if (!m) continue;
      const form = init.body instanceof FormData ? init.body : null;
      let body: Record<string, unknown> = {};
      if (typeof init.body === 'string') {
        try {
          body = JSON.parse(init.body) as Record<string, unknown>;
        } catch {
          body = {};
        }
      }
      try {
        return await r.fn(m.slice(1).map(decodeURIComponent), init, headers, form, body);
      } catch (e) {
        if (e instanceof MockHttpError) {
          return json({ code: e.code, message: e.message, ...e.extra }, e.status);
        }
        throw e;
      }
    }
    return json({ code: 'NOT_FOUND', message: `No mock for ${method} ${path}` }, 404);
  };
}

/** Builds a valid TD3 line 2 (used for realistic passport OCR output). */
export function buildMrzLine2(docNo: string, nationality: string, dob: string, sex: string, expiry: string): string {
  const cd = (s: string) => {
    const w = [7, 3, 1];
    let sum = 0;
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      const v = c >= '0' && c <= '9' ? +c : c >= 'A' && c <= 'Z' ? c.charCodeAt(0) - 55 : 0;
      sum += v * w[i % 3];
    }
    return String(sum % 10);
  };
  const doc = docNo.padEnd(9, '<').slice(0, 9);
  const personal = '<'.repeat(14);
  const p1 = doc + cd(doc);
  const p2 = dob + cd(dob);
  const p3 = expiry + cd(expiry);
  const p4 = personal + '<';
  const composite = cd(p1 + p2 + p3 + p4);
  return `${p1}${nationality}${p2}${sex}${p3}${p4}${composite}`;
}

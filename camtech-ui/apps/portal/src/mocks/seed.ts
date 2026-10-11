// Builds the believable in-memory datasets for mock mode: NOQODI (a busy tenant) and DEMO (a brand-new one).
import type {
  DocumentOcrSettings,
  AuditEvent, Branding, ClientApp, Credential, Decision, Entitlement, LivenessPolicy, LivenessSettings, SessionStatus, TenantCheck, TenantInfo, TenantScanDetail,
  RetentionPolicy, ReviewOwner, TenantSessionDetail, TenantStep, TenantUser, Webhook, WebhookDelivery,
} from '@camtech/api-client';
import { buildRecords, RETENTION_POLICIES, type MockDocument, type MockMedia, type MockParty, type MockReviewCase } from './records';
import { DEMO_PASSWORD, DEMO_USERS } from './demoUsers';
import { defaultBranding, DOC_FAILS, LIVENESS_FAILS, NOQODI_LOGO, REASON_CODES } from './catalog';
import { CHALLENGE_ACTIONS } from '@camtech/api-client';
import { STARTING_POLICY, startingPolicy } from '../lib/liveness';
import { createRng, type Rng } from './rand';

export interface MockCredential extends Credential {
  clientAppId: number;
}

/** Liveness limits (set by camtech) and the tenant's own settings for one flow. */
export interface MockFlowLiveness {
  policy: LivenessPolicy;
  /** null = not saved yet (the policy defaults apply). */
  settings: LivenessSettings | null;
  updatedAt: string | null;
}

export interface MockTenant {
  info: TenantInfo;
  entitlements: Entitlement[];
  apps: ClientApp[];
  credentials: MockCredential[];
  webhooks: Webhook[];
  deliveries: WebhookDelivery[];
  sessions: TenantSessionDetail[];
  scans: TenantScanDetail[];
  audit: AuditEvent[];
  /** null = server defaults. */
  branding: Branding | null;
  /** Keyed by liveness flow code (SELFIE_ID_VERIFICATION, FACE_AUTHENTICATION, LIVENESS_CHECK, FACE_ENROLLMENT). */
  liveness: Record<string, MockFlowLiveness>;
  /** Scan review settings; absent = server defaults. */
  ocrSettings?: { settings: DocumentOcrSettings; updatedAt: string } | null;
  /** Portal sign-in accounts. */
  users: MockUser[];
  documents: MockDocument[];
  parties: MockParty[];
  reviewCases: MockReviewCase[];
  /** Who decides the verifications in review (review.owner). */
  reviewOwner: ReviewOwner;
  /** document.expiry_warning_days */
  expiryWarningDays: number;
  /** dedup.enabled */
  dedupEnabled: boolean;
  retention: RetentionPolicy[];
}

/** A portal sign-in account (the password is kept in clear: mock only). */
export interface MockUser extends TenantUser {
  password: string;
  failedLogins: number;
}

export interface MockDb {
  tenants: Map<string, MockTenant>;
  /** Bearer token -> signed-in user. */
  tokens: Map<string, { tenantCode: string; userId: number; expiresAt: number }>;
  seq: {
    app: number; credential: number; webhook: number; delivery: number; audit: number; scan: number; entitlement: number; user: number;
    media: number; document: number; party: number; template: number; reviewCase: number; reviewAction: number;
  };
  /** Stored images of every tenant. */
  media: Map<number, MockMedia>;
}

const MIN = 60_000;
const DAY = 86_400_000;

const FIRST = ['Ahmed', 'Mohammed', 'Khalid', 'Omar', 'Yousef', 'Saeed', 'Rashid', 'Faisal', 'Arjun', 'Karim', 'Fatima', 'Aisha', 'Mariam', 'Noura', 'Layla', 'Sara', 'Reem', 'Priya', 'Hana', 'Grace'];
const LAST = ['Al Tajribi', 'Al Namouthaji', 'Al Iftiradi', 'Al Mithali', 'Testwell', 'Sampleson', 'Demo-Kumar', 'Placeholder'];
const AR_NAMES: Record<string, string> = { Ahmed: 'أحمد', Mohammed: 'محمد', Khalid: 'خالد', Omar: 'عمر', Fatima: 'فاطمة', Aisha: 'عائشة', Mariam: 'مريم', Noura: 'نورة', Sara: 'سارة', Reem: 'ريم' };
const message = (code: string) => REASON_CODES.find((r) => r.code === code)?.messageEn ?? null;

const iso = (t: number) => new Date(t).toISOString();

/** Starting values of the liveness policy for every liveness flow, nothing saved by the tenant. */
const startingLiveness = (): Record<string, MockFlowLiveness> => ({
  SELFIE_ID_VERIFICATION: { policy: structuredClone(STARTING_POLICY), settings: null, updatedAt: null },
  FACE_AUTHENTICATION: { policy: startingPolicy('FACE_AUTHENTICATION'), settings: null, updatedAt: null },
  LIVENESS_CHECK: { policy: startingPolicy('LIVENESS_CHECK'), settings: null, updatedAt: null },
  FACE_ENROLLMENT: { policy: structuredClone(STARTING_POLICY), settings: null, updatedAt: null },
});

function eidNumber(rng: Rng): string {
  return `784-${rng.int(1965, 2004)}-${String(rng.int(0, 9999999)).padStart(7, '0')}-${rng.int(0, 9)}`;
}

function passportNumber(rng: Rng): string {
  return `${rng.pick(['N', 'P', 'K', 'A'])}${String(rng.int(1000000, 9999999))}`;
}

type Outcome = 'APPROVED' | 'REVIEW_OPEN' | 'REVIEW_APPROVED' | 'REVIEW_REJECTED' | 'REJECTED' | 'EXPIRED' | 'FAILED' | 'IN_PROGRESS' | 'CREATED' | 'CANCELLED';

const LIVENESS_CHECKS = ['FACE_DETECTED', 'BRIGHTNESS', 'SHARPNESS', 'HEAD_POSE', 'SAME_PERSON', 'CLOSER_AREA_GAIN'];
const CHECK_FOR_REASON: Record<string, string> = {
  TOO_DARK: 'BRIGHTNESS', TOO_BRIGHT: 'BRIGHTNESS', BLURRY: 'SHARPNESS', NOT_CLOSER: 'CLOSER_AREA_GAIN', HEAD_TURNED: 'HEAD_POSE',
  FACE_TOO_SMALL: 'FACE_DETECTED', FACE_CHANGED: 'SAME_PERSON', MULTIPLE_FACES: 'FACE_DETECTED', SPOOF_SUSPECTED: 'SAME_PERSON',
  ID_NUMBER_INVALID: 'ID_NUMBER_FORMAT', ID_EXPIRED: 'DOC_EXPIRY', MRZ_INVALID: 'MRZ_CHECKSUM', DOC_NO_FACE: 'DOC_DETECTED',
};

function checks(codes: string[], failing: string | null, failOutcome: 'FAIL' | 'REVIEW' = 'FAIL'): TenantCheck[] {
  return codes.map((c) => ({ checkCode: c, outcome: c === failing ? failOutcome : 'PASS' }));
}

interface SessionCtx {
  rng: Rng;
  now: number;
  apps: ClientApp[];
}

/** forced = the outcome to build (random otherwise). */
function buildSession(ctx: SessionCtx, createdAt: number, flowCode: string, forced?: Outcome): TenantSessionDetail {
  const { rng, now } = ctx;
  const app = rng.pick(ctx.apps);
  const isAuth = flowCode === 'FACE_AUTHENTICATION';
  const isCheck = flowCode === 'LIVENESS_CHECK';
  const isEnrollment = flowCode === 'FACE_ENROLLMENT';
  // Selfie-only flows capture no document.
  const selfieOnly = isAuth || isCheck || isEnrollment;
  const recent = now - createdAt < 20 * MIN;
  let outcome: Outcome = rng.weighted<Outcome>([
    ['APPROVED', 62], ['REVIEW_OPEN', 3], ['REVIEW_APPROVED', 4], ['REVIEW_REJECTED', 2], ['REJECTED', 8], ['EXPIRED', 8], ['FAILED', 6], ['CANCELLED', 3],
  ]);
  if (recent) outcome = rng.weighted<Outcome>([['IN_PROGRESS', 5], ['CREATED', 2], ['APPROVED', 3]]);
  if ((isAuth || isCheck) && outcome.startsWith('REVIEW')) outcome = 'APPROVED';
  // A selfie verification has nothing to reject once the liveness passed.
  if (isCheck && outcome === 'REJECTED') outcome = 'APPROVED';
  if (forced) outcome = forced;

  const first = rng.pick(FIRST);
  const name = `${first} ${rng.pick(LAST)}`;
  const docType = selfieOnly ? null : rng.chance(0.78) ? 'EMIRATES_ID' : 'PASSPORT';
  const docNumber = docType === 'EMIRATES_ID' ? eidNumber(rng) : docType === 'PASSPORT' ? passportNumber(rng) : null;
  const steps: TenantStep[] = [];
  let t = createdAt + rng.int(5, 40) * 1000;
  const stepAt = (dur: number) => {
    const start = t;
    t += dur;
    return { startedAt: iso(start), endedAt: iso(t) };
  };

  // ---- liveness attempts
  const livenessFails = outcome === 'FAILED' ? 5 : outcome === 'CREATED' ? 0 : rng.weighted([[0, 60], [1, 25], [2, 10], [3, 5]]);
  let attemptNo = 0;
  for (let i = 0; i < livenessFails; i++) {
    const reason = rng.pick(LIVENESS_FAILS);
    steps.push({
      stepCode: 'LIVENESS', attemptNo: ++attemptNo, status: 'FAILED', reasonCode: reason, reasonMessage: message(reason), ...stepAt(rng.int(1500, 4000)),
      checks: checks(LIVENESS_CHECKS, CHECK_FOR_REASON[reason] ?? 'FACE_DETECTED'), imagesCount: 2,
    });
    t += rng.int(5, 30) * 1000;
  }
  const livenessPassed = outcome !== 'FAILED' && outcome !== 'CREATED' && !(outcome === 'CANCELLED' && rng.chance(0.4));
  if (livenessPassed) {
    steps.push({ stepCode: 'LIVENESS', attemptNo: ++attemptNo, status: 'PASSED', reasonCode: null, reasonMessage: null, ...stepAt(rng.int(1200, 3000)), checks: checks(LIVENESS_CHECKS, null), imagesCount: 2 });
  }
  const livenessAttempts = attemptNo;
  let documentAttempts = 0;

  let decision: Decision | null = null;
  let decidedBy: 'SYSTEM' | 'REVIEWER' = 'SYSTEM';
  let decisionReason: string | null = null;
  let review: TenantSessionDetail['review'] = null;
  let status: SessionStatus;
  /** A borderline session in manual review: still open, or already decided by a reviewer. */
  const inReview = (): { decision: Decision; decidedBy: 'SYSTEM' | 'REVIEWER'; review: NonNullable<TenantSessionDetail['review']> } => {
    const openedAt = iso(t);
    if (outcome === 'REVIEW_OPEN') return { decision: 'REVIEW', decidedBy: 'SYSTEM', review: { status: rng.chance(0.5) ? 'OPEN' : 'IN_REVIEW', openedAt, decidedAt: null } };
    t += rng.int(20, 600) * MIN;
    const decided: Decision = outcome === 'REVIEW_APPROVED' ? 'APPROVED' : 'REJECTED';
    return { decision: decided, decidedBy: 'REVIEWER', review: { status: decided, openedAt, decidedAt: iso(Math.min(t, now - MIN)) } };
  };
  const finished = livenessPassed && outcome !== 'IN_PROGRESS' && outcome !== 'EXPIRED' && outcome !== 'CANCELLED';

  if (isCheck) {
    if (finished) decision = 'APPROVED';
  } else if (isEnrollment) {
    // The face must not belong to someone else: a match goes to review (or is rejected), a reviewer's approval registers it.
    if (finished) {
      const reviewish = outcome.startsWith('REVIEW');
      const rejected = outcome === 'REJECTED';
      const dup = reviewish || rejected;
      steps.push({
        stepCode: 'DEDUP_SEARCH', attemptNo: 1, status: rejected ? 'FAILED' : reviewish ? 'REVIEW' : 'PASSED', reasonCode: dup ? 'DUPLICATE_IDENTITY' : null,
        reasonMessage: dup ? message('DUPLICATE_IDENTITY') : null, ...stepAt(rng.int(150, 500)),
        checks: [{ checkCode: 'DEDUP_1N', outcome: rejected ? 'FAIL' : reviewish ? 'REVIEW' : 'PASS' }], imagesCount: 0,
      });
      if (reviewish) {
        ({ decision, decidedBy, review } = inReview());
        decisionReason = 'DUPLICATE_IDENTITY';
      } else {
        decision = rejected ? 'REJECTED' : 'APPROVED';
        decisionReason = rejected ? 'DUPLICATE_IDENTITY' : null;
      }
    }
  } else if (isAuth) {
    if (finished) {
      const match = outcome === 'REJECTED' ? 'FAIL' : 'PASS';
      steps.push({
        stepCode: 'FACE_TEMPLATE_MATCH', attemptNo: 1, status: match === 'PASS' ? 'PASSED' : 'FAILED', reasonCode: match === 'PASS' ? null : 'FACE_MISMATCH',
        reasonMessage: match === 'PASS' ? null : message('FACE_MISMATCH'), ...stepAt(rng.int(300, 900)), checks: [{ checkCode: 'TEMPLATE_SIMILARITY', outcome: match }], imagesCount: 0,
      });
      decision = match === 'PASS' ? 'APPROVED' : 'REJECTED';
      decisionReason = match === 'PASS' ? null : 'FACE_MISMATCH';
    }
  } else if (livenessPassed && outcome !== 'IN_PROGRESS') {
    // ---- document attempts
    const docFails = outcome === 'EXPIRED' || outcome === 'CANCELLED' ? rng.int(0, 1) : rng.weighted([[0, 75], [1, 20], [2, 5]]);
    for (let i = 0; i < docFails; i++) {
      const reason = docType === 'PASSPORT' ? rng.pick(['MRZ_INVALID', 'PASSPORT_EXPIRED', 'DOC_NO_FACE']) : rng.pick(DOC_FAILS);
      steps.push({
        stepCode: 'DOC_CAPTURE', attemptNo: ++documentAttempts, status: 'FAILED', reasonCode: reason, reasonMessage: message(reason), ...stepAt(rng.int(2000, 6000)),
        checks: checks(['DOC_DETECTED', 'ID_NUMBER_FORMAT', 'MRZ_CHECKSUM', 'DOC_EXPIRY'], CHECK_FOR_REASON[reason] ?? 'DOC_EXPIRY'), imagesCount: 1,
      });
      t += rng.int(10, 60) * 1000;
    }
    if (outcome !== 'EXPIRED' && outcome !== 'CANCELLED') {
      steps.push({
        stepCode: 'DOC_CAPTURE', attemptNo: ++documentAttempts, status: 'PASSED', reasonCode: null, reasonMessage: null, ...stepAt(rng.int(2000, 5000)),
        checks: checks(['DOC_DETECTED', docType === 'PASSPORT' ? 'MRZ_CHECKSUM' : 'ID_NUMBER_FORMAT', 'DOC_EXPIRY'], null), imagesCount: 1,
      });
      steps.push({ stepCode: 'DOC_VALIDATION', attemptNo: 1, status: 'PASSED', reasonCode: null, reasonMessage: null, ...stepAt(rng.int(200, 600)), checks: checks(['OCR_CONFIDENCE', 'DOC_EXPIRY'], null), imagesCount: 0 });
      const reviewish = outcome.startsWith('REVIEW');
      const rejected = outcome === 'REJECTED';
      const matchReason = rejected ? 'FACE_MISMATCH' : reviewish ? rng.pick(['LOW_CONFIDENCE', 'LOW_CONFIDENCE', 'DUPLICATE_IDENTITY']) : null;
      steps.push({
        stepCode: 'FACE_DOC_MATCH', attemptNo: 1, status: rejected ? 'FAILED' : reviewish ? 'REVIEW' : 'PASSED', reasonCode: matchReason,
        reasonMessage: matchReason ? message(matchReason) : null, ...stepAt(rng.int(400, 1200)),
        checks: [{ checkCode: 'FACE_SIMILARITY', outcome: rejected ? 'FAIL' : reviewish ? 'REVIEW' : 'PASS' }], imagesCount: 0,
      });
      steps.push({
        stepCode: 'DEDUP_SEARCH', attemptNo: 1, status: matchReason === 'DUPLICATE_IDENTITY' ? 'REVIEW' : 'PASSED', reasonCode: null, reasonMessage: null, ...stepAt(rng.int(150, 500)),
        checks: [{ checkCode: 'DEDUP_MATCH', outcome: matchReason === 'DUPLICATE_IDENTITY' ? 'REVIEW' : 'PASS' }], imagesCount: 0,
      });
      if (reviewish) {
        ({ decision, decidedBy, review } = inReview());
        decisionReason = matchReason;
      } else {
        decision = rejected ? 'REJECTED' : 'APPROVED';
        decisionReason = rejected ? 'FACE_MISMATCH' : null;
      }
    }
  }

  switch (outcome) {
    case 'EXPIRED':
      status = 'EXPIRED';
      decision = null;
      break;
    case 'FAILED':
      status = 'FAILED';
      break;
    case 'CANCELLED':
      status = 'CANCELLED';
      decision = null;
      break;
    case 'IN_PROGRESS':
      status = steps.length ? 'IN_PROGRESS' : 'CREATED';
      decision = null;
      break;
    case 'CREATED':
      status = 'CREATED';
      decision = null;
      break;
    default:
      status = decision ? 'COMPLETED' : 'IN_PROGRESS';
  }

  const completedAt = status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED' ? iso(Math.min(t, now - 1000)) : status === 'EXPIRED' ? iso(createdAt + 15 * MIN) : null;
  const decidedAt = decision ? (review?.decidedAt ?? completedAt ?? iso(t)) : null;
  const events: TenantSessionDetail['events'] = [];
  if (review) events.push({ eventType: 'REVIEW_OPENED', status: 'DELIVERED', createdAt: review.openedAt });
  if (status === 'COMPLETED' || status === 'FAILED' || status === 'CANCELLED') events.push({ eventType: 'SESSION_COMPLETED', status: rng.chance(0.94) ? 'DELIVERED' : 'FAILED', createdAt: completedAt ?? iso(t) });
  if (status === 'EXPIRED') events.push({ eventType: 'SESSION_EXPIRED', status: 'DELIVERED', createdAt: completedAt ?? iso(t) });
  if (review?.decidedAt) events.push({ eventType: 'REVIEW_DECIDED', status: 'DELIVERED', createdAt: review.decidedAt });

  const platform = app.channel === 'WEB' ? 'WEB' : rng.chance(0.55) ? 'IOS' : 'ANDROID';
  // Face registration: always for FACE_ENROLLMENT; for a selfie ID verification unless the app asked enrollFace: false.
  const enrollFace = isEnrollment || (flowCode === 'SELFIE_ID_VERIFICATION' && createdAt % 7 !== 0);
  return {
    publicId: rng.uuid(),
    flowCode,
    status,
    decision,
    channel: app.channel,
    clientAppCode: app.code,
    subjectRef: `usr_${rng.int(1000, 99999)}`,
    partyName: status === 'CREATED' ? null : name,
    documentType: docType,
    documentNumber: docNumber,
    livenessAttempts,
    documentAttempts,
    createdAt: iso(createdAt),
    expiresAt: iso(createdAt + 15 * MIN),
    completedAt,
    device: {
      platform,
      osVersion: platform === 'IOS' ? rng.pick(['17.6', '18.1', '18.3']) : platform === 'ANDROID' ? rng.pick(['13', '14', '15']) : rng.pick(['Chrome 141', 'Safari 18', 'Edge 141']),
      appVersion: app.channel === 'WEB' ? null : rng.pick(['4.12.0', '4.13.1', '4.14.0']),
      model: platform === 'IOS' ? rng.pick(['iPhone 15', 'iPhone 14 Pro', 'iPhone 16']) : platform === 'ANDROID' ? rng.pick(['Pixel 8', 'Galaxy S24', 'Galaxy A54']) : null,
    },
    steps,
    document:
      docType && documentAttempts > 0
        ? {
            docTypeCode: docType,
            documentNumber: docNumber,
            issuingCountry: docType === 'EMIRATES_ID' ? 'ARE' : rng.pick(['ARE', 'IND', 'EGY', 'JOR', 'GBR']),
            expiryDate: iso(now + rng.int(60, 1500) * DAY).slice(0, 10),
            status: decision === 'APPROVED' ? 'VERIFIED' : decision === 'REJECTED' ? 'REJECTED' : 'CAPTURED',
          }
        : null,
    decisionDetail: decision && decidedAt ? { decision, decidedBy, reason: decisionReason, decidedAt } : null,
    review,
    events,
    enrollFace,
    faceRegistered: enrollFace && decision === 'APPROVED',
  };
}

function scanFields(rng: Rng, docType: string, name: string): TenantScanDetail['fields'] {
  const f = (fieldCode: string, value: string | null, lang: string | null = null): TenantScanDetail['fields'][number] => {
    const confidence = Math.round(rng.float(0.62, 0.995) * 1000) / 1000;
    return { fieldCode, lang, value, confidence, validationStatus: value === null ? 'MISSING' : confidence < 0.75 ? 'LOW_CONFIDENCE' : 'VALID' };
  };
  const first = name.split(' ')[0];
  if (docType === 'TRADE_LICENCE') {
    return [
      f('LICENCE_NUMBER', String(rng.int(100000, 9999999))),
      f('TRADE_NAME', rng.pick(['SAMPLE TRADING L.L.C', 'DEMO LOGISTICS FZE', 'EXAMPLE TECH SOLUTIONS L.L.C'])),
      f('TRADE_NAME_AR', rng.pick(['سامبل للتجارة ذ.م.م', 'ديمو للخدمات اللوجستية م.م.ح']), 'ar'),
      f('LEGAL_FORM', rng.pick(['Limited Liability Company', 'Free Zone Establishment'])),
      f('ACTIVITY', rng.pick(['General Trading', 'Software Development', 'Freight Forwarding'])),
      f('EXPIRY_DATE', iso(Date.now() + rng.int(30, 700) * DAY).slice(0, 10)),
    ];
  }
  if (docType === 'PASSPORT') {
    const num = passportNumber(rng);
    return [
      f('FULL_NAME', name.toUpperCase()),
      f('PASSPORT_NUMBER', num),
      f('NATIONALITY', rng.pick(['IND', 'EGY', 'JOR', 'GBR', 'PAK'])),
      f('DATE_OF_BIRTH', `${rng.int(1965, 2004)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`),
      f('GENDER', rng.pick(['M', 'F'])),
      f('EXPIRY_DATE', iso(Date.now() + rng.int(60, 3000) * DAY).slice(0, 10)),
      f('MRZ_LINE_1', `P<${'X'.repeat(3)}${name.toUpperCase().replace(/ /g, '<')}`.padEnd(44, '<').slice(0, 44)),
      f('MRZ_LINE_2', `${num}<0XXX${rng.int(100000, 999999)}${'<'.repeat(20)}`.slice(0, 44)),
    ];
  }
  const back = docType === 'EMIRATES_ID_BACK';
  return [
    ...(back ? [] : [f('FULL_NAME', name), f('FULL_NAME_AR', AR_NAMES[first] ?? null, 'ar')]),
    f('ID_NUMBER', eidNumber(rng)),
    ...(back
      ? [f('CARD_NUMBER', String(rng.int(10000000, 99999999))), f('OCCUPATION', rng.pick(['Engineer', 'Accountant', 'Manager'])), f('EMPLOYER', rng.pick(['Sample Trading LLC', 'Demo Logistics FZE']))]
      : [f('NATIONALITY', rng.pick(['United Arab Emirates', 'India', 'Egypt'])), f('DATE_OF_BIRTH', `${rng.int(1965, 2004)}-0${rng.int(1, 9)}-1${rng.int(0, 9)}`), f('GENDER', rng.pick(['M', 'F']))]),
    f('ISSUE_DATE', iso(Date.now() - rng.int(100, 1500) * DAY).slice(0, 10)),
    f('EXPIRY_DATE', iso(Date.now() + rng.int(30, 1500) * DAY).slice(0, 10)),
  ];
}

function buildScans(rng: Rng, now: number, count: number, seqStart: number): TenantScanDetail[] {
  const out: TenantScanDetail[] = [];
  for (let i = 0; i < count; i++) {
    const docTypeCode = rng.weighted([['EMIRATES_ID', 40], ['EMIRATES_ID_FRONT', 10], ['EMIRATES_ID_BACK', 8], ['PASSPORT', 22], ['TRADE_LICENCE', 20]] as const);
    const failed = rng.chance(0.08);
    const name = `${rng.pick(FIRST)} ${rng.pick(LAST)}`;
    const fields = failed ? [] : scanFields(rng, docTypeCode, name);
    const confs = fields.map((f) => f.confidence ?? 0);
    // Every seventh Emirates ID scan waits for review: OCR misread the ID number's check digit.
    // (Chosen by index, not by rng, so the rest of the seeded data stays the same.)
    const inReview = !failed && docTypeCode.startsWith('EMIRATES_ID') && i % 7 === 3;
    const idField = fields.find((f) => f.fieldCode === 'ID_NUMBER');
    if (inReview && idField?.value) {
      idField.value = idField.value.slice(0, -1) + String((Number(idField.value.slice(-1)) + 3) % 10);
      idField.validationStatus = 'INVALID';
      idField.validationMessage = 'Not a valid Emirates ID number (15 digits starting with 784 and a matching check digit)';
      idField.confidence = 0.2;
    }
    out.push({
      id: seqStart + i,
      publicId: rng.uuid(),
      docTypeCode,
      status: failed ? 'FAILED' : inReview ? 'NEEDS_REVIEW' : 'COMPLETED',
      reviewReasons: inReview ? [{ code: 'FIELD_INVALID', field: 'ID_NUMBER', message: idField?.validationMessage ?? null }] : [],
      issues: [],
      confidence: failed ? null : Math.round((confs.reduce((a, b) => a + b, 0) / Math.max(1, confs.length)) * 1000) / 1000,
      processingMs: rng.int(900, 5200),
      errorMessage: failed ? rng.pick(['The document could not be read. Make sure it is flat and in focus.', 'No document was found in the image.']) : null,
      createdAt: iso(now - rng.int(10, 60 * 24 * 60) * MIN),
      fields,
    });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function perms(info: TenantInfo, deny: string[] = []) {
  return [...info.flows.filter((f) => f.enabled).map((f) => f.code), ...info.features.filter((f) => f.enabled).map((f) => f.code)].map((featureCode) => ({
    featureCode,
    allowed: !deny.includes(featureCode),
  }));
}

function buildNoqodi(db: MockDb, now: number): MockTenant {
  const rng = createRng(20261008);
  const info: TenantInfo = {
    code: 'NOQODI',
    name: 'Noqodi',
    status: 'ACTIVE',
    createdAt: iso(now - 160 * DAY),
    flows: [
      { code: 'SELFIE_ID_VERIFICATION', name: 'Selfie ID verification', enabled: true },
      { code: 'FACE_AUTHENTICATION', name: 'Face authentication', enabled: true },
      { code: 'FACE_ENROLLMENT', name: 'Face registration', enabled: true },
      { code: 'LIVENESS_CHECK', name: 'Liveness check', enabled: true },
      { code: 'DOCUMENT_SCAN', name: 'Document scan', enabled: true },
    ],
    documentTypes: [
      { code: 'EMIRATES_ID', name: 'Emirates ID', enabled: true },
      { code: 'PASSPORT', name: 'Passport', enabled: true },
      { code: 'TRADE_LICENCE', name: 'Trade licence', enabled: true },
    ],
    features: [
      { code: 'SERVER_OCR', enabled: true },
      { code: 'DEDUP_SEARCH', enabled: true },
      { code: 'MANUAL_REVIEW', enabled: true },
      { code: 'WEBHOOKS', enabled: true },
      { code: 'FILE_UPLOAD', enabled: true },
      { code: 'DEVICE_ANTISPOOF', enabled: false },
    ],
  };
  const apps: ClientApp[] = [
    {
      id: db.seq.app++, code: 'MOBILE_APP', name: 'Noqodi wallet app', channel: 'MOBILE', platform: 'iOS / Android', appIdentifier: 'com.noqodi.wallet', allowedOrigins: [],
      status: 'ACTIVE', permissions: perms(info, ['FILE_UPLOAD', 'DOCUMENT_SCAN']), credentialsCount: 0, createdAt: iso(now - 150 * DAY),
    },
    {
      id: db.seq.app++, code: 'WEB_PORTAL', name: 'Noqodi web portal', channel: 'WEB', platform: 'Browser', appIdentifier: null,
      allowedOrigins: ['https://portal.noqodi.example', 'http://localhost:5175'], status: 'ACTIVE', permissions: perms(info, ['FACE_AUTHENTICATION']), credentialsCount: 0, createdAt: iso(now - 120 * DAY),
    },
    {
      id: db.seq.app++, code: 'MERCHANT_ONBOARDING', name: 'Merchant onboarding (old)', channel: 'WEB', platform: 'Browser', appIdentifier: null,
      allowedOrigins: ['https://merchants.noqodi.example'], status: 'DISABLED', permissions: perms(info, ['FACE_AUTHENTICATION', 'SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT', 'LIVENESS_CHECK']), credentialsCount: 0, createdAt: iso(now - 140 * DAY),
    },
  ];
  const credentials: MockCredential[] = [];
  const addCred = (app: ClientApp, status: Credential['status'], ageDays: number, lastUsedMin: number | null, expiresInDays: number | null = null) => {
    credentials.push({
      id: db.seq.credential++, clientAppId: app.id, keyId: `ck_${rng.hex(20)}`, status, createdAt: iso(now - ageDays * DAY),
      expiresAt: expiresInDays === null ? null : iso(now + expiresInDays * DAY), lastUsedAt: lastUsedMin === null ? null : iso(now - lastUsedMin * MIN),
    });
  };
  addCred(apps[0], 'REVOKED', 140, 60 * 24 * 40);
  addCred(apps[0], 'ACTIVE', 40, 3);
  addCred(apps[1], 'ACTIVE', 100, 12, 265);
  addCred(apps[2], 'ACTIVE', 130, 60 * 24 * 21);
  for (const a of apps) a.credentialsCount = credentials.filter((c) => c.clientAppId === a.id).length;

  // ---- sessions over 120 days, busier recently and on weekdays
  const sessions: TenantSessionDetail[] = [];
  const ctx: SessionCtx = { rng, now, apps: apps.filter((a) => a.status === 'ACTIVE').concat(apps[0]) };
  for (let d = 119; d >= 0; d--) {
    const dayStart = now - d * DAY;
    const weekday = new Date(dayStart).getDay();
    const base = d < 30 ? 9 : 5;
    const n = Math.max(0, Math.round(base * (weekday === 5 || weekday === 6 ? 0.55 : 1) + rng.int(-3, 4)));
    for (let i = 0; i < n; i++) {
      const createdAt = d === 0 ? now - rng.int(1, 600) * MIN : dayStart - rng.int(0, 24 * 60) * MIN;
      sessions.push(buildSession(ctx, createdAt, rng.chance(0.78) ? 'SELFIE_ID_VERIFICATION' : 'FACE_AUTHENTICATION'));
    }
  }
  // A couple of open ones right now, to show cancel.
  sessions.push(buildSession({ ...ctx, rng }, now - 3 * MIN, 'SELFIE_ID_VERIFICATION'));
  sessions.push(buildSession({ ...ctx, rng }, now - 6 * MIN, 'SELFIE_ID_VERIFICATION'));
  // Liveness checks and face registrations, newer flows (own generator, so the data above stays the same).
  const newRng = createRng(20261010);
  const newCtx: SessionCtx = { ...ctx, rng: newRng };
  for (let i = 0; i < 24; i++) {
    sessions.push(buildSession(newCtx, now - newRng.int(30, 21 * 24 * 60) * MIN, newRng.chance(0.5) ? 'FACE_ENROLLMENT' : 'LIVENESS_CHECK'));
  }
  // One face registration waiting for a reviewer: the face already belongs to someone else.
  sessions.push(buildSession(newCtx, now - 45 * MIN, 'FACE_ENROLLMENT', 'REVIEW_OPEN'));
  sessions.push(buildSession(newCtx, now - 2 * 60 * MIN, 'FACE_ENROLLMENT', 'APPROVED'));
  sessions.push(buildSession(newCtx, now - 3 * 60 * MIN, 'LIVENESS_CHECK', 'APPROVED'));
  sessions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ---- webhooks and deliveries (derived from session events)
  const webhooks: Webhook[] = [
    { id: db.seq.webhook++, url: 'https://api.noqodi.example/hooks/camtech', events: ['SESSION_COMPLETED', 'SESSION_EXPIRED', 'REVIEW_OPENED', 'REVIEW_DECIDED'], status: 'ACTIVE', createdAt: iso(now - 120 * DAY), lastDeliveryAt: null, lastStatus: null, consecutiveFailures: 0, failing: false },
    { id: db.seq.webhook++, url: 'https://staging-api.noqodi.example/hooks/camtech', events: ['REVIEW_DECIDED'], status: 'DISABLED', createdAt: iso(now - 90 * DAY), lastDeliveryAt: null, lastStatus: null, consecutiveFailures: 0, failing: false },
  ];
  const deliveries: WebhookDelivery[] = [];
  let eventId = 50_000;
  for (const s of sessions.slice(0, 220)) {
    for (const e of s.events) {
      const failed = e.status === 'FAILED';
      const recent = now - Date.parse(e.createdAt) < 3 * 3600_000;
      const status: WebhookDelivery['status'] = failed ? (recent ? 'RETRYING' : 'FAILED') : 'DELIVERED';
      deliveries.push({
        id: db.seq.delivery++, webhookId: webhooks[0].id, eventType: e.eventType, eventId: eventId++, attempt: failed ? (recent ? rng.int(1, 3) : 6) : 1,
        httpStatus: failed ? rng.pick([500, 502, 503, 504, null]) : 200, status,
        error: failed ? rng.pick(['HTTP 503 Service Unavailable', 'Read timed out after 10 s', 'HTTP 500 Internal Server Error', 'Connection refused']) : null,
        nextRetryAt: status === 'RETRYING' ? iso(now + rng.int(1, 30) * MIN) : null, createdAt: e.createdAt,
      });
    }
  }
  deliveries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  webhooks[0].lastDeliveryAt = deliveries[0]?.createdAt ?? null;
  webhooks[0].lastStatus = deliveries[0]?.status ?? null;
  webhooks[1].lastDeliveryAt = iso(now - 60 * DAY);
  webhooks[1].lastStatus = 'FAILED';
  // An operations endpoint that keeps failing: flagged on the webhooks page and on the Overview.
  const opsHook: Webhook = {
    id: db.seq.webhook++, url: 'https://ops.noqodi.example/hooks/unreachable', events: ['SCAN_REVIEW_REQUIRED', 'DOCUMENT_EXPIRING', 'PARTY_ERASED'], status: 'ACTIVE',
    createdAt: iso(now - 20 * DAY), lastDeliveryAt: iso(now - 40 * MIN), lastStatus: 'FAILED', consecutiveFailures: 7, failing: true,
  };
  webhooks.push(opsHook);
  for (let i = 0; i < 7; i++) {
    deliveries.push({
      id: db.seq.delivery++, webhookId: opsHook.id, eventType: i % 2 ? 'DOCUMENT_EXPIRING' : 'SCAN_REVIEW_REQUIRED', eventId: eventId++, attempt: 6, httpStatus: null, status: 'FAILED',
      error: 'Connection refused', nextRetryAt: null, createdAt: iso(now - 40 * MIN - i * 9 * 60 * MIN),
    });
  }
  deliveries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  // ---- usage today
  const today = new Date(now).toISOString().slice(0, 10);
  const todays = sessions.filter((s) => s.createdAt.slice(0, 10) === today);
  const scans = buildScans(rng, now, 72, db.seq.scan);
  db.seq.scan += 72;
  // A selfie ID verification that registers the face also counts one face registration.
  const used = (code: string) =>
    code === 'DOCUMENT_SCAN'
      ? scans.filter((s) => s.createdAt.slice(0, 10) === today).length
      : todays.filter((s) => s.flowCode === code || (code === 'FACE_ENROLLMENT' && s.flowCode === 'SELFIE_ID_VERIFICATION' && s.enrollFace)).length;
  const entitlements: Entitlement[] = [
    ...info.flows.map((f) => ({ featureType: 'FLOW' as const, featureCode: f.code, enabled: f.enabled, quotaPerDay: f.code === 'DOCUMENT_SCAN' ? 200 : null })),
    ...info.documentTypes.map((d) => ({ featureType: 'DOCUMENT' as const, featureCode: d.code, enabled: d.enabled, quotaPerDay: null })),
    ...info.features.map((f) => ({ featureType: 'FEATURE' as const, featureCode: f.code, enabled: f.enabled, quotaPerDay: null })),
  ].map((e) => ({ id: db.seq.entitlement++, ...e, usedToday: e.featureType === 'FLOW' ? used(e.featureCode) : 0, validUntil: e.featureCode === 'DOCUMENT_SCAN' ? iso(now + 200 * DAY).slice(0, 10) : null }));

  // ---- audit
  const audit: AuditEvent[] = [];
  const addAudit = (minutesAgo: number, actorType: AuditEvent['actorType'], actor: string, action: string, entity: string | null, entityId: string | null, details: Record<string, unknown> | null) => {
    audit.push({ id: db.seq.audit++, actorType, actor, action, entity, entityId, ipAddress: actorType === 'SYSTEM' ? null : `10.20.${rng.int(0, 255)}.${rng.int(1, 254)}`, details, at: iso(now - minutesAgo * MIN) });
  };
  addAudit(160 * 24 * 60, 'ADMIN', 'admin', 'TENANT_UPDATED', 'TENANT', 'NOQODI', { status: 'ACTIVE' });
  addAudit(150 * 24 * 60, 'ADMIN', 'admin', 'CLIENT_APP_CREATED', 'CLIENT_APP', String(apps[0].id), { code: 'MOBILE_APP', channel: 'MOBILE' });
  addAudit(140 * 24 * 60, 'ADMIN', 'admin', 'CREDENTIAL_CREATED', 'CREDENTIAL', String(credentials[0].id), { keyId: credentials[0].keyId });
  addAudit(120 * 24 * 60, 'TENANT_USER', 'developer', 'CLIENT_APP_CREATED', 'CLIENT_APP', String(apps[1].id), { code: 'WEB_PORTAL', channel: 'WEB' });
  addAudit(120 * 24 * 60 - 5, 'TENANT_USER', 'developer', 'WEBHOOK_CREATED', 'WEBHOOK', String(webhooks[0].id), { url: webhooks[0].url });
  addAudit(100 * 24 * 60, 'TENANT_USER', 'developer', 'CREDENTIAL_CREATED', 'CREDENTIAL', String(credentials[2].id), { keyId: credentials[2].keyId, expiresAt: credentials[2].expiresAt });
  addAudit(90 * 24 * 60, 'TENANT_USER', 'developer', 'WEBHOOK_CREATED', 'WEBHOOK', String(webhooks[1].id), { url: webhooks[1].url });
  addAudit(60 * 24 * 60, 'TENANT_USER', 'developer', 'WEBHOOK_UPDATED', 'WEBHOOK', String(webhooks[1].id), { status: 'DISABLED' });
  addAudit(40 * 24 * 60, 'TENANT_USER', 'developer', 'CREDENTIAL_CREATED', 'CREDENTIAL', String(credentials[1].id), { keyId: credentials[1].keyId });
  addAudit(40 * 24 * 60 - 30, 'TENANT_USER', 'developer', 'CREDENTIAL_REVOKED', 'CREDENTIAL', String(credentials[0].id), { keyId: credentials[0].keyId });
  addAudit(30 * 24 * 60, 'ADMIN', 'admin', 'ENTITLEMENT_UPDATED', 'ENTITLEMENT', 'DOCUMENT_SCAN', { quotaPerDay: { from: 100, to: 200 } });
  addAudit(21 * 24 * 60, 'TENANT_USER', 'developer', 'CLIENT_APP_UPDATED', 'CLIENT_APP', String(apps[2].id), { status: { from: 'ACTIVE', to: 'DISABLED' } });
  addAudit(14 * 24 * 60, 'TENANT_USER', 'owner', 'BRANDING_UPDATED', 'BRANDING', 'NOQODI', { fields: ['primaryColor', 'logoDataUrl', 'texts.en.welcomeTitle'] });
  addAudit(7 * 24 * 60, 'TENANT_USER', 'developer', 'CLIENT_APP_PERMISSIONS_UPDATED', 'CLIENT_APP', String(apps[1].id), { FACE_AUTHENTICATION: false });
  for (const s of sessions.filter((x) => x.status === 'CANCELLED').slice(0, 6)) {
    addAudit((now - Date.parse(s.completedAt ?? s.createdAt)) / MIN, 'CLIENT', s.clientAppCode ?? 'MOBILE_APP', 'SESSION_CANCELLED', 'SESSION', s.publicId, { reason: 'USER_CLOSED' });
  }
  for (const s of sessions.filter((x) => x.review?.decidedAt).slice(0, 8)) {
    addAudit((now - Date.parse(s.review?.decidedAt ?? s.createdAt)) / MIN, 'ADMIN', rng.pick(['sara.review', 'omar.review']), 'REVIEW_DECIDED', 'SESSION', s.publicId, { decision: s.decision });
  }
  addAudit(2 * 24 * 60, 'SYSTEM', 'scheduler', 'WEBHOOK_DELIVERY_RETRIED', 'WEBHOOK', String(webhooks[0].id), { failed: 3, delivered: 2 });
  addAudit(90, 'TENANT_USER', 'developer', 'PLAYGROUND_TOKEN_ISSUED', 'CLIENT_APP', String(apps[1].id), { clientAppCode: 'WEB_PORTAL', subjectRef: 'playground-7f3a9c' });
  audit.sort((a, b) => b.at.localeCompare(a.at));

  const branding: Branding = {
    ...defaultBranding('NOQODI', 'Noqodi'),
    logoDataUrl: NOQODI_LOGO,
    primaryColor: '#0b7a5c',
    accentColor: '#f2a541',
    surfaceColor: '#f3f7f5',
    textColor: '#10231d',
    borderRadius: 14,
    fontFamily: 'Inter',
    supportEmail: 'support@noqodi.example',
    supportUrl: 'https://help.noqodi.example',
    privacyUrl: 'https://noqodi.example/privacy',
    texts: {
      en: { welcomeTitle: 'Verify your identity', welcomeBody: 'It takes about a minute: a quick selfie and your Emirates ID or passport.', doneTitle: 'You are all set', doneBody: 'Thanks! You can go back to the Noqodi app.' },
      ar: { welcomeTitle: 'تحقق من هويتك', welcomeBody: 'يستغرق الأمر دقيقة واحدة تقريباً: صورة ذاتية سريعة وبطاقة الهوية الإماراتية أو جواز السفر.', doneTitle: 'تم بنجاح', doneBody: 'شكراً لك! يمكنك العودة إلى تطبيق نقودي.' },
    },
    updatedAt: iso(now - 14 * DAY),
  };

  // Face authentication: camtech widened the limits and the tenant saved its own choice, so every state
  // of the Verification flows page can be tried in demo mode.
  const liveness = startingLiveness();
  liveness.FACE_AUTHENTICATION = {
    policy: { allowedModes: ['ACTIVE', 'PASSIVE'], allowedActions: [...CHALLENGE_ACTIONS], minActions: 1, maxActions: 4, requireSpareAction: true },
    settings: { mode: 'ACTIVE', actions: ['TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'SMILE', 'MOVE_CLOSER'], challengeCount: 2 },
    updatedAt: iso(now - 3 * DAY),
  };

  // The mobile app's key expires soon (shown under "Needs attention").
  credentials[1].expiresAt = iso(now + 9 * DAY);

  const tenant: MockTenant = {
    info, entitlements, apps, credentials, webhooks, deliveries, sessions, scans, audit, branding, liveness, users: [],
    documents: [], parties: [], reviewCases: [], reviewOwner: 'TENANT', expiryWarningDays: 30, dedupEnabled: true, retention: RETENTION_POLICIES(now),
  };
  buildRecords(db, tenant, now);
  return tenant;
}

function buildDemo(db: MockDb, now: number): MockTenant {
  const info: TenantInfo = {
    code: 'DEMO',
    name: 'Demo Fintech LLC',
    status: 'ACTIVE',
    createdAt: iso(now - 2 * DAY),
    flows: [
      { code: 'SELFIE_ID_VERIFICATION', name: 'Selfie ID verification', enabled: true },
      { code: 'FACE_AUTHENTICATION', name: 'Face authentication', enabled: true },
      { code: 'FACE_ENROLLMENT', name: 'Face registration', enabled: true },
      { code: 'LIVENESS_CHECK', name: 'Liveness check', enabled: false },
      { code: 'DOCUMENT_SCAN', name: 'Document scan', enabled: false },
    ],
    documentTypes: [
      { code: 'EMIRATES_ID', name: 'Emirates ID', enabled: true },
      { code: 'PASSPORT', name: 'Passport', enabled: true },
      { code: 'TRADE_LICENCE', name: 'Trade licence', enabled: false },
    ],
    features: [
      { code: 'SERVER_OCR', enabled: false },
      { code: 'DEDUP_SEARCH', enabled: true },
      { code: 'MANUAL_REVIEW', enabled: true },
      { code: 'WEBHOOKS', enabled: true },
      { code: 'FILE_UPLOAD', enabled: false },
    ],
  };
  const entitlements: Entitlement[] = [
    ...info.flows.map((f) => ({ featureType: 'FLOW' as const, featureCode: f.code, enabled: f.enabled, quotaPerDay: f.enabled ? 100 : null })),
    ...info.documentTypes.map((d) => ({ featureType: 'DOCUMENT' as const, featureCode: d.code, enabled: d.enabled, quotaPerDay: null })),
    ...info.features.map((f) => ({ featureType: 'FEATURE' as const, featureCode: f.code, enabled: f.enabled, quotaPerDay: null })),
  ].map((e) => ({ id: db.seq.entitlement++, ...e, usedToday: 0, validUntil: iso(now + 28 * DAY).slice(0, 10) }));
  const audit: AuditEvent[] = [
    { id: db.seq.audit++, actorType: 'ADMIN', actor: 'admin', action: 'TENANT_UPDATED', entity: 'TENANT', entityId: 'DEMO', ipAddress: '10.20.1.4', details: { created: true, trialDays: 30 }, at: iso(now - 2 * DAY) },
    { id: db.seq.audit++, actorType: 'ADMIN', actor: 'admin', action: 'ENTITLEMENT_UPDATED', entity: 'ENTITLEMENT', entityId: 'SELFIE_ID_VERIFICATION', ipAddress: '10.20.1.4', details: { enabled: true, quotaPerDay: 100 }, at: iso(now - 2 * DAY + MIN) },
  ];
  return {
    info, entitlements, apps: [], credentials: [], webhooks: [], deliveries: [], sessions: [], scans: [], audit, branding: null, liveness: startingLiveness(), users: [],
    documents: [], parties: [], reviewCases: [], reviewOwner: 'TENANT', expiryWarningDays: 30, dedupEnabled: true, retention: RETENTION_POLICIES(now),
  };
}

export function buildDb(now: number = Date.now()): MockDb {
  const db: MockDb = {
    tenants: new Map(), tokens: new Map(), media: new Map(),
    seq: { app: 1, credential: 1, webhook: 1, delivery: 1, audit: 1, scan: 1, entitlement: 1, user: 1, media: 1, document: 1, party: 1, template: 1, reviewCase: 1, reviewAction: 1 },
  };
  db.tenants.set('NOQODI', buildNoqodi(db, now));
  db.tenants.set('DEMO', buildDemo(db, now));
  DEMO_USERS.forEach((u, i) => {
    db.tenants.get(u.tenantCode)?.users.push({
      id: db.seq.user++,
      username: u.username,
      displayName: u.displayName,
      email: u.email,
      role: u.role,
      status: 'ACTIVE',
      mustChangePassword: !!u.mustChangePassword,
      lastLoginAt: u.mustChangePassword ? null : iso(now - (i + 1) * 7 * 3_600_000),
      createdAt: iso(now - 60 * DAY + i * DAY),
      password: DEMO_PASSWORD,
      failedLogins: 0,
    });
  });
  return db;
}

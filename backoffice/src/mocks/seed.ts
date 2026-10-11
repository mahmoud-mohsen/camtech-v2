// Builds the believable in-memory demo dataset used by mock mode.
import type {
  AdminUser, AuditEvent, Check, ClientApp, ConfigParam, Credential, Decision, Device, DocumentDetail, Entitlement,
  Flow, MediaRef, PartyDetail, ReviewAction, ReviewCaseSummary, ScanDetail, SessionDetail, SessionEvent,
  Step, Tenant, Webhook, WebhookDelivery, RetentionPolicy, ReasonCode, Role,
} from '../api/types';
import { CONFIG_KEYS, FLOW_DOCS, REASON_CODES, makeFlows, makeRetention } from './catalog';
import type { MediaMeta } from './images';
import { createRng } from './rand';

export type MockSession = Omit<SessionDetail, 'document' | 'reviewCase'> & { documentId: number | null };
export type MockParty = Omit<PartyDetail, 'documents' | 'sessions' | 'documentsCount' | 'sessionsCount'>;
export interface MockReview extends ReviewCaseSummary {
  actions: ReviewAction[];
}

export interface MockDb {
  now: number;
  users: AdminUser[];
  passwords: Map<number, string>;
  tenant: Tenant;
  entitlements: Entitlement[];
  clientApps: ClientApp[];
  credentials: (Credential & { clientAppId: number })[];
  configParams: ConfigParam[];
  flows: Flow[];
  reasonCodes: ReasonCode[];
  webhooks: Webhook[];
  deliveries: WebhookDelivery[];
  retention: RetentionPolicy[];
  audit: AuditEvent[];
  parties: MockParty[];
  documents: DocumentDetail[];
  scans: ScanDetail[];
  sessions: MockSession[];
  reviews: MockReview[];
  media: Map<number, MediaMeta>;
  seq: { [k: string]: number };
}

export const DEMO_PASSWORD = 'Demo@1234';

const MIN = 60000;
const DAY = 86400000;

const MALE = ['Ahmed', 'Mohammed', 'Khalid', 'Omar', 'Yousef', 'Hamdan', 'Saeed', 'Rashid', 'Faisal', 'Tariq', 'Arjun', 'Karim', 'Daniel', 'Rami'];
const FEMALE = ['Fatima', 'Aisha', 'Mariam', 'Noura', 'Hessa', 'Layla', 'Sara', 'Amna', 'Reem', 'Priya', 'Hana', 'Grace'];
const AR: Record<string, string> = {
  Ahmed: 'أحمد', Mohammed: 'محمد', Khalid: 'خالد', Omar: 'عمر', Yousef: 'يوسف', Hamdan: 'حمدان', Saeed: 'سعيد',
  Rashid: 'راشد', Faisal: 'فيصل', Tariq: 'طارق', Karim: 'كريم', Rami: 'رامي', Fatima: 'فاطمة', Aisha: 'عائشة',
  Mariam: 'مريم', Noura: 'نورة', Hessa: 'حصة', Layla: 'ليلى', Sara: 'سارة', Amna: 'آمنة', Reem: 'ريم', Hana: 'هناء',
};
const SURNAMES: [string, string | null][] = [
  ['Al Tajribi', 'التجريبي'],
  ['Al Namouthaji', 'النموذجي'],
  ['Al Iftiradi', 'الافتراضي'],
  ['Al Mithali', 'المثالي'],
  ['Testwell', null],
  ['Sampleson', null],
  ['Demo-Kumar', null],
];
const NATIONALITIES = ['ARE', 'ARE', 'ARE', 'ARE', 'IND', 'EGY', 'JOR', 'PAK', 'PHL', 'GBR'];
const ORGS: [string, string][] = [
  ['Sample Trading LLC', 'سامبل للتجارة ذ.م.م'],
  ['Demo Logistics FZE', 'ديمو للخدمات اللوجستية م.م.ح'],
  ['Placeholder Foods LLC', 'بليس هولدر للأغذية ذ.م.م'],
  ['Example Tech Solutions LLC', 'إكزامبل للحلول التقنية ذ.م.م'],
  ['Mockup Contracting Co.', 'موك أب للمقاولات'],
];

type Outcome =
  | 'APPROVED' | 'REVIEW_OPEN' | 'REVIEW_IN' | 'REVIEW_APPROVED' | 'REVIEW_REJECTED'
  | 'REJECTED_MATCH' | 'REJECTED_DOC' | 'REJECTED_DUP' | 'REJECTED_LIVENESS' | 'EXPIRED' | 'FAILED' | 'IN_PROGRESS' | 'CREATED' | 'CANCELLED';

export function buildDb(): MockDb {
  const rng = createRng(20261008);
  const now = Date.now();
  const iso = (t: number) => new Date(t).toISOString();
  const dateOnly = (t: number) => iso(t).slice(0, 10);
  const seq = { media: 1000, step: 1, check: 1, event: 1, audit: 1, delivery: 1, template: 1, scan: 1, doc: 1, review: 1, credential: 1, config: 1, action: 1, webhook: 1, user: 10, clientApp: 10 };
  const media = new Map<number, MediaMeta>();

  // ---- users ----
  const user = (id: number, username: string, displayName: string, role: Role, extra: Partial<AdminUser> = {}): AdminUser => ({
    id, username, displayName, email: `${username}@camtech.example`, role, status: 'ACTIVE', mustChangePassword: false,
    lastLoginAt: iso(now - rng.int(10, 600) * MIN), createdAt: iso(now - 90 * DAY), ...extra,
  });
  const users: AdminUser[] = [
    user(1, 'admin', 'Back-office Admin', 'ADMIN'),
    user(2, 'sara.review', 'Sara Demo-Reviewer', 'REVIEWER'),
    user(3, 'omar.view', 'Omar Demo-Viewer', 'VIEWER'),
    user(4, 'layla.new', 'Layla Demo-Newcomer', 'REVIEWER', { mustChangePassword: true, lastLoginAt: null, createdAt: iso(now - 1 * DAY) }),
    user(5, 'old.account', 'Former Staff (demo)', 'VIEWER', { status: 'DISABLED', lastLoginAt: iso(now - 60 * DAY) }),
  ];
  const passwords = new Map(users.map((u) => [u.id, DEMO_PASSWORD]));

  const tenant: Tenant = { id: 1, code: 'NOQODI', name: 'Noqodi', status: 'ACTIVE', createdAt: iso(now - 120 * DAY) };

  // ---- entitlements ----
  const featureCodes = ['SERVER_OCR', 'DEDUP_SEARCH', 'FILE_UPLOAD', 'DEVICE_ANTISPOOF', 'WEBHOOKS'];
  const flowCodes = Object.keys(FLOW_DOCS);
  const docCodes = ['EMIRATES_ID', 'PASSPORT', 'TRADE_LICENCE'];
  let entId = 1;
  const entitlements: Entitlement[] = [
    ...flowCodes.map((c) => ({ featureType: 'FLOW' as const, featureCode: c })),
    ...docCodes.map((c) => ({ featureType: 'DOCUMENT' as const, featureCode: c })),
    ...featureCodes.map((c) => ({ featureType: 'FEATURE' as const, featureCode: c })),
  ].map((e) => ({ id: entId++, ...e, enabled: true, quotaPerDay: null, usedToday: 0, validUntil: null }));

  // ---- client apps ----
  const allPerms = [...flowCodes, ...featureCodes];
  const clientApps: ClientApp[] = [
    { id: 1, code: 'MOBILE_APP', name: 'Noqodi mobile app', channel: 'MOBILE', platform: 'iOS / Android', appIdentifier: 'com.noqodi.wallet', allowedOrigins: [], status: 'ACTIVE', permissions: allPerms.map((f) => ({ featureCode: f, allowed: f !== 'FILE_UPLOAD' })), credentialsCount: 0, createdAt: iso(now - 110 * DAY) },
    { id: 2, code: 'WEB_APP', name: 'Noqodi web portal', channel: 'WEB', platform: 'Browser', appIdentifier: null, allowedOrigins: ['https://portal.noqodi.example', 'https://staging-portal.noqodi.example'], status: 'ACTIVE', permissions: allPerms.map((f) => ({ featureCode: f, allowed: f !== 'DEVICE_ANTISPOOF' && f !== 'FACE_AUTHENTICATION' && f !== 'FACE_ENROLLMENT' })), credentialsCount: 0, createdAt: iso(now - 110 * DAY) },
    { id: 3, code: 'BACKOFFICE', name: 'camtech back office', channel: 'ADMIN', platform: 'Browser', appIdentifier: null, allowedOrigins: ['http://localhost:5173'], status: 'ACTIVE', permissions: allPerms.map((f) => ({ featureCode: f, allowed: true })), credentialsCount: 0, createdAt: iso(now - 110 * DAY) },
  ];
  const credentials: MockDb['credentials'] = [];
  const addCred = (clientAppId: number, status: Credential['status'], ageDays: number, lastUsedMin: number | null) => {
    credentials.push({ id: seq.credential++, clientAppId, keyId: `ck_${rng.hex(16)}`, status, createdAt: iso(now - ageDays * DAY), expiresAt: status === 'ACTIVE' && clientAppId === 2 ? iso(now + 200 * DAY) : null, lastUsedAt: lastUsedMin === null ? null : iso(now - lastUsedMin * MIN) });
  };
  addCred(1, 'REVOKED', 100, 60 * 24 * 40);
  addCred(1, 'ACTIVE', 40, 3);
  addCred(2, 'ACTIVE', 80, 12);
  addCred(3, 'ACTIVE', 100, null);

  // ---- config params ----
  const configParams: ConfigParam[] = CONFIG_KEYS.map((k) => ({
    id: seq.config++, flowCode: null, channel: null, clientAppCode: null, paramKey: k.key, paramValue: k.defaultValue,
    description: k.description, updatedAt: iso(now - 30 * DAY), updatedBy: 'admin',
  }));
  const override = (paramKey: string, paramValue: string, scope: Partial<Pick<ConfigParam, 'flowCode' | 'channel' | 'clientAppCode'>>) => {
    configParams.push({ id: seq.config++, flowCode: scope.flowCode ?? null, channel: scope.channel ?? null, clientAppCode: scope.clientAppCode ?? null, paramKey, paramValue, description: CONFIG_KEYS.find((k) => k.key === paramKey)?.description ?? null, updatedAt: iso(now - rng.int(2, 20) * DAY), updatedBy: 'admin' });
  };
  override('liveness.max_attempts', '3', { flowCode: 'FACE_AUTHENTICATION' });
  override('document.max_attempts', '5', { flowCode: 'BUSINESS_VERIFICATION' });
  override('session.ttl_minutes', '20', { channel: 'WEB' });
  override('liveness.device_antispoof_required', 'false', { channel: 'WEB' });
  override('liveness.allow_without_challenge', 'true', { channel: 'MOBILE' });
  override('face.doc_match_similarity', '0.45', { clientAppCode: 'WEB_APP' });
  override('document.file_upload_allowed', 'true', { clientAppCode: 'BACKOFFICE' });

  const flows = makeFlows();
  const reasonCodes = REASON_CODES.map((r) => ({ ...r }));
  const reasonMsg = (code: string) => reasonCodes.find((r) => r.code === code)?.messageEn ?? code;

  // ---- people & organisations ----
  const parties: MockParty[] = [];
  const documents: DocumentDetail[] = [];
  const scans: ScanDetail[] = [];
  let partyId = 1;

  interface PersonInfo { party: MockParty; first: string; last: string; nameEn: string; faceSeed: number; eid: string; passport: string | null; dob: string; gender: 'M' | 'F'; nationality: string }
  const persons: PersonInfo[] = [];
  for (let i = 0; i < 40; i++) {
    const gender = rng.chance(0.55) ? 'M' : 'F';
    const first = rng.pick(gender === 'M' ? MALE : FEMALE);
    const [last, lastAr] = rng.pick(SURNAMES);
    const nationality = rng.pick(NATIONALITIES);
    const year = rng.int(1965, 2003);
    const dob = `${year}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;
    const eid = `784-${year}-${String(rng.int(1000000, 9999999))}-${rng.int(0, 9)}`;
    const nameEn = `${first} ${last}`;
    const nameAr = AR[first] && lastAr ? `${AR[first]} ${lastAr}` : null;
    const createdAt = iso(now - rng.int(15, 100) * DAY);
    const party: MockParty = {
      id: partyId++, publicId: `pty_${rng.hex(12)}`, partyType: 'PERSON', externalRef: `CUST-${100200 + i * 7}`, status: 'ACTIVE',
      displayName: nameEn, nationality, dateOfBirth: dob, lastVerifiedAt: null, createdAt,
      person: { fullNameEn: nameEn, fullNameAr: nameAr, dateOfBirth: dob, gender, nationality },
      organization: null, faceTemplates: [], relations: [],
    };
    parties.push(party);
    persons.push({ party, first, last, nameEn, faceSeed: i * 5 + 3, eid, passport: rng.chance(0.3) ? `P${rng.int(1000000, 9999999)}` : null, dob, gender, nationality });
  }
  interface OrgInfo { party: MockParty; licence: string; name: string }
  const orgs: OrgInfo[] = ORGS.map(([en, ar], i) => {
    const party: MockParty = {
      id: partyId++, publicId: `pty_${rng.hex(12)}`, partyType: 'ORG', externalRef: `BIZ-${5500 + i}`, status: 'ACTIVE',
      displayName: en, nationality: 'ARE', dateOfBirth: null, lastVerifiedAt: null, createdAt: iso(now - rng.int(20, 90) * DAY),
      person: null, organization: { legalNameEn: en, legalNameAr: ar, legalForm: en.endsWith('FZE') ? 'FZE' : 'LLC', issuerCode: i % 2 ? 'ADDED' : 'DED_DUBAI' },
      faceTemplates: [], relations: [],
    };
    parties.push(party);
    // owners / partners
    const owners = [persons[i * 3], persons[i * 3 + 1]];
    const share = rng.pick([51, 60, 70, 100]);
    owners.forEach((p, k) => {
      const pct = k === 0 ? share : 100 - share;
      if (pct <= 0) return;
      party.relations.push({ relationType: k === 0 ? 'OWNER' : 'PARTNER', otherPartyId: p.party.id, otherPartyName: p.nameEn, sharePct: pct });
      p.party.relations.push({ relationType: k === 0 ? 'OWNER_OF' : 'PARTNER_IN', otherPartyId: party.id, otherPartyName: en, sharePct: pct });
    });
    party.relations.push({ relationType: 'AUTHORISED_SIGNATORY', otherPartyId: owners[0].party.id, otherPartyName: owners[0].nameEn, sharePct: null });
    return { party, licence: `${i % 2 ? 'CN' : 'DED'}-${rng.int(1000000, 9999999)}`, name: en };
  });

  // ---- media helpers ----
  const addMedia = (role: string, info: { faceSeed: number; name: string; docNumber: string | null; docType: string | null }, defect: string | null, t: number): MediaRef => {
    const id = seq.media++;
    const isSelfie = role.startsWith('SELFIE');
    const width = isSelfie ? 480 : role === 'FACE_PHOTO' ? 300 : role === 'SIGNATURE' ? 400 : info.docType === 'TRADE_LICENCE' ? 620 : 640;
    const height = isSelfie ? 640 : role === 'FACE_PHOTO' ? 380 : role === 'SIGNATURE' ? 140 : info.docType === 'TRADE_LICENCE' ? 860 : 404;
    const createdAt = iso(t);
    // Failed-attempt media is purged after 7 days (matches the FAILED_ATTEMPT_MEDIA retention policy).
    const purged = defect !== null && now - t > 7 * DAY;
    media.set(id, { id, role, faceSeed: info.faceSeed, name: info.name, docNumber: info.docNumber, docType: info.docType, defect, purged, createdAt });
    return { id, role, mimeType: 'image/jpeg', byteCount: rng.int(isSelfie ? 90000 : 140000, isSelfie ? 260000 : 420000), width, height, createdAt };
  };

  // ---- documents ----
  const docFor = new Map<string, DocumentDetail>();
  const getDoc = (owner: PersonInfo | OrgInfo, type: string, t: number): DocumentDetail => {
    const key = `${owner.party.id}:${type}`;
    const existing = docFor.get(key);
    if (existing) return existing;
    const isOrg = 'licence' in owner;
    const number = isOrg ? owner.licence : type === 'PASSPORT' ? (owner.passport ?? `P${rng.int(1000000, 9999999)}`) : owner.eid;
    // Spread expiries: a few already expired, a few within 30 days, most later.
    const r = rng.next();
    const expiry = r < 0.08 ? now - rng.int(5, 200) * DAY : r < 0.22 ? now + rng.int(2, 29) * DAY : now + rng.int(60, 1800) * DAY;
    const issue = expiry - (isOrg ? 365 : 5 * 365) * DAY;
    const doc: DocumentDetail = {
      id: seq.doc++, partyId: owner.party.id, partyName: owner.party.displayName,
      docTypeCode: type, issuerCode: isOrg ? (owner.party.organization?.issuerCode ?? 'DED_DUBAI') : type === 'PASSPORT' ? 'ARE_PASSPORT' : 'ICP',
      documentNumber: number, issuingCountry: 'ARE', issueDate: dateOnly(issue), expiryDate: dateOnly(expiry),
      status: expiry < now ? 'EXPIRED' : 'CAPTURED', createdAt: iso(t), fields: [], media: [], scans: [],
    };
    if (isOrg) {
      const o = owner;
      doc.fields = [
        { fieldCode: 'LICENCE_NUMBER', lang: null, value: number, source: 'SERVER_OCR', confidence: 0.97, groupCode: null, groupIdx: null },
        { fieldCode: 'TRADE_NAME', lang: 'en', value: o.name, source: 'SERVER_OCR', confidence: 0.93, groupCode: null, groupIdx: null },
        { fieldCode: 'TRADE_NAME_AR', lang: 'ar', value: o.party.organization?.legalNameAr ?? null, source: 'SERVER_OCR', confidence: 0.81, groupCode: null, groupIdx: null },
        { fieldCode: 'LEGAL_FORM', lang: 'en', value: o.party.organization?.legalForm ?? null, source: 'SERVER_OCR', confidence: 0.9, groupCode: null, groupIdx: null },
        { fieldCode: 'ACTIVITY', lang: 'en', value: 'General Trading', source: 'MANUAL', confidence: null, groupCode: null, groupIdx: null },
        { fieldCode: 'ISSUE_DATE', lang: null, value: doc.issueDate, source: 'SERVER_OCR', confidence: 0.95, groupCode: null, groupIdx: null },
        { fieldCode: 'EXPIRY_DATE', lang: null, value: doc.expiryDate, source: 'SERVER_OCR', confidence: 0.95, groupCode: null, groupIdx: null },
        ...o.party.relations.filter((x) => x.sharePct !== null).flatMap((rel, idx) => [
          { fieldCode: 'PARTNER_NAME', lang: 'en', value: rel.otherPartyName, source: 'SERVER_OCR' as const, confidence: 0.88, groupCode: 'PARTNER', groupIdx: idx },
          { fieldCode: 'PARTNER_SHARE', lang: null, value: `${rel.sharePct}%`, source: 'SERVER_OCR' as const, confidence: 0.84, groupCode: 'PARTNER', groupIdx: idx },
        ]),
      ];
    } else {
      const p = owner;
      doc.fields = [
        { fieldCode: 'FULL_NAME', lang: 'en', value: p.nameEn, source: 'CLIENT_OCR', confidence: 0.94, groupCode: null, groupIdx: null },
        { fieldCode: 'FULL_NAME_AR', lang: 'ar', value: p.party.person?.fullNameAr ?? null, source: 'SERVER_OCR', confidence: 0.86, groupCode: null, groupIdx: null },
        { fieldCode: type === 'PASSPORT' ? 'DOCUMENT_NUMBER' : 'ID_NUMBER', lang: null, value: number, source: 'MRZ', confidence: 0.99, groupCode: null, groupIdx: null },
        { fieldCode: 'DATE_OF_BIRTH', lang: null, value: p.dob, source: 'MRZ', confidence: 0.99, groupCode: null, groupIdx: null },
        { fieldCode: 'GENDER', lang: null, value: p.gender, source: 'MRZ', confidence: 0.99, groupCode: null, groupIdx: null },
        { fieldCode: 'NATIONALITY', lang: null, value: p.nationality, source: 'MRZ', confidence: 0.99, groupCode: null, groupIdx: null },
        { fieldCode: 'ISSUE_DATE', lang: null, value: doc.issueDate, source: 'CLIENT_OCR', confidence: 0.9, groupCode: null, groupIdx: null },
        { fieldCode: 'EXPIRY_DATE', lang: null, value: doc.expiryDate, source: 'MRZ', confidence: 0.99, groupCode: null, groupIdx: null },
        ...(type === 'EMIRATES_ID'
          ? [
              { fieldCode: 'CARD_NUMBER', lang: null, value: String(rng.int(100000000, 999999999)), source: 'SERVER_OCR' as const, confidence: 0.91, groupCode: null, groupIdx: null },
              { fieldCode: 'OCCUPATION', lang: 'en', value: rng.pick(['Engineer', 'Accountant', 'Sales Manager', 'Teacher', 'Driver', 'Business Owner']), source: 'SERVER_OCR' as const, confidence: rng.float(0.6, 0.9), groupCode: null, groupIdx: null },
            ]
          : [{ fieldCode: 'ISSUING_PLACE', lang: 'en', value: 'Dubai', source: 'SERVER_OCR' as const, confidence: 0.83, groupCode: null, groupIdx: null }]),
      ];
    }
    documents.push(doc);
    docFor.set(key, doc);
    return doc;
  };

  const addScan = (doc: DocumentDetail | null, docType: string, t: number, mediaRefs: MediaRef[], status: ScanDetail['status'] = 'COMPLETED'): ScanDetail => {
    const conf = status === 'COMPLETED' ? rng.float(0.78, 0.97) : null;
    const scan: ScanDetail = {
      id: seq.scan++, publicId: `scn_${rng.hex(14)}`, documentId: doc?.id ?? null, docTypeCode: docType, status, confidence: conf,
      processingMs: status === 'PENDING' ? null : rng.int(650, 3200), errorMessage: status === 'FAILED' ? rng.pick(['Image too small to read', 'OCR provider timeout', 'No document found in image']) : null,
      ocrProvider: 'internal', createdAt: iso(t),
      fields: status === 'COMPLETED' && doc
        ? doc.fields.map((f) => ({ fieldCode: f.fieldCode, lang: f.lang, rawValue: f.value, confidence: f.confidence ?? rng.float(0.7, 0.99), validationStatus: (f.confidence ?? 1) < 0.75 ? 'LOW_CONFIDENCE' : 'VALID' }))
        : [],
      media: mediaRefs,
      rawText: status === 'COMPLETED' && doc
        ? [docType === 'TRADE_LICENCE' ? 'COMMERCIAL LICENCE' : 'UNITED ARAB EMIRATES', 'FEDERAL AUTHORITY FOR IDENTITY', ...doc.fields.map((f) => `${f.fieldCode.replace(/_/g, ' ')}: ${f.value ?? ''}`), 'SPECIMEN — DEMO DATA'].join('\n')
        : null,
    };
    scans.push(scan);
    if (doc) {
      const { fields: _f, media: _m, rawText: _r, ...summary } = scan;
      doc.scans.push(summary);
    }
    return scan;
  };

  // ---- sessions ----
  const sessions: MockSession[] = [];
  const reviews: MockReview[] = [];
  const allEvents: (SessionEvent & { id: number; sessionPublicId: string })[] = [];

  const flowByCode = new Map(flows.map((f) => [f.code, f]));
  const LIVENESS_DEFECTS = ['TOO_DARK', 'BLURRY', 'NOT_CLOSER', 'FACE_CHANGED', 'HEAD_TURNED'] as const;

  const N = 60;
  const createdTimes = Array.from({ length: N }, (_, i) => {
    if (i < 3) return now - rng.int(1, 9) * MIN; // live sessions
    return now - rng.float(0.02, 14) * DAY;
  }).sort((a, b) => a - b);

  let personCursor = 0;
  const pickPerson = (): PersonInfo => (personCursor < persons.length && rng.chance(0.8) ? persons[personCursor++] : rng.pick(persons.slice(0, Math.max(personCursor, 1))));

  for (let i = 0; i < N; i++) {
    const created = createdTimes[i];
    const recent = now - created < 15 * MIN;
    // One face registration is forced into the review queue (duplicate identity) for the demo.
    const forcedEnrollmentReview = i === N - 6;
    const flowCode = forcedEnrollmentReview
      ? 'FACE_ENROLLMENT'
      : rng.weighted([
          ['SELFIE_ID_VERIFICATION', 34], ['IDENTITY_VERIFICATION', 23], ['FACE_AUTHENTICATION', 17], ['BUSINESS_VERIFICATION', 11],
          ['LIVENESS_CHECK', 7], ['FACE_ENROLLMENT', 8],
        ] as const);
    const flow = flowByCode.get(flowCode)!;
    // The web portal is not allowed face authentication or face registration.
    const channel = flowCode === 'FACE_AUTHENTICATION' || flowCode === 'FACE_ENROLLMENT' ? 'MOBILE' : rng.chance(0.65) ? 'MOBILE' : 'WEB';
    const clientAppCode = channel === 'MOBILE' ? 'MOBILE_APP' : 'WEB_APP';
    const hasFaceDoc = flow.steps.some((s) => s.stepCode === 'FACE_DOC_MATCH');

    let outcome: Outcome;
    if (recent) outcome = i === 0 ? 'CREATED' : 'IN_PROGRESS';
    else if (flowCode === 'BUSINESS_VERIFICATION') outcome = rng.weighted([['APPROVED', 70], ['REJECTED_DOC', 15], ['EXPIRED', 15]] as const);
    else if (flowCode === 'FACE_AUTHENTICATION') outcome = rng.weighted([['APPROVED', 65], ['REJECTED_MATCH', 12], ['FAILED', 10], ['EXPIRED', 8], ['CANCELLED', 5]] as const);
    // One selfie per session: a failed liveness rejects it straight away.
    else if (flowCode === 'LIVENESS_CHECK') outcome = rng.weighted([['APPROVED', 75], ['REJECTED_LIVENESS', 18], ['EXPIRED', 7]] as const);
    else if (flowCode === 'FACE_ENROLLMENT')
      outcome = rng.weighted([
        ['APPROVED', 60], ['REJECTED_LIVENESS', 12], ['REVIEW_OPEN', 6], ['REVIEW_APPROVED', 5], ['REVIEW_REJECTED', 3], ['REJECTED_DUP', 6], ['EXPIRED', 8],
      ] as const);
    else
      outcome = rng.weighted([
        ['APPROVED', 45], ['REVIEW_OPEN', 9], ['REVIEW_IN', 4], ['REVIEW_APPROVED', 5], ['REVIEW_REJECTED', 3],
        ['REJECTED_MATCH', 7], ['REJECTED_DOC', 5], ['REJECTED_DUP', 3], ['EXPIRED', 7], ['FAILED', 5], ['CANCELLED', 3],
      ] as const);
    // Make sure the queue is never empty in the demo.
    if (i >= N - 5 && i <= N - 4 && hasFaceDoc) outcome = 'REVIEW_OPEN';
    if (forcedEnrollmentReview && !recent) outcome = 'REVIEW_OPEN';
    // Face registration reviews are about a duplicate identity (no document to compare with).
    const dedupReview = flowCode === 'FACE_ENROLLMENT' && outcome.startsWith('REVIEW');

    const isOrg = flowCode === 'BUSINESS_VERIFICATION';
    const owner: PersonInfo | OrgInfo = isOrg ? rng.pick(orgs) : pickPerson();
    const person = isOrg ? null : (owner as PersonInfo);
    // A liveness check may run without a subjectRef: no person is linked.
    const anonymous = flowCode === 'LIVENESS_CHECK' && rng.chance(0.5);
    // Asked to register the face: face registration, and selfie ID verifications of apps allowed FACE_ENROLLMENT.
    const enrollFace = flowCode === 'FACE_ENROLLMENT' || flowCode === 'IDENTITY_VERIFICATION' || (flowCode === 'SELFIE_ID_VERIFICATION' && clientAppCode === 'MOBILE_APP');
    const docType = isOrg ? 'TRADE_LICENCE' : flowCode === 'IDENTITY_VERIFICATION' && (owner as PersonInfo).passport && rng.chance(0.5) ? 'PASSPORT' : 'EMIRATES_ID';
    const usesDoc = flow.steps.some((s) => s.stepCode === 'DOC_CAPTURE');
    const doc = usesDoc ? getDoc(owner, docType, created) : null;
    if (outcome === 'REJECTED_DOC' && doc) {
      doc.expiryDate = dateOnly(now - rng.int(10, 300) * DAY);
      doc.status = 'EXPIRED';
    }
    const mediaInfo = { faceSeed: person?.faceSeed ?? 1, name: anonymous ? '' : (owner.party.displayName ?? ''), docNumber: doc?.documentNumber ?? null, docType: doc?.docTypeCode ?? null };

    const steps: Step[] = [];
    let t = created + rng.int(10, 40) * 1000;
    let livenessAttempts = 0;
    let documentAttempts = 0;
    let finalSimilarity: number | null = null;
    let stopped = false;
    let lastSelfie: MediaRef | null = null;

    const mkCheck = (checkCode: string, score: number | null, thresholdUsed: string | null, outcomeC: Check['outcome'], details: Record<string, unknown> | null = null): Check => ({
      id: seq.check++, checkCode, score: score === null ? null : Math.round(score * 1000) / 1000, thresholdUsed, outcome: outcomeC, details,
    });
    const pushStep = (stepCode: string, attemptNo: number, status: Step['status'], reasonCode: string | null, checks: Check[], mediaRefs: MediaRef[], dur: number) => {
      const startedAt = iso(t);
      t += dur * 1000;
      steps.push({ id: seq.step++, stepCode, attemptNo, status, reasonCode, reasonMessage: reasonCode ? reasonMsg(reasonCode) : null, startedAt, endedAt: status === 'IN_PROGRESS' ? null : iso(t), checks, media: mediaRefs });
      t += rng.int(3, 25) * 1000;
    };

    const livenessAttempt = (no: number, defect: string | null) => {
      livenessAttempts++;
      const m1 = addMedia('SELFIE_NORMAL', mediaInfo, defect, t);
      const m2 = addMedia('SELFIE_CLOSER', mediaInfo, defect, t + 2000);
      const checks: Check[] = [mkCheck('FACE_DETECTED', rng.float(0.95, 0.999), '0.90', 'PASS')];
      const fail = (c: string) => defect === c;
      let failedYet = false;
      const add = (code: string, ok: number, bad: number, thr: string, isBad: boolean, details: Record<string, unknown> | null = null) => {
        if (failedYet) {
          checks.push(mkCheck(code, null, thr, 'SKIPPED'));
          return;
        }
        checks.push(mkCheck(code, isBad ? bad : ok, thr, isBad ? 'FAIL' : 'PASS', details));
        if (isBad) failedYet = true;
      };
      add('BRIGHTNESS', rng.float(0.5, 0.88), rng.float(0.1, 0.27), '0.35', fail('TOO_DARK'));
      add('SHARPNESS', rng.float(0.55, 0.95), rng.float(0.12, 0.33), '0.40', fail('BLURRY'));
      const yaw = fail('HEAD_TURNED') ? rng.int(27, 40) : rng.int(1, 9);
      add('HEAD_POSE', yaw, yaw, '20', fail('HEAD_TURNED'), { yawDegrees: yaw, pitchDegrees: rng.int(-6, 6), comparison: 'max' });
      add('SAME_PERSON', rng.float(0.62, 0.92), rng.float(0.15, 0.38), '0.5', fail('FACE_CHANGED'));
      add('CLOSER_AREA_GAIN', rng.float(1.22, 1.75), rng.float(0.98, 1.06), '1.1', fail('NOT_CLOSER'), { normalFaceArea: rng.int(18000, 26000), closerFaceArea: rng.int(26000, 40000) });
      if (channel === 'MOBILE') add('DEVICE_ANTISPOOF', rng.float(0.71, 0.98), 0.12, '0.3', false, { provider: 'on-device' });
      else checks.push(mkCheck('DEVICE_ANTISPOOF', null, '0.3', 'SKIPPED', { reason: 'Not required on WEB' }));
      pushStep('LIVENESS', no, defect ? 'FAILED' : 'PASSED', defect, checks, [m1, m2], rng.int(3, 9));
      if (!defect) lastSelfie = m1;
    };

    const docAttempt = (no: number, defect: string | null): MediaRef | null => {
      documentAttempts++;
      const type = doc!.docTypeCode;
      const refs: MediaRef[] = [];
      if (type === 'EMIRATES_ID') refs.push(addMedia('FRONT', mediaInfo, defect, t), addMedia('BACK', mediaInfo, defect, t + 4000));
      else if (type === 'PASSPORT') refs.push(addMedia('PHOTO_PAGE', mediaInfo, defect, t));
      else refs.push(addMedia('DOCUMENT', mediaInfo, defect, t));
      let facePhoto: MediaRef | null = null;
      if (!defect && type !== 'TRADE_LICENCE') {
        facePhoto = addMedia('FACE_PHOTO', mediaInfo, null, t + 5000);
        refs.push(facePhoto);
        if (type === 'EMIRATES_ID' && rng.chance(0.4)) refs.push(addMedia('SIGNATURE', mediaInfo, null, t + 5000));
      }
      const checks: Check[] = [
        mkCheck('DOC_DETECTED', rng.float(0.9, 0.99), '0.80', 'PASS', { detectedType: type }),
        mkCheck('OCR_CONFIDENCE', defect ? rng.float(0.32, 0.6) : rng.float(0.8, 0.97), '0.75', defect ? 'FAIL' : 'PASS'),
      ];
      if (type !== 'TRADE_LICENCE') checks.push(mkCheck('MRZ_READ', defect ? null : 1, null, defect ? 'SKIPPED' : 'PASS'));
      pushStep('DOC_CAPTURE', no, defect ? 'FAILED' : 'PASSED', defect ? 'DOC_UNREADABLE' : null, checks, refs, rng.int(4, 12));
      if (!defect) {
        doc!.media = refs;
        addScan(doc, type, t, refs);
      }
      return facePhoto;
    };

    const maxFor = (code: string) => flow.steps.find((s) => s.stepCode === code)?.maxAttempts ?? 1;
    // How far does this session get?
    const stepCodes = flow.steps.map((s) => s.stepCode);
    let stopAfter = stepCodes.length;
    if (outcome === 'CREATED') stopAfter = 0;
    if (outcome === 'IN_PROGRESS') stopAfter = rng.int(1, Math.max(1, stepCodes.length - 1));
    if (outcome === 'EXPIRED' || outcome === 'CANCELLED') stopAfter = rng.int(0, Math.min(2, stepCodes.length - 1));

    for (let si = 0; si < stepCodes.length && !stopped; si++) {
      const code = stepCodes[si];
      if (si >= stopAfter) {
        if (outcome === 'IN_PROGRESS') pushStep(code, 1, 'IN_PROGRESS', null, [], [], 0);
        break;
      }
      if (code === 'LIVENESS') {
        if (outcome === 'FAILED') {
          const max = maxFor('LIVENESS');
          for (let a = 1; a <= max; a++) livenessAttempt(a, rng.pick(LIVENESS_DEFECTS));
          steps[steps.length - 1].reasonCode = 'LIVENESS_MAX_ATTEMPTS';
          steps[steps.length - 1].reasonMessage = reasonMsg('LIVENESS_MAX_ATTEMPTS');
          break;
        }
        if (outcome === 'REJECTED_LIVENESS') {
          livenessAttempt(1, rng.pick(LIVENESS_DEFECTS));
          break;
        }
        const failures = maxFor('LIVENESS') > 1 ? rng.weighted([[0, 55], [1, 30], [2, 12], [3, 3]] as const) : 0;
        for (let a = 1; a <= failures; a++) livenessAttempt(a, rng.pick(LIVENESS_DEFECTS));
        livenessAttempt(failures + 1, null);
      } else if (code === 'DOC_CAPTURE') {
        const failures = rng.weighted([[0, 75], [1, 22], [2, 3]] as const);
        for (let a = 1; a <= failures; a++) docAttempt(a, 'DOC_UNREADABLE');
        docAttempt(failures + 1, null);
      } else if (code === 'DOC_VALIDATION') {
        const expired = outcome === 'REJECTED_DOC';
        const checks = [
          mkCheck('DOC_EXPIRY', null, null, expired ? 'FAIL' : 'PASS', { expiryDate: doc?.expiryDate }),
          mkCheck('ID_NUMBER_FORMAT', null, null, 'PASS'),
          ...(doc?.docTypeCode !== 'TRADE_LICENCE' ? [mkCheck('MRZ_CHECKSUM', null, null, 'PASS')] : []),
        ];
        pushStep('DOC_VALIDATION', 1, expired ? 'FAILED' : 'PASSED', expired ? 'DOC_EXPIRED' : null, checks, [], 1);
        if (expired) stopped = true;
      } else if (code === 'FACE_DOC_MATCH') {
        let sim: number;
        if (outcome.startsWith('REVIEW')) sim = rng.float(0.285, 0.395);
        else if (outcome === 'REJECTED_MATCH') sim = rng.float(0.06, 0.26);
        else sim = rng.chance(0.35) ? rng.float(0.7, 0.88) : rng.float(0.42, 0.69);
        finalSimilarity = Math.round(sim * 1000) / 1000;
        const out: Check['outcome'] = sim >= 0.4 ? 'PASS' : sim >= 0.28 ? 'REVIEW' : 'FAIL';
        pushStep('FACE_DOC_MATCH', 1, out === 'PASS' ? 'PASSED' : out === 'REVIEW' ? 'REVIEW' : 'FAILED', out === 'PASS' ? null : out === 'REVIEW' ? 'FACE_REVIEW' : 'FACE_MISMATCH',
          [mkCheck('FACE_SIMILARITY', sim, '0.40', out, { reviewThreshold: 0.28, excellentThreshold: 0.7, model: 'arcface-r100-v2', selfieMediaId: (lastSelfie as MediaRef | null)?.id ?? null })], [], 1);
        if (out === 'FAIL') stopped = true;
      } else if (code === 'FACE_TEMPLATE_MATCH') {
        const sim = outcome === 'REJECTED_MATCH' ? rng.float(0.1, 0.4) : rng.float(0.58, 0.9);
        finalSimilarity = Math.round(sim * 1000) / 1000;
        const ok = sim >= 0.5;
        pushStep('FACE_TEMPLATE_MATCH', 1, ok ? 'PASSED' : 'FAILED', ok ? null : 'TEMPLATE_MISMATCH', [mkCheck('TEMPLATE_SIMILARITY', sim, '0.50', ok ? 'PASS' : 'FAIL', { templateId: null })], [], 1);
        if (!ok) stopped = true;
      } else if (code === 'DEDUP_SEARCH') {
        const dup = outcome === 'REJECTED_DUP' || dedupReview;
        // Prefer someone whose face is registered, so the reviewer has a face to compare with.
        const registered = persons.filter((p) => p !== person && p.party.faceTemplates.some((ft) => ft.status === 'ENROLLED'));
        const other = rng.pick(registered.length ? registered : persons.filter((p) => p !== person));
        const out: Check['outcome'] = dedupReview ? 'REVIEW' : dup ? 'FAIL' : 'PASS';
        pushStep('DEDUP_SEARCH', 1, dedupReview ? 'REVIEW' : dup ? 'FAILED' : 'PASSED', dup ? 'DUPLICATE_IDENTITY' : null,
          [mkCheck(flowCode === 'FACE_ENROLLMENT' ? 'DEDUP_1N' : 'DEDUP_MATCH', dup ? rng.float(0.78, 0.9) : rng.float(0.05, 0.31), '0.60', out, dup ? { matchedPartyId: other.party.id, matchedPartyName: other.nameEn } : { candidatesSearched: rng.int(800, 2400) })], [], 2);
        if (dup) stopped = true;
      }
    }

    // ---- status & decision ----
    const ttl = channel === 'WEB' ? 20 : 15;
    const expiresAt = iso(created + ttl * MIN);
    let status: MockSession['status'] = 'COMPLETED';
    let decision: Decision | null = null;
    let completedAt: string | null = iso(t);
    const sysDecision = (d: Decision['decision'], reason: string | null): Decision => ({ decision: d, decidedBy: 'SYSTEM', decidedByUser: null, reason, finalSimilarity, decidedAt: iso(t) });
    switch (outcome) {
      case 'CREATED':
      case 'IN_PROGRESS':
        status = outcome;
        completedAt = null;
        break;
      case 'EXPIRED':
        status = 'EXPIRED';
        completedAt = null;
        break;
      case 'CANCELLED':
        status = 'CANCELLED';
        completedAt = iso(t + 60000);
        break;
      case 'FAILED':
        status = 'FAILED';
        break;
      case 'APPROVED':
        decision = sysDecision('APPROVED', null);
        break;
      case 'REJECTED_MATCH':
        decision = sysDecision('REJECTED', flowCode === 'FACE_AUTHENTICATION' ? 'TEMPLATE_MISMATCH' : 'FACE_MISMATCH');
        break;
      case 'REJECTED_DOC':
        decision = sysDecision('REJECTED', 'DOC_EXPIRED');
        break;
      case 'REJECTED_DUP':
        decision = sysDecision('REJECTED', 'DUPLICATE_IDENTITY');
        break;
      case 'REJECTED_LIVENESS':
        decision = sysDecision('REJECTED', steps[steps.length - 1]?.reasonCode ?? 'SPOOF_SUSPECTED');
        break;
      default:
        decision = sysDecision('REVIEW', dedupReview ? 'DUPLICATE_IDENTITY' : 'FACE_REVIEW');
    }

    const publicId = `ses_${rng.hex(20)}`;
    const deviceOs = rng.chance(0.55) ? 'iOS' : 'Android';
    const device: Device | null = channel === 'MOBILE'
      ? { id: 100 + i, deviceRef: `dev_${rng.hex(10)}`, platform: deviceOs, osVersion: deviceOs === 'iOS' ? rng.pick(['18.6', '26.0', '26.0.1']) : rng.pick(['14', '15', '16']), appVersion: rng.pick(['4.12.0', '4.12.1', '4.13.0']), model: deviceOs === 'iOS' ? rng.pick(['iPhone 15', 'iPhone 16 Pro', 'iPhone 13']) : rng.pick(['Samsung Galaxy S24', 'Google Pixel 9', 'Xiaomi 14']), attestationStatus: rng.chance(0.9) ? 'VERIFIED' : 'UNVERIFIED' }
      : null;

    const events: SessionEvent[] = [];
    const addEvent = (eventType: string, at: number) => {
      const st = at > now - 2 * MIN ? 'PENDING' : rng.chance(0.92) ? 'DELIVERED' : 'FAILED';
      const ev = { id: seq.event++, sessionPublicId: publicId, eventType, status: st, createdAt: iso(at) };
      allEvents.push(ev);
      events.push({ eventType, status: st, createdAt: ev.createdAt });
    };
    if (status === 'COMPLETED' || status === 'FAILED') addEvent('SESSION_COMPLETED', t);
    if (status === 'EXPIRED') addEvent('SESSION_EXPIRED', created + ttl * MIN);

    const session: MockSession = {
      publicId, flowCode, status, decision, channel, clientAppCode,
      partyId: anonymous ? null : owner.party.id, partyName: anonymous ? null : owner.party.displayName, subjectRef: anonymous ? null : owner.party.externalRef,
      documentType: doc?.docTypeCode ?? null, documentNumber: doc?.documentNumber ?? null,
      finalSimilarity, livenessAttempts, documentAttempts,
      createdAt: iso(created), expiresAt, completedAt,
      device, ipAddress: `${rng.pick(['94.200', '5.31', '86.98', '185.93'])}.${rng.int(1, 254)}.${rng.int(1, 254)}`,
      userAgent: channel === 'MOBILE' ? `NoqodiWallet/${device?.appVersion} (${device?.platform} ${device?.osVersion}; ${device?.model})` : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36',
      steps, documentId: doc?.id ?? null, events, enrollFace, faceRegistered: false,
    };
    sessions.push(session);

    // ---- review case ----
    if (outcome.startsWith('REVIEW')) {
      const openedAt = t;
      const id = seq.review++;
      const actions: ReviewAction[] = [{ id: seq.action++, action: 'OPENED', actor: 'SYSTEM', note: dedupReview ? 'The face matches a face registered to another person.' : 'Face match is in the review band.', createdAt: iso(openedAt) }];
      addEvent('REVIEW_OPENED', openedAt);
      let rstatus: MockReview['status'] = 'OPEN';
      let assignedTo: string | null = null;
      let updated = openedAt;
      if (outcome !== 'REVIEW_OPEN') {
        assignedTo = 'sara.review';
        updated = openedAt + rng.int(10, 120) * MIN;
        actions.push({ id: seq.action++, action: 'ASSIGNED', actor: 'sara.review', note: null, createdAt: iso(updated) });
        rstatus = 'IN_REVIEW';
      }
      if (outcome === 'REVIEW_APPROVED' || outcome === 'REVIEW_REJECTED') {
        const approve = outcome === 'REVIEW_APPROVED';
        updated += rng.int(2, 30) * MIN;
        const note = dedupReview
          ? approve ? 'Different people, only similar features. Approved: face registered.' : 'Same person as the existing registration. Rejected.'
          : approve ? 'Same person — lighting differs, ID portrait is old. Approved.' : 'Different facial features (nose, jawline). Rejected.';
        if (rng.chance(0.5)) actions.push({ id: seq.action++, action: 'COMMENTED', actor: 'sara.review', note: dedupReview ? 'Compared with the registered face of the matched person.' : 'Checked attempts history and document photo quality.', createdAt: iso(updated - 60000) });
        actions.push({ id: seq.action++, action: approve ? 'APPROVED' : 'REJECTED', actor: 'sara.review', note, createdAt: iso(updated) });
        rstatus = approve ? 'APPROVED' : 'REJECTED';
        session.decision = { decision: approve ? 'APPROVED' : 'REJECTED', decidedBy: 'USER', decidedByUser: 'sara.review', reason: note, finalSimilarity, decidedAt: iso(updated) };
        addEvent('REVIEW_DECIDED', updated);
      }
      // Cross-tenant queue: mostly the default tenant, some DEMO (reviewed by camtech), a few SELFREV (reviews its own).
      const tenantId = id % 5 === 0 ? 2 : id % 7 === 0 ? 3 : 1;
      reviews.push({ id, tenantId, sessionPublicId: publicId, status: rstatus, reason: dedupReview ? 'DUPLICATE_IDENTITY' : 'FACE_REVIEW', finalSimilarity, assignedTo, partyName: session.partyName, documentType: session.documentType, createdAt: iso(openedAt), updatedAt: iso(updated), actions });
    }

    // ---- party bookkeeping ----
    const party = owner.party;
    const approved = session.decision?.decision === 'APPROVED';
    if (approved && !anonymous) {
      party.lastVerifiedAt = session.decision!.decidedAt;
      if (doc && doc.status !== 'EXPIRED') doc.status = 'VERIFIED';
    }
    if (session.decision?.decision === 'REJECTED' && doc && doc.status === 'CAPTURED' && outcome !== 'REJECTED_DUP') doc.status = 'REJECTED';
    if (lastSelfie && person && !anonymous) {
      const sm = lastSelfie as MediaRef;
      party.faceTemplates.push({ id: seq.template++, role: 'SELFIE', modelVersion: 'arcface-r100-v2', dimension: 512, qualityScore: Math.round(rng.float(0.6, 0.95) * 100) / 100, status: 'SESSION', sourceMediaId: sm.id, createdAt: sm.createdAt });
      if (approved && enrollFace) {
        party.faceTemplates.forEach((ft) => {
          if (ft.status === 'ENROLLED') ft.status = 'SESSION';
        });
        party.faceTemplates[party.faceTemplates.length - 1].status = 'ENROLLED';
        session.faceRegistered = true;
      }
    }
    const fp = doc?.media.find((m) => m.role === 'FACE_PHOTO');
    if (fp && !party.faceTemplates.some((ft) => ft.sourceMediaId === fp.id)) {
      party.faceTemplates.push({ id: seq.template++, role: 'DOCUMENT', modelVersion: 'arcface-r100-v2', dimension: 512, qualityScore: Math.round(rng.float(0.5, 0.85) * 100) / 100, status: 'SESSION', sourceMediaId: fp.id, createdAt: fp.createdAt });
    }
  }
  // one revoked template for the demo
  const withTemplates = parties.find((p) => p.faceTemplates.length > 1);
  if (withTemplates) withTemplates.faceTemplates[0].status = 'REVOKED';

  // Standalone scans (no document).
  for (let k = 0; k < 7; k++) {
    const t = now - rng.float(0.1, 12) * DAY;
    const p = rng.pick(persons);
    const st = rng.weighted([['FAILED', 3], ['COMPLETED', 3], ['PROCESSING', 1]] as const);
    const ref = addMedia('FRONT', { faceSeed: p.faceSeed, name: p.nameEn, docNumber: p.eid, docType: 'EMIRATES_ID' }, null, t);
    const s = addScan(null, 'EMIRATES_ID', t, [ref], st);
    if (st === 'COMPLETED') {
      s.fields = [
        { fieldCode: 'ID_NUMBER', lang: null, rawValue: p.eid, confidence: 0.96, validationStatus: 'VALID' },
        { fieldCode: 'FULL_NAME', lang: 'en', rawValue: p.nameEn.toUpperCase(), confidence: 0.88, validationStatus: 'VALID' },
        { fieldCode: 'DATE_OF_BIRTH', lang: null, rawValue: p.dob.split('-').reverse().join('/'), confidence: 0.71, validationStatus: 'LOW_CONFIDENCE' },
        { fieldCode: 'NATIONALITY', lang: 'en', rawValue: 'United Arab Emirates', confidence: 0.93, validationStatus: 'VALID' },
      ];
      s.rawText = `UNITED ARAB EMIRATES\nFEDERAL AUTHORITY FOR IDENTITY\nID Number ${p.eid}\nName: ${p.nameEn}\nDate of Birth ${p.dob}\nSPECIMEN — DEMO DATA`;
    }
  }

  // Standalone scans held for a person (NEEDS_REVIEW), plus one rejected and one approved with a correction.
  const reviewScanSpecs = [
    { status: 'NEEDS_REVIEW', kind: 'low' },
    { status: 'NEEDS_REVIEW', kind: 'missing' },
    { status: 'NEEDS_REVIEW', kind: 'invalid' },
    { status: 'NEEDS_REVIEW', kind: 'expired' },
    { status: 'REJECTED', kind: 'low' },
    { status: 'COMPLETED', kind: 'corrected' },
  ] as const;
  reviewScanSpecs.forEach((spec, k) => {
    const t = now - (k * 0.7 + 0.05) * DAY;
    const p = persons[(k * 4 + 1) % persons.length];
    const ref = addMedia('FRONT', { faceSeed: p.faceSeed, name: p.nameEn, docNumber: p.eid, docType: 'EMIRATES_ID' }, null, t);
    const s = addScan(null, 'EMIRATES_ID', t, [ref], spec.status);
    const dobRead = p.dob.split('-').reverse().join('/');
    const wrongDob = dobRead.replace(/^(\d)/, (d) => String((Number(d) + 1) % 3));
    const lowDob = spec.kind === 'low' || spec.kind === 'corrected';
    s.confidence = 0.74;
    s.issues = spec.kind === 'expired' ? ['EXPIRED'] : [];
    s.fields = [
      ...(spec.kind === 'missing'
        ? []
        : [{
            fieldCode: 'emiratesIdNumber', lang: null, rawValue: spec.kind === 'invalid' ? p.eid.replace(/-\d$/, '-0').replace('784-', '748-') : p.eid,
            confidence: 0.9, validationStatus: spec.kind === 'invalid' ? 'INVALID' : 'VALID',
            validationMessage: spec.kind === 'invalid' ? 'Not a valid Emirates ID number (checksum)' : null, source: 'MRZ_VERIFIED', reviewedValue: null,
          }]),
      { fieldCode: 'fullName', lang: null, rawValue: p.nameEn.toUpperCase(), confidence: 0.88, validationStatus: 'VALID', validationMessage: null, source: 'LAYOUT', reviewedValue: null },
      {
        fieldCode: 'dateOfBirth', lang: null, rawValue: lowDob ? wrongDob : dobRead, confidence: lowDob ? 0.52 : 0.93,
        validationStatus: lowDob ? 'LOW_CONFIDENCE' : 'VALID', validationMessage: null, source: 'LABEL', reviewedValue: spec.kind === 'corrected' ? dobRead : null,
      },
      { fieldCode: 'nationality', lang: null, rawValue: 'United Arab Emirates', confidence: 0.95, validationStatus: 'VALID', validationMessage: null, source: 'LABEL', reviewedValue: null },
      { fieldCode: 'expiryDate', lang: null, rawValue: spec.kind === 'expired' ? '14/03/2025' : '14/03/2029', confidence: 0.91, validationStatus: 'VALID', validationMessage: null, source: 'MRZ_VERIFIED', reviewedValue: null },
    ];
    s.reviewReasons =
      lowDob ? [{ code: 'FIELD_LOW_CONFIDENCE', field: 'dateOfBirth', message: 'Read with 52% confidence (needs 80%)' }]
      : spec.kind === 'missing' ? [{ code: 'FIELD_MISSING', field: 'emiratesIdNumber', message: 'Not read from the document' }, { code: 'LOW_CONFIDENCE', field: null, message: 'Overall confidence 74% (needs 80%)' }]
      : spec.kind === 'invalid' ? [{ code: 'FIELD_INVALID', field: 'emiratesIdNumber', message: 'Not a valid Emirates ID number (checksum)' }]
      : [{ code: 'EXPIRED', field: 'expiryDate', message: 'The document has expired' }];
    s.rawText = `UNITED ARAB EMIRATES\nFEDERAL AUTHORITY FOR IDENTITY\nName: ${p.nameEn}\nSPECIMEN — DEMO DATA`;
    if (spec.status !== 'NEEDS_REVIEW') {
      s.reviewedBy = 'ADMIN:sara.review';
      s.reviewedAt = iso(t + 25 * MIN);
      s.reviewNote = spec.status === 'REJECTED' ? 'The image is a photo of a screen.' : 'Date of birth corrected from the image.';
    }
  });

  // usedToday from today's sessions
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  for (const s of sessions) {
    if (Date.parse(s.createdAt) < startOfDay.getTime()) continue;
    const e = entitlements.find((x) => x.featureCode === s.flowCode);
    if (e) e.usedToday++;
    const d = s.documentType && entitlements.find((x) => x.featureCode === s.documentType);
    if (d) d.usedToday++;
    // A selfie ID verification that registers the face also uses one face registration.
    const fe = s.flowCode === 'SELFIE_ID_VERIFICATION' && s.enrollFace && entitlements.find((x) => x.featureCode === 'FACE_ENROLLMENT');
    if (fe) fe.usedToday++;
  }
  const ocr = entitlements.find((x) => x.featureCode === 'SERVER_OCR');
  if (ocr) ocr.usedToday = scans.filter((s) => Date.parse(s.createdAt) >= startOfDay.getTime()).length;

  // ---- webhooks & deliveries ----
  const webhooks: Webhook[] = [
    { id: seq.webhook++, url: 'https://hooks.noqodi.example/camtech/events', events: ['SESSION_COMPLETED', 'SESSION_EXPIRED', 'REVIEW_OPENED', 'REVIEW_DECIDED'], status: 'ACTIVE', createdAt: iso(now - 100 * DAY), lastDeliveryAt: null, lastStatus: null, consecutiveFailures: 0, failing: false },
    { id: seq.webhook++, url: 'https://crm.noqodi.example/api/kyc-callback', events: ['SESSION_COMPLETED', 'REVIEW_DECIDED'], status: 'ACTIVE', createdAt: iso(now - 45 * DAY), lastDeliveryAt: null, lastStatus: null, consecutiveFailures: 0, failing: false },
    { id: seq.webhook++, url: 'https://old-integration.example.test/hook', events: ['SESSION_COMPLETED'], status: 'DISABLED', createdAt: iso(now - 90 * DAY), lastDeliveryAt: null, lastStatus: null, consecutiveFailures: 0, failing: false },
    // Its receiver is down: every delivery fails, so it is flagged as failing.
    { id: seq.webhook++, url: 'https://erp.noqodi.example.test/hooks/documents', events: ['SCAN_REVIEW_REQUIRED', 'SCAN_REVIEW_DECIDED', 'DOCUMENT_EXPIRING', 'PARTY_ERASED'], status: 'ACTIVE', createdAt: iso(now - 20 * DAY), lastDeliveryAt: null, lastStatus: null, consecutiveFailures: 0, failing: false },
  ];
  const deliveries: WebhookDelivery[] = [];
  for (const ev of allEvents.sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    for (const wh of webhooks) {
      if (wh.status !== 'ACTIVE' || !wh.events.includes(ev.eventType)) continue;
      const at = Date.parse(ev.createdAt) + 800;
      const flaky = wh.id === 2;
      const st: WebhookDelivery['status'] = ev.status === 'PENDING' ? 'PENDING' : wh.id === 1 ? (ev.status === 'FAILED' ? 'FAILED' : 'DELIVERED') : flaky && rng.chance(0.18) ? rng.pick(['FAILED', 'RETRYING'] as const) : 'DELIVERED';
      const ok = st === 'DELIVERED';
      deliveries.push({
        id: seq.delivery++, webhookId: wh.id, eventType: ev.eventType, eventId: ev.id, attempt: ok ? 1 : st === 'FAILED' ? 5 : 2,
        httpStatus: st === 'PENDING' ? null : ok ? 200 : rng.pick([500, 502, 503, 404]), status: st,
        error: ok || st === 'PENDING' ? null : rng.pick(['Upstream returned 503 Service Unavailable', 'Connection timed out after 10s', 'HTTP 500 from receiver']),
        nextRetryAt: st === 'RETRYING' ? iso(now + rng.int(2, 30) * MIN) : null, createdAt: iso(at),
      });
      wh.lastDeliveryAt = iso(at);
      wh.lastStatus = st;
    }
  }
  const erp = webhooks[3];
  for (let k = 7; k >= 0; k--) {
    const at = now - k * 9 * 3600_000 - 40 * MIN;
    const eventType = rng.pick(['SCAN_REVIEW_REQUIRED', 'DOCUMENT_EXPIRING', 'SCAN_REVIEW_DECIDED'] as const);
    deliveries.push({
      id: seq.delivery++, webhookId: erp.id, eventType, eventId: seq.event++, attempt: 6, httpStatus: 502, status: 'FAILED',
      error: 'HTTP 502 from receiver', nextRetryAt: null, createdAt: iso(at),
    });
    erp.lastDeliveryAt = iso(at);
    erp.lastStatus = 'FAILED';
  }
  for (const wh of webhooks) {
    const recent = deliveries.filter((d) => d.webhookId === wh.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 5);
    const i = recent.findIndex((d) => d.status !== 'FAILED' && d.status !== 'RETRYING');
    wh.consecutiveFailures = i === -1 ? recent.length : i;
    wh.failing = wh.consecutiveFailures >= 5;
  }

  // ---- audit ----
  const audit: AuditEvent[] = [];
  const addAudit = (at: number, actorType: AuditEvent['actorType'], actor: string, action: string, entity: string | null, entityId: string | null, details: Record<string, unknown> | null) => {
    audit.push({ id: seq.audit++, actorType, actor, action, entity, entityId, ipAddress: actorType === 'SYSTEM' ? null : `10.20.${rng.int(1, 9)}.${rng.int(2, 250)}`, details, at: iso(at) });
  };
  for (const s of sessions) {
    addAudit(Date.parse(s.createdAt), 'CLIENT', s.clientAppCode, 'SESSION_CREATED', 'SESSION', s.publicId, { flowCode: s.flowCode, channel: s.channel });
    if (s.status === 'CANCELLED') addAudit(Date.parse(s.completedAt ?? s.createdAt), 'ADMIN', 'sara.review', 'SESSION_CANCELLED', 'SESSION', s.publicId, { previousStatus: 'IN_PROGRESS' });
  }
  for (const r of reviews) {
    for (const a of r.actions) {
      if (a.action === 'ASSIGNED') addAudit(Date.parse(a.createdAt), 'ADMIN', a.actor, 'REVIEW_ASSIGNED', 'REVIEW_CASE', String(r.id), { assignee: a.actor });
      if (a.action === 'APPROVED' || a.action === 'REJECTED') addAudit(Date.parse(a.createdAt), 'ADMIN', a.actor, 'REVIEW_DECIDED', 'REVIEW_CASE', String(r.id), { decision: a.action, note: a.note });
    }
  }
  for (let d = 13; d >= 0; d--) {
    for (const u of users.slice(0, 3)) {
      if (rng.chance(0.7)) addAudit(now - d * DAY - rng.int(60, 600) * MIN, 'ADMIN', u.username, 'LOGIN', 'ADMIN_USER', String(u.id), { userAgent: 'Chrome 141' });
    }
    if (d % 3 === 0) addAudit(now - d * DAY - 300 * MIN, 'SYSTEM', 'retention-job', 'MEDIA_PURGED', 'MEDIA', null, { dataCategory: 'FAILED_ATTEMPT_MEDIA', purgedCount: rng.int(3, 25) });
  }
  addAudit(now - 2 * DAY, 'ADMIN', 'unknown', 'LOGIN_FAILED', 'ADMIN_USER', null, { username: 'administrator', reason: 'BAD_CREDENTIALS' });
  for (const p of configParams.filter((c) => c.flowCode || c.channel || c.clientAppCode)) {
    addAudit(Date.parse(p.updatedAt), 'ADMIN', 'admin', 'CONFIG_CREATED', 'CONFIG_PARAM', String(p.id), { paramKey: p.paramKey, paramValue: p.paramValue, flowCode: p.flowCode, channel: p.channel, clientAppCode: p.clientAppCode });
  }
  addAudit(now - 5 * DAY, 'ADMIN', 'admin', 'CONFIG_UPDATED', 'CONFIG_PARAM', '1', { paramKey: 'face.doc_match_similarity', oldValue: '0.38', newValue: '0.40' });
  addAudit(now - 1 * DAY, 'ADMIN', 'admin', 'USER_CREATED', 'ADMIN_USER', '4', { username: 'layla.new', role: 'REVIEWER' });
  audit.sort((a, b) => a.at.localeCompare(b.at)).forEach((a, i) => (a.id = i + 1));
  seq.audit = audit.length + 1;

  clientApps.forEach((c) => (c.credentialsCount = credentials.filter((x) => x.clientAppId === c.id).length));

  return {
    now, users, passwords, tenant, entitlements, clientApps, credentials, configParams, flows, reasonCodes,
    webhooks, deliveries, retention: makeRetention(now), audit, parties, documents, scans, sessions, reviews, media, seq,
  };
}


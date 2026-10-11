// People, their documents (with generated images), document images of scans, and the review cases of the
// verifications in review, derived from a tenant's seeded sessions and scans. Own random generator, so the
// rest of the seeded data stays the same.
import type {
  DocumentField, DocumentSummary, FaceTemplate, MatchLabel, MediaRef, RetentionPolicy, ReviewAction, ReviewCaseStatus, ReviewEvidence, TenantScanDetail,
} from '@camtech/api-client';
import { emiratesIdBack, emiratesIdFront, passportPage, selfie, tradeLicencePage } from './images';
import { createRng } from './rand';
import type { MockDb, MockTenant } from './seed';

/** A stored image. DOCUMENT images are served by GET /media/{id}; SELFIE ones only as review evidence. */
export interface MockMedia {
  id: number;
  tenantCode: string;
  role: string;
  kind: 'DOCUMENT' | 'SELFIE';
  mimeType: string;
  svg: string;
  createdAt: string;
}

export interface MockDocument extends DocumentSummary {
  fields: DocumentField[];
  mediaIds: number[];
  scanIds: number[];
}

export interface MockParty {
  id: number;
  publicId: string;
  partyType: 'PERSON' | 'ORG';
  subjectRef: string | null;
  status: string;
  displayName: string | null;
  nationality: string | null;
  dateOfBirth: string | null;
  createdAt: string;
  person: { fullNameEn: string | null; fullNameAr: string | null; dateOfBirth: string | null; gender: string | null; nationality: string | null } | null;
  organization: { legalNameEn: string | null; legalNameAr: string | null; legalForm: string | null; issuerCode: string | null } | null;
  faceTemplates: FaceTemplate[];
}

export interface MockReviewCase {
  id: number;
  sessionPublicId: string;
  status: ReviewCaseStatus;
  reason: string | null;
  matchLabel: MatchLabel | null;
  assignedTo: string | null;
  createdAt: string;
  updatedAt: string;
  evidence: ReviewEvidence[];
  actions: ReviewAction[];
}

export const RETENTION_POLICIES = (now: number): RetentionPolicy[] => [
  { id: 1, dataCategory: 'FAILED_ATTEMPT_MEDIA', retentionDays: 30, description: 'Selfies and document images from failed attempts', updatedAt: new Date(now - 90 * 86_400_000).toISOString() },
  { id: 2, dataCategory: 'VERIFIED_MEDIA', retentionDays: 365, description: 'Images used in a decision (selfies, document photos)', updatedAt: new Date(now - 90 * 86_400_000).toISOString() },
  { id: 3, dataCategory: 'SCAN_ONLY_MEDIA', retentionDays: 7, description: 'Images from OCR-only document scans', updatedAt: new Date(now - 90 * 86_400_000).toISOString() },
  { id: 4, dataCategory: 'AUDIT_EVENTS', retentionDays: 730, description: 'Audit log entries', updatedAt: new Date(now - 90 * 86_400_000).toISOString() },
];

const DAY = 86_400_000;
const MIN = 60_000;
const iso = (t: number) => new Date(t).toISOString();
const day = (t: number) => iso(t).slice(0, 10);

export function mediaRef(m: MockMedia): MediaRef {
  return { id: m.id, role: m.role, mimeType: m.mimeType, byteCount: new TextEncoder().encode(m.svg).length, width: null, height: null, createdAt: m.createdAt, purged: false };
}

function scanValue(s: TenantScanDetail, ...codes: string[]): string | null {
  for (const c of codes) {
    const v = s.fields.find((f) => f.fieldCode === c)?.value;
    if (v) return v;
  }
  return null;
}

/** Adds people, documents, images and review cases to a seeded tenant. */
export function buildRecords(db: MockDb, t: MockTenant, now: number): void {
  const rng = createRng(20261012);
  const addMedia = (role: string, kind: MockMedia['kind'], svg: string, createdAt: string): number => {
    const id = db.seq.media++;
    db.media.set(id, { id, tenantCode: t.info.code, role, kind, mimeType: 'image/svg+xml', svg, createdAt });
    return id;
  };

  // ---- people and their documents, from the most recent selfie ID verifications
  const candidates = t.sessions.filter((s) => s.flowCode === 'SELFIE_ID_VERIFICATION' && s.partyName && s.documentType && s.documentNumber && s.status !== 'CREATED').slice(0, 60);
  candidates.forEach((s, i) => {
    const nationality = rng.pick(['United Arab Emirates', 'India', 'Egypt', 'Jordan', 'Pakistan', 'United Kingdom']);
    const dob = `${rng.int(1965, 2004)}-${String(rng.int(1, 12)).padStart(2, '0')}-${String(rng.int(1, 28)).padStart(2, '0')}`;
    const gender = rng.pick(['Male', 'Female']);
    const party: MockParty = {
      id: db.seq.party++, publicId: rng.uuid(), partyType: 'PERSON', subjectRef: s.subjectRef, status: 'ACTIVE', displayName: s.partyName,
      nationality, dateOfBirth: dob, createdAt: s.createdAt,
      person: { fullNameEn: s.partyName, fullNameAr: null, dateOfBirth: dob, gender, nationality }, organization: null, faceTemplates: [],
    };
    const created = Date.parse(s.createdAt);
    // Every ninth document expires soon, a few have already expired, the rest are valid for a while.
    const expiry = i % 9 === 1 ? now + rng.int(3, 25) * DAY : i % 13 === 5 ? now - rng.int(5, 200) * DAY : now + rng.int(200, 1800) * DAY;
    const issue = created - rng.int(100, 1500) * DAY;
    const expired = expiry < now;
    const status = expired ? 'EXPIRED' : s.decision === 'APPROVED' ? 'VERIFIED' : s.decision === 'REJECTED' ? 'REJECTED' : 'CAPTURED';
    const docType = s.documentType as string;
    const number = s.documentNumber as string;
    if (s.document) s.document.expiryDate = day(expiry);
    const card = { name: s.partyName as string, number, nationality, dateOfBirth: dob, expiryDate: day(expiry), issueDate: day(issue) };
    const mediaIds =
      docType === 'PASSPORT'
        ? [addMedia('FRONT', 'DOCUMENT', passportPage(card), s.createdAt)]
        : [
            addMedia('FRONT', 'DOCUMENT', emiratesIdFront(card), s.createdAt),
            addMedia('BACK', 'DOCUMENT', emiratesIdBack({ ...card, cardNumber: String(rng.int(10000000, 99999999)), occupation: 'Engineer', employer: 'Sample Trading LLC' }), s.createdAt),
          ];
    const src = rng.pick(['CLIENT_OCR', 'SERVER_OCR', 'MRZ']);
    const field = (fieldCode: string, value: string | null, lang: string | null = null): DocumentField => ({
      fieldCode, lang, value, source: src, confidence: Math.round(rng.float(0.8, 0.99) * 1000) / 1000, groupCode: null, groupIdx: null,
    });
    const fields = [
      field('FULL_NAME', s.partyName),
      field(docType === 'PASSPORT' ? 'PASSPORT_NUMBER' : 'ID_NUMBER', number),
      field('NATIONALITY', nationality),
      field('DATE_OF_BIRTH', dob),
      field('GENDER', gender),
      field('ISSUE_DATE', day(issue)),
      field('EXPIRY_DATE', day(expiry)),
    ];
    t.documents.push({
      id: db.seq.document++, partyId: party.id, partyName: s.partyName, docTypeCode: docType, issuerCode: docType === 'EMIRATES_ID' ? 'ICP' : null,
      documentNumber: number, issuingCountry: docType === 'EMIRATES_ID' ? 'ARE' : rng.pick(['IND', 'EGY', 'GBR', 'JOR']), issueDate: day(issue), expiryDate: day(expiry),
      status, createdAt: s.createdAt, fields, mediaIds, scanIds: [],
    });
    if (s.decision === 'APPROVED') {
      party.faceTemplates.push({ id: db.seq.template++, role: 'SELFIE', status: 'ENROLLED', createdAt: s.completedAt ?? s.createdAt });
      party.faceTemplates.push({ id: db.seq.template++, role: 'DOCUMENT_PORTRAIT', status: 'SESSION', createdAt: s.completedAt ?? s.createdAt });
    } else if (rng.chance(0.5)) {
      party.faceTemplates.push({ id: db.seq.template++, role: 'SELFIE', status: 'SESSION', createdAt: s.createdAt });
    }
    t.parties.push(party);
  });

  // ---- document images of the scans; completed ID scans are linked to a document of the same type
  const linkable = new Map<string, MockDocument[]>();
  for (const d of t.documents) linkable.set(d.docTypeCode, [...(linkable.get(d.docTypeCode) ?? []), d]);
  for (const s of t.scans) {
    if (s.status === 'FAILED') {
      s.media = [];
      continue;
    }
    const name = scanValue(s, 'FULL_NAME', 'TRADE_NAME') ?? 'Sample Person';
    const number = scanValue(s, 'ID_NUMBER', 'PASSPORT_NUMBER', 'LICENCE_NUMBER') ?? '—';
    const card = { name, number, nationality: scanValue(s, 'NATIONALITY'), dateOfBirth: scanValue(s, 'DATE_OF_BIRTH'), expiryDate: scanValue(s, 'EXPIRY_DATE'), issueDate: scanValue(s, 'ISSUE_DATE') };
    const back = () => emiratesIdBack({ ...card, cardNumber: scanValue(s, 'CARD_NUMBER') ?? String(rng.int(10000000, 99999999)), occupation: scanValue(s, 'OCCUPATION') ?? undefined, employer: scanValue(s, 'EMPLOYER') ?? undefined });
    const ids =
      s.docTypeCode === 'EMIRATES_ID' ? [addMedia('FRONT', 'DOCUMENT', emiratesIdFront(card), s.createdAt), addMedia('BACK', 'DOCUMENT', back(), s.createdAt)]
      : s.docTypeCode === 'EMIRATES_ID_FRONT' ? [addMedia('FRONT', 'DOCUMENT', emiratesIdFront(card), s.createdAt)]
      : s.docTypeCode === 'EMIRATES_ID_BACK' ? [addMedia('BACK', 'DOCUMENT', back(), s.createdAt)]
      : s.docTypeCode === 'PASSPORT' ? [addMedia('FRONT', 'DOCUMENT', passportPage(card), s.createdAt)]
      : [addMedia('PAGE', 'DOCUMENT', tradeLicencePage(name, number), s.createdAt)];
    s.media = ids.map((id) => mediaRef(db.media.get(id) as MockMedia));
    s.documentId = null;
    const type = s.docTypeCode === 'PASSPORT' ? 'PASSPORT' : s.docTypeCode === 'EMIRATES_ID' ? 'EMIRATES_ID' : null;
    const pool = type ? linkable.get(type) : undefined;
    if (s.status === 'COMPLETED' && pool?.length) {
      const doc = pool.shift() as MockDocument;
      s.documentId = doc.id;
      doc.scanIds.push(s.id);
    }
  }

  // ---- review cases of the verifications that went to review
  const reviewed = t.sessions.filter((s) => s.review);
  for (const s of reviewed) {
    const review = s.review as NonNullable<typeof s.review>;
    const duplicate = s.flowCode === 'FACE_ENROLLMENT';
    const status = review.status as ReviewCaseStatus;
    const decided = status === 'APPROVED' || status === 'REJECTED';
    const assignedTo = status === 'IN_REVIEW' ? 'reviewer' : decided ? rng.pick(['reviewer', 'owner', 'camtech.ops']) : null;
    const opened = Date.parse(review.openedAt);
    const evidence: ReviewEvidence[] = [{ mediaId: addMedia('SELFIE_NORMAL', 'SELFIE', selfie(s.partyName ?? s.publicId), review.openedAt), stepCode: 'LIVENESS', role: 'SELFIE_NORMAL' }];
    if (s.documentType && s.partyName) {
      const card = { name: s.partyName, number: s.documentNumber ?? '—', nationality: null, dateOfBirth: null, expiryDate: s.document?.expiryDate ?? null };
      evidence.push({
        mediaId: addMedia('FRONT', 'SELFIE', s.documentType === 'PASSPORT' ? passportPage(card) : emiratesIdFront(card), review.openedAt),
        stepCode: 'DOC_CAPTURE',
        role: 'FRONT',
      });
    }
    const reason = duplicate ? 'Possible duplicate identity: the face matches another registered person' : rng.pick(['Borderline face match (similarity 0.41)', 'Borderline face match', 'Document photo is low quality']);
    const actions: ReviewAction[] = [{ id: db.seq.reviewAction++, action: 'OPENED', actor: 'system', note: reason, createdAt: review.openedAt }];
    if (assignedTo) actions.push({ id: db.seq.reviewAction++, action: 'ASSIGNED', actor: assignedTo, note: `Assigned to ${assignedTo}`, createdAt: iso(opened + rng.int(2, 60) * MIN) });
    if (decided) {
      actions.push({
        id: db.seq.reviewAction++, action: status, actor: assignedTo ?? 'camtech.ops',
        note: status === 'APPROVED' ? 'Same person: the selfie matches the document photo' : 'The selfie does not match the document photo', createdAt: review.decidedAt ?? iso(now - MIN),
      });
    }
    t.reviewCases.push({
      id: db.seq.reviewCase++, sessionPublicId: s.publicId, status, reason,
      matchLabel: duplicate ? 'STRONG' : rng.chance(0.7) ? 'WEAK' : 'NO_MATCH',
      assignedTo, createdAt: review.openedAt, updatedAt: actions[actions.length - 1].createdAt, evidence, actions,
    });
  }
}

// Turns the server OCR responses (Emirates ID: front and back) into one reviewable list of details (pure).
import type { DocumentScanResponse, IdDocumentType, ScanDocumentType } from '@camtech/api-client';
import type { MessageKey } from '../i18n';
import { validateDocFields, type DocFieldKey } from './doc-form';
import { prefillFromScan, stringFields, type DocFields } from './fields';
import { formatEid, validateEid } from './validators';

export type ReviewGroup = 'personal' | 'document' | 'work' | 'other';
/** verified: checked (check digits, or both sides agree); check: may be misread; read: plain OCR; missing: not read. */
export type FieldStatus = 'verified' | 'check' | 'read' | 'missing';
export type FieldKind = 'eid' | 'date' | 'text';
/** Why a value has its status, shown under it. */
export type FieldReason = 'mrz' | 'match' | 'corrected' | 'differ' | 'low' | null;

export interface ReviewField {
  key: string;
  value: string;
  status: FieldStatus;
  reason: FieldReason;
  confidence: number | null;
  /** A different reading from the other side of the card, offered to the user. */
  alternative: { value: string; side: ScanDocumentType } | null;
  group: ReviewGroup;
  kind: FieldKind;
  rtl: boolean;
  /** The verification cannot go on without it. */
  required?: boolean;
}

export interface ScannedSide {
  type: ScanDocumentType;
  res: DocumentScanResponse;
}

/** Below this OCR confidence a value is flagged for the user to check. */
export const LOW_CONFIDENCE = 0.8;

const GROUPS: [ReviewGroup, string[]][] = [
  ['personal', ['fullNameEn', 'fullName', 'nameEn', 'name', 'fullNameAr', 'nameAr', 'dateOfBirth', 'gender', 'sex', 'genderAr',
    'nationality', 'nationalityAr', 'nationalityCode', 'placeOfBirth']],
  ['document', ['emiratesIdNumber', 'idNumber', 'documentNumber', 'passportNumber', 'cardNumber', 'issueDate', 'expiryDate',
    'issuingPlace', 'issuingPlaceAr', 'issuingCountry']],
  ['work', ['occupation', 'occupationAr', 'employer', 'employerAr']],
];
const GROUP_ORDER: ReviewGroup[] = ['personal', 'document', 'work', 'other'];
/** Latin person names: the back's MRZ has them in capitals, the front in mixed case. */
const LATIN_NAMES = new Set(['fullNameEn', 'fullName', 'nameEn', 'name']);

const HIDDEN = /(_confidence$|^mrzVerified$)/;
const norm = (s: string): string => s.toUpperCase().replace(/[^\p{L}\p{N}]/gu, '');

interface Candidate {
  value: string;
  confidence: number | null;
  valid: boolean;
  source: string | null;
  side: ScanDocumentType;
}

// ------------------------------------------------------------------ names

/** Levenshtein distance (small strings only). */
export function editDistance(a: string, b: string): number {
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

/** "MOHAMED AL-HASSAN" → "Mohamed Al-Hassan". */
export function titleCase(s: string): string {
  return s.toLowerCase().replace(/(^|[\s\-'])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());
}

/** Splits `token` into `parts.length` pieces that best match those words (for MRZ names read without fillers). */
function splitLike(token: string, parts: string[]): string[] {
  const best = { pieces: [token], cost: Infinity };
  const go = (start: number, i: number, acc: string[], cost: number): void => {
    if (cost >= best.cost) return;
    if (i === parts.length - 1) {
      const piece = token.slice(start);
      const c = cost + editDistance(piece, parts[i]);
      if (piece && c < best.cost) Object.assign(best, { pieces: [...acc, piece], cost: c });
      return;
    }
    for (let end = start + 1; end < token.length; end++) {
      const piece = token.slice(start, end);
      go(end, i + 1, [...acc, piece], cost + editDistance(piece, parts[i]));
    }
  };
  go(0, 0, [], 0);
  return best.pieces;
}

/** Re-inserts word breaks the MRZ lost, using the front's words as a guide. */
function repairGlued(mrz: string[], front: string[]): string[] {
  const out: string[] = [];
  let j = 0;
  for (const token of mrz) {
    // How many front words this token covers: the run whose total length is closest to the token's.
    let take = 1;
    let len = front[j]?.length ?? 0;
    let bestDiff = Math.abs(len - token.length);
    for (let k = 2; j + k <= front.length && k <= 4; k++) {
      len += front[j + k - 1].length;
      const diff = Math.abs(len - token.length);
      if (diff < bestDiff) {
        bestDiff = diff;
        take = k;
      }
    }
    if (take > 1 && bestDiff <= 2) {
      out.push(...splitLike(token, front.slice(j, j + take)));
    } else {
      out.push(token);
    }
    j += take;
  }
  return out;
}

const wordsOf = (s: string): string[] => s.toUpperCase().split(/[^\p{L}'-]+/u).filter(Boolean);

export interface NameMerge {
  value: string;
  reason: Exclude<FieldReason, 'low' | 'mrz'>;
  /** The front's reading, when it differs from the merged value. */
  alternative: string | null;
}

/**
 * Combines the printed name (front: mixed case, OCR typos) with the MRZ name (back: capitals, reliable letters, but
 * words can be glued together and long names are cut at 30 characters). Letters come from the MRZ, word breaks and
 * words past the MRZ's end from the front; the result is in title case.
 */
export function mergeNames(front: string | null, mrz: string | null): NameMerge | null {
  const f = front ? wordsOf(front) : [];
  let m = mrz ? wordsOf(mrz) : [];
  if (!m.length && !f.length) return null;
  if (!m.length) return { value: titleCase(f.join(' ')), reason: null, alternative: null };
  if (!f.length) return { value: titleCase(m.join(' ')), reason: null, alternative: null };

  if (m.length < f.length) m = repairGlued(m, f);
  // The MRZ line is 30 characters: a long name loses the end of its last word, or whole words.
  const last = m.length - 1;
  const cut = last < f.length && f[last].startsWith(m[last]) && (f[last].length > m[last].length || f.length > m.length);
  const pairs = Math.min(m.length, f.length);
  let changed = 0;
  let wild = false;
  for (let i = 0; i < pairs; i++) {
    if (cut && i === last) continue;
    const d = editDistance(m[i], f[i]);
    if (d > 0) changed++;
    if (d > Math.max(2, Math.floor(m[i].length / 2))) wild = true;
  }
  const words = cut ? [...m.slice(0, last), ...f.slice(last)] : m;
  const value = titleCase(words.join(' '));
  const frontValue = titleCase(f.join(' '));

  if (wild || (m.length !== f.length && !cut)) return { value, reason: 'differ', alternative: frontValue };
  if (!changed) return { value, reason: 'match', alternative: null };
  return { value, reason: 'corrected', alternative: frontValue };
}

// ------------------------------------------------------------------ merge

function validationOf(res: DocumentScanResponse, key: string): Record<string, unknown> | null {
  const v = res.validations;
  if (!v || typeof v !== 'object') return null;
  const entry = (v as Record<string, unknown>)[key];
  return entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
}

function placeOf(key: string): { group: ReviewGroup; rank: number } {
  for (let g = 0; g < GROUPS.length; g++) {
    const i = GROUPS[g][1].indexOf(key);
    if (i >= 0) return { group: GROUPS[g][0], rank: g * 100 + i };
  }
  return { group: 'other', rank: 1000 };
}

function kindOf(key: string): FieldKind {
  if (/^(emiratesIdNumber|emiratesId|idNumber)$/.test(key)) return 'eid';
  if (/date|dob|expiry/i.test(key)) return 'date';
  return 'text';
}

const score = (c: Candidate): number => (c.valid ? 10 : 0) + (c.source === 'MRZ_VERIFIED' ? 5 : 0) + (c.confidence ?? 0.5);

function mergeOne(key: string, cands: Candidate[]): Pick<ReviewField, 'value' | 'status' | 'reason' | 'confidence' | 'alternative'> {
  const sorted = [...cands].sort((a, b) => score(b) - score(a));
  const best = sorted[0];
  const low = best.confidence !== null && best.confidence < LOW_CONFIDENCE;

  if (LATIN_NAMES.has(key)) {
    const mrz = cands.find((c) => c.side === 'EMIRATES_ID_BACK' || c.source === 'MRZ' || c.source === 'MRZ_VERIFIED');
    const printed = cands.find((c) => c !== mrz);
    const n = mergeNames(printed?.value ?? null, mrz?.value ?? null);
    if (n) {
      const status: FieldStatus = n.reason === 'match' ? 'verified' : n.reason === 'differ' || (!mrz && low) ? 'check' : 'read';
      return {
        value: n.value, status, reason: n.reason ?? (low ? 'low' : null), confidence: best.confidence,
        alternative: n.alternative && printed ? { value: n.alternative, side: printed.side } : null,
      };
    }
  }

  // Check digits are authoritative: no point offering a different reading of an MRZ-verified value.
  const other = best.source === 'MRZ_VERIFIED' ? undefined : sorted.find((c) => norm(c.value) !== norm(best.value));
  const agree = sorted.length > 1 && !sorted.some((c) => norm(c.value) !== norm(best.value));
  let reason: FieldReason = null;
  if (best.source === 'MRZ_VERIFIED') reason = 'mrz';
  else if (other) reason = 'differ';
  else if (agree) reason = 'match';
  else if (low) reason = 'low';
  const status: FieldStatus = best.valid || agree ? 'verified' : other || low ? 'check' : 'read';
  return { value: best.value, status, reason, confidence: best.confidence, alternative: other ? { value: other.value, side: other.side } : null };
}

/** Merges the sides into one ordered list: the best-supported reading of each detail wins. */
export function buildReview(sides: ScannedSide[]): ReviewField[] {
  const byKey = new Map<string, Candidate[]>();
  for (const { type, res } of sides) {
    const raw = (res.fields ?? {}) as Record<string, unknown>;
    for (const [key, value] of Object.entries(stringFields(raw))) {
      if (HIDDEN.test(key)) continue;
      const conf = Number(raw[`${key}_confidence`]);
      const v = validationOf(res, key);
      const c: Candidate = {
        value, confidence: Number.isFinite(conf) ? conf : null, valid: v?.status === 'VALID',
        source: typeof v?.source === 'string' ? v.source : null, side: type,
      };
      byKey.set(key, [...(byKey.get(key) ?? []), c]);
    }
  }
  // The country code says the same as the nationality: only keep it when the name is missing.
  if (byKey.has('nationality')) byKey.delete('nationalityCode');

  const out = [...byKey.entries()].map(([key, cands], seen) => {
    const { group, rank } = placeOf(key);
    return { key, ...mergeOne(key, cands), group, kind: kindOf(key), rtl: /Ar$/.test(key), rank, seen };
  });
  out.sort((a, b) => a.rank - b.rank || a.seen - b.seen);
  return out.map(({ rank: _r, seen: _s, ...f }) => f);
}

export function groupReview(fields: ReviewField[]): { group: ReviewGroup; fields: ReviewField[] }[] {
  return GROUP_ORDER
    .map((group) => ({ group, fields: fields.filter((f) => f.group === group) }))
    .filter((g) => g.fields.length > 0);
}

/** The values for the card preview at the top. */
export function reviewSummary(values: Record<string, string>): { name: string; nameAr: string; number: string; expiry: string } {
  const first = (keys: string[]): string => keys.map((k) => values[k]).find((v) => v && v.trim()) ?? '';
  return {
    name: first(['fullNameEn', 'fullName', 'nameEn', 'name', 'companyName', 'tradeName']),
    nameAr: first(['fullNameAr', 'nameAr']),
    number: first(['emiratesIdNumber', 'idNumber', 'documentNumber', 'passportNumber', 'licenseNo', 'licenseNumber']),
    expiry: first(['expiryDate']),
  };
}

// ------------------------------------------------------------------ edits

const DATE = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$|^(\d{4})-(\d{2})-(\d{2})$/;

/** Normalizes an edited value; returns an error key when it is not acceptable. */
export function checkEdit(kind: FieldKind, input: string): { value: string; error: MessageKey | null } {
  const value = input.trim().replace(/\s+/g, ' ');
  if (kind === 'eid') {
    const e = validateEid(value);
    const error: MessageKey | null = e === 'REQUIRED' ? 'err_REQUIRED' : e === 'FORMAT' ? 'err_EID_FORMAT'
      : e === 'PREFIX' ? 'err_EID_PREFIX' : e === 'CHECKSUM' ? 'err_EID_CHECKSUM' : null;
    return { value: error ? value : formatEid(value), error };
  }
  if (kind === 'date' && value) {
    const m = DATE.exec(value);
    if (!m) return { value, error: 'err_REVIEW_DATE' };
    const [d, mo, y] = m[3] ? [m[1], m[2], m[3]] : [m[6], m[5], m[4]];
    const days = new Date(Date.UTC(Number(y), Number(mo), 0)).getUTCDate();
    if (Number(mo) < 1 || Number(mo) > 12 || Number(d) < 1 || Number(d) > days) return { value, error: 'err_REVIEW_DATE' };
    return { value: `${d.padStart(2, '0')}/${mo.padStart(2, '0')}/${y}`, error: null };
  }
  return { value, error: null };
}

// ------------------------------------------------------------------ identity verification

/** What the review screen shows and what the user changed (kept when the server sends the user back to fix a value). */
export interface ReviewState {
  fields: ReviewField[];
  values: Record<string, string>;
  edited: string[];
}

const NUMBER_KEYS: Record<IdDocumentType, string[]> = {
  EMIRATES_ID: ['emiratesIdNumber', 'idNumber', 'documentNumber'],
  PASSPORT: ['passportNumber', 'documentNumber'],
};

/** The review key holding the document number (the first one read, else the preferred one). */
export function numberKey(type: IdDocumentType, values: Record<string, string>): string {
  const keys = NUMBER_KEYS[type];
  return keys.find((k) => k in values) ?? keys[0];
}

/** The details printed on every Emirates ID (front, then back); the ones OCR misses are shown empty for the user to fill. */
const EXPECTED: Partial<Record<string, string[]>> = {
  EMIRATES_ID: ['fullNameEn', 'fullNameAr', 'emiratesIdNumber', 'dateOfBirth', 'gender', 'nationality', 'issueDate', 'expiryDate',
    'cardNumber', 'occupation', 'employer', 'issuingPlace'],
};
/** Other keys the same detail can come under. */
const ALIASES: Record<string, string[]> = {
  fullNameEn: ['fullName', 'nameEn', 'name'],
  fullNameAr: ['nameAr'],
  emiratesIdNumber: ['idNumber', 'documentNumber'],
  passportNumber: ['documentNumber'],
  gender: ['sex'],
};

function emptyRow(key: string, required: boolean, eid: boolean): ReviewField {
  return {
    key, value: '', status: 'missing', reason: null, confidence: null, alternative: null, required,
    group: placeOf(key).group, kind: eid && /^(emiratesIdNumber|idNumber)$/.test(key) ? 'eid' : kindOf(key), rtl: /Ar$/.test(key),
  };
}

/**
 * Adds an empty row for every expected detail OCR did not read (`required` ones must be filled to continue),
 * so the user sees what is missing and can type it.
 */
export function withMissing(type: string, fields: ReviewField[], required: string[] = []): ReviewField[] {
  const present = new Set(fields.filter((f) => f.value.trim()).map((f) => f.key));
  const has = (k: string) => present.has(k) || (ALIASES[k] ?? []).some((a) => present.has(a));
  const out = fields.map((f) => (!f.value.trim() ? { ...f, status: 'missing' as const, required: required.includes(f.key) } : f));
  const known = new Set(fields.map((f) => f.key));
  for (const key of [...(EXPECTED[type] ?? []), ...required]) {
    if (!has(key) && !known.has(key)) {
      out.push(emptyRow(key, required.includes(key), type === 'EMIRATES_ID'));
      known.add(key);
    }
  }
  for (const f of out) if (required.includes(f.key) && f.status === 'missing') f.required = true;
  return out.sort((a, b) => placeOf(a.key).rank - placeOf(b.key).rank);
}

/** Missing rows for an identity verification: the document number and expiry are required. */
export function withRequired(type: IdDocumentType, fields: ReviewField[]): ReviewField[] {
  const present = Object.fromEntries(fields.filter((f) => f.value.trim()).map((f) => [f.key, f.value]));
  return withMissing(type, fields, [numberKey(type, present), 'expiryDate']);
}

/** The reviewed values as the identity document details sent with the verification. */
export function toDocFields(type: IdDocumentType, values: Record<string, string>): DocFields {
  return prefillFromScan(type, values, null);
}

/** Validation of the reviewed values, as errors on the review rows. */
export function validateReview(type: IdDocumentType, values: Record<string, string>): Record<string, MessageKey> {
  const errs = validateDocFields(type, toDocFields(type, values));
  const rowOf: Record<DocFieldKey, string> = {
    documentNumber: numberKey(type, values), expiryDate: 'expiryDate', dateOfBirth: 'dateOfBirth', mrzLine2: 'mrzLine2',
    issuingCountry: 'issuingCountry', fullName: 'fullNameEn',
  };
  const out: Record<string, MessageKey> = {};
  for (const [k, e] of Object.entries(errs) as [DocFieldKey, MessageKey][]) out[rowOf[k]] = e;
  return out;
}

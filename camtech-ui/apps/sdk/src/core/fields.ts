// Turning OCR output into form values and readable lists.
import type { IdDocumentType } from '@camtech/api-client';
import { findMrzLine2, formatEid, toIsoDate, validateMrzLine2 } from './validators';

/** Details sent with the identity document (all optional on the wire; the form requires some). */
export interface DocFields {
  documentNumber: string;
  expiryDate: string;
  fullName: string;
  dateOfBirth: string;
  mrzLine2: string;
  issuingCountry: string;
}

export const EMPTY_FIELDS: DocFields = {
  documentNumber: '', expiryDate: '', fullName: '', dateOfBirth: '', mrzLine2: '', issuingCountry: '',
};

const norm = (k: string): string => k.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Flattens OCR fields to `normalizedKey → string value`. */
function flat(fields: Record<string, unknown> | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  const visit = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined) continue;
      if (typeof v === 'object' && !Array.isArray(v)) {
        visit(v as Record<string, unknown>, prefix + k);
        continue;
      }
      const s = Array.isArray(v) ? v.filter((x) => typeof x === 'string' || typeof x === 'number').join(' ') : String(v);
      if (s.trim()) {
        const key = norm(prefix + k);
        if (!out.has(key)) out.set(key, s.trim());
        // Nested `{ value: ... }` objects: also keep the parent key.
        if (norm(k) === 'value' && prefix && !out.has(norm(prefix))) out.set(norm(prefix), s.trim());
      }
    }
  };
  if (fields) visit(fields, '');
  return out;
}

function pick(map: Map<string, string>, keys: string[]): string {
  for (const k of keys) {
    const v = map.get(norm(k));
    if (v) return v;
  }
  return '';
}

/** Prefills the confirmation form from the scan-only OCR response. */
export function prefillFromScan(type: IdDocumentType, fields: Record<string, unknown> | null | undefined,
                                rawText?: string | null): DocFields {
  const m = flat(fields);
  const out: DocFields = { ...EMPTY_FIELDS };
  if (type === 'EMIRATES_ID') {
    const num = pick(m, ['idNumber', 'emiratesId', 'emiratesIdNumber', 'eidNumber', 'documentNumber', 'idNo', 'id_number', 'number']);
    out.documentNumber = num ? formatEid(num) : '';
  } else {
    out.documentNumber = pick(m, ['passportNumber', 'passportNo', 'documentNumber', 'docNumber', 'number']).toUpperCase().replace(/\s/g, '');
  }
  out.expiryDate = toIsoDate(pick(m, ['expiryDate', 'dateOfExpiry', 'expiry', 'expirationDate', 'validUntil', 'expiry_date'])) ?? '';
  out.dateOfBirth = toIsoDate(pick(m, ['dateOfBirth', 'birthDate', 'dob', 'date_of_birth'])) ?? '';
  out.fullName = pick(m, ['fullName', 'nameEn', 'name', 'fullNameEn', 'englishName', 'holderName']);
  if (!out.fullName) {
    const given = pick(m, ['givenNames', 'givenName', 'firstName']);
    const surname = pick(m, ['surname', 'lastName', 'familyName']);
    out.fullName = [given, surname].filter(Boolean).join(' ');
  }
  // The English name line is often unreadable on Emirates IDs; the Arabic one is better than nothing.
  if (!out.fullName) out.fullName = pick(m, ['fullNameAr', 'nameAr', 'arabicName']);
  out.issuingCountry = pick(m, ['issuingCountry', 'issuingState', 'countryCode', 'issuingCountryCode']).toUpperCase();

  if (type === 'PASSPORT') {
    let line2 = pick(m, ['mrzLine2', 'mrz2', 'mrzline2']);
    if (!line2) {
      const mrz = pick(m, ['mrz', 'mrzText', 'mrzLines']);
      line2 = findMrzLine2(mrz) ?? findMrzLine2(rawText) ?? '';
    }
    out.mrzLine2 = line2.toUpperCase().replace(/\s/g, '');
    const parsed = out.mrzLine2 ? validateMrzLine2(out.mrzLine2).parsed : null;
    if (parsed) {
      out.documentNumber ||= parsed.documentNumber;
      out.expiryDate ||= parsed.expiryDate ?? '';
      out.dateOfBirth ||= parsed.dateOfBirth ?? '';
      out.issuingCountry ||= parsed.nationality;
    }
    if (!/^[A-Z]{3}$/.test(out.issuingCountry)) out.issuingCountry = '';
  } else {
    out.issuingCountry = '';
  }
  return out;
}

/** One side's scan-only result (null when that side could not be read at all). */
export interface ScanSide {
  fields?: Record<string, unknown> | null;
  rawText?: string | null;
}

const ARABIC = /[؀-ۿ]/;

/**
 * Prefills the confirmation form from the front and (Emirates ID) back scans.
 * The back's MRZ wins for number, dates and Latin name when its check digits passed (`mrzVerified`);
 * otherwise the back only fills what the front left empty. A Latin name from the back also replaces
 * the front's Arabic-name fallback.
 */
export function prefillFromScans(type: IdDocumentType, front: ScanSide | null, back: ScanSide | null): { fields: DocFields; ocrFailed: boolean } {
  const f = front ? prefillFromScan(type, front.fields, front.rawText) : { ...EMPTY_FIELDS };
  const out: DocFields = { ...f };
  if (back) {
    const b = prefillFromScan(type, back.fields, back.rawText);
    const verified = flat(back.fields).get('mrzverified')?.toLowerCase() === 'true';
    for (const k of ['documentNumber', 'dateOfBirth', 'expiryDate', 'fullName'] as const) {
      if (b[k] && (verified || !out[k])) out[k] = b[k];
    }
    if (!verified && b.fullName && !ARABIC.test(b.fullName) && ARABIC.test(out.fullName)) out.fullName = b.fullName;
  }
  return { fields: out, ocrFailed: !out.documentNumber && !out.expiryDate };
}

/** "licenseNo" → "License no", "date_of_expiry" → "Date of expiry". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/[_\-.]+/g, ' ')
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .trim()
    .toLowerCase();
  return words ? words[0].toUpperCase() + words.slice(1) : key;
}

/** Flat `key → string` list of the extracted fields, for display and the complete event. */
export function stringFields(fields: Record<string, unknown> | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const visit = (obj: Record<string, unknown>, prefix: string): void => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}.${k}` : k;
      if (v === null || v === undefined) continue;
      if (typeof v === 'object' && !Array.isArray(v)) visit(v as Record<string, unknown>, key);
      else if (Array.isArray(v)) {
        const s = v.filter((x) => ['string', 'number', 'boolean'].includes(typeof x)).join(', ');
        if (s) out[key] = s;
      } else {
        const s = String(v).trim();
        if (s) out[key] = s;
      }
    }
  };
  if (fields) visit(fields, '');
  return out;
}

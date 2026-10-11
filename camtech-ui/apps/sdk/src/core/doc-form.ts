// Validation and normalization of the identity document confirmation form (pure).
import type { IdDocumentType } from '@camtech/api-client';
import type { MessageKey } from '../i18n';
import type { DocFields } from './fields';
import {
  formatEid, normalizeMrz, todayIso, validateBirthDate, validateCountry, validateEid, validateExpiry, validateMrzLine2,
  validatePassportNumber,
} from './validators';

export type DocFieldKey = keyof DocFields;
export type DocFieldErrors = Partial<Record<DocFieldKey, MessageKey>>;

/** Validates the confirmation form (pure; exported for tests). */
export function validateDocFields(type: IdDocumentType, f: DocFields, today: string = todayIso()): DocFieldErrors {
  const e: DocFieldErrors = {};
  if (type === 'EMIRATES_ID') {
    const eid = validateEid(f.documentNumber);
    if (eid === 'REQUIRED') e.documentNumber = 'err_REQUIRED';
    else if (eid === 'FORMAT') e.documentNumber = 'err_EID_FORMAT';
    else if (eid === 'PREFIX') e.documentNumber = 'err_EID_PREFIX';
    else if (eid === 'CHECKSUM') e.documentNumber = 'err_EID_CHECKSUM';
  } else {
    const p = validatePassportNumber(f.documentNumber);
    if (p === 'REQUIRED') e.documentNumber = 'err_REQUIRED';
    else if (p === 'FORMAT') e.documentNumber = 'err_PASSPORT_FORMAT';
    if (f.mrzLine2.trim()) {
      const m = validateMrzLine2(f.mrzLine2, today);
      if (m.errors.includes('LENGTH')) e.mrzLine2 = 'err_MRZ_LENGTH';
      else if (m.errors.includes('CHARSET')) e.mrzLine2 = 'err_MRZ_CHARSET';
      else if (m.errors.length) e.mrzLine2 = 'err_MRZ_CHECK';
    }
    if (validateCountry(f.issuingCountry)) e.issuingCountry = 'err_COUNTRY';
  }
  const exp = validateExpiry(f.expiryDate, today);
  if (exp === 'REQUIRED') e.expiryDate = 'err_REQUIRED';
  else if (exp === 'FORMAT') e.expiryDate = 'err_DATE_FORMAT';
  else if (exp === 'EXPIRED') e.expiryDate = 'err_EXPIRED';
  const dob = validateBirthDate(f.dateOfBirth, today);
  if (dob === 'FORMAT') e.dateOfBirth = 'err_DATE_FORMAT';
  else if (dob === 'FUTURE') e.dateOfBirth = 'err_FUTURE';
  else if (dob === 'TOO_OLD') e.dateOfBirth = 'err_TOO_OLD';
  return e;
}

/** Normalizes the values before sending them. */
export function cleanDocFields(type: IdDocumentType, f: DocFields): DocFields {
  return {
    documentNumber: type === 'EMIRATES_ID' ? formatEid(f.documentNumber) : f.documentNumber.trim().toUpperCase(),
    expiryDate: f.expiryDate.trim(),
    fullName: f.fullName.trim().replace(/\s+/g, ' '),
    dateOfBirth: f.dateOfBirth.trim(),
    mrzLine2: type === 'PASSPORT' ? normalizeMrz(f.mrzLine2) : '',
    issuingCountry: type === 'PASSPORT' ? f.issuingCountry.trim().toUpperCase() : '',
  };
}


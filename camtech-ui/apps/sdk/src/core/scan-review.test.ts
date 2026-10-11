import { describe, expect, it } from 'vitest';
import type { DocumentScanResponse } from '@camtech/api-client';
import {
  buildReview, checkEdit, groupReview, withMissing, mergeNames, reviewSummary, titleCase, toDocFields, validateReview, withRequired, type ScannedSide,
} from './scan-review';

// Real responses for one card (front and back), trimmed to what matters.
const front: DocumentScanResponse = {
  success: true, documentType: 'EMIRATES_ID',
  fields: {
    emiratesIdNumber: '784-1996-3381489-4', emiratesIdNumber_confidence: 0.97,
    fullNameEn: 'Mahmoud Maheen Mohamed Alamed', fullNameEn_confidence: 0.765,
    fullNameAr: 'محمود محسن محمد احمد', fullNameAr_confidence: 0.7225,
    dateOfBirth: '07/05/1996', dateOfBirth_confidence: 0.95,
    expiryDate: '21/04/2027', expiryDate_confidence: 0.95,
    issueDate: '26/04/2025', issueDate_confidence: 0.95,
    nationality: 'Egypt', nationality_confidence: 0.95,
    genderAr: 'ذكر', genderAr_confidence: 0.7225,
  },
  validations: {
    emiratesIdNumber: { status: 'VALID', source: 'PATTERN' },
    dateOfBirth: { status: 'VALID', source: 'LAYOUT' },
    expiryDate: { status: 'VALID', source: 'LAYOUT' },
    issueDate: { status: 'VALID', source: 'LAYOUT' },
    fullNameEn: { status: 'UNVERIFIED', source: 'LAYOUT' },
    genderAr: { status: 'UNVERIFIED', source: 'LABEL' },
  },
};
const back: DocumentScanResponse = {
  success: true, documentType: 'EMIRATES_ID_BACK',
  fields: {
    emiratesIdNumber: '784-1996-3381489-4', emiratesIdNumber_confidence: 0.99,
    fullNameEn: 'MAHMOUDMOHSEN MOHAMEDAHMED', fullNameEn_confidence: 0.6375,
    dateOfBirth: '07/05/1996', dateOfBirth_confidence: 0.99,
    expiryDate: '27/04/2027', expiryDate_confidence: 0.99,
    gender: 'Male', gender_confidence: 0.75, genderAr: 'ذكر', genderAr_confidence: 0.95,
    nationalityCode: 'EGY', occupation: 'Software Engineer', occupation_confidence: 0.7225,
    issuingPlaceAr: 'النبي', issuingPlaceAr_confidence: 0.7225,
    cardNumber: '145180889', cardNumber_confidence: 0.99, mrzVerified: true,
  },
  validations: {
    emiratesIdNumber: { status: 'VALID', source: 'MRZ_VERIFIED' },
    dateOfBirth: { status: 'VALID', source: 'MRZ_VERIFIED' },
    expiryDate: { status: 'VALID', source: 'MRZ_VERIFIED' },
    cardNumber: { status: 'VALID', source: 'MRZ_VERIFIED' },
    gender: { status: 'VALID', source: 'MRZ' },
    genderAr: { status: 'VALID', source: 'MRZ' },
    fullNameEn: { status: 'UNVERIFIED', source: 'MRZ' },
    occupation: { status: 'UNVERIFIED', source: 'LABEL' },
  },
};
const sides: ScannedSide[] = [{ type: 'EMIRATES_ID_FRONT', res: front }, { type: 'EMIRATES_ID_BACK', res: back }];
const byKey = () => Object.fromEntries(buildReview(sides).map((f) => [f.key, f]));

describe('mergeNames', () => {
  it('takes the MRZ spelling, the front word breaks and title case', () => {
    expect(mergeNames('Mahmoud Maheen Mohamed Alamed', 'MAHMOUDMOHSEN MOHAMEDAHMED')).toEqual({
      value: 'Mahmoud Mohsen Mohamed Ahmed', reason: 'corrected', alternative: 'Mahmoud Maheen Mohamed Alamed',
    });
  });
  it('agrees when both sides read the same name', () => {
    expect(mergeNames('Mahmoud Mohsen Mohamed Ahmed', 'MAHMOUD MOHSEN MOHAMED AHMED'))
      .toEqual({ value: 'Mahmoud Mohsen Mohamed Ahmed', reason: 'match', alternative: null });
  });
  it('keeps the front words past the end of a truncated MRZ name', () => {
    expect(mergeNames('Abdulrahman Mohammed Abdullah Alhashimi', 'ABDULRAHMAN MOHAMMED ABDULLAH ALHASH')?.value)
      .toBe('Abdulrahman Mohammed Abdullah Alhashimi');
    expect(mergeNames('Abdulrahman Mohammed Abdullah Alhashimi', 'ABDULRAHMAN MOHAMMED ABDUL')?.value)
      .toBe('Abdulrahman Mohammed Abdullah Alhashimi');
  });
  it('flags names that do not line up', () => {
    expect(mergeNames('Sara Khan', 'JOHN PETER SMITH')?.reason).toBe('differ');
  });
  it('works with one side only', () => {
    expect(mergeNames(null, 'AHMED ALI HASSAN')?.value).toBe('Ahmed Ali Hassan');
    expect(mergeNames(null, null)).toBeNull();
  });
  it('title-cases compound names', () => {
    expect(titleCase("AL-HASSAN O'NEIL")).toBe("Al-Hassan O'Neil");
  });
});

describe('buildReview', () => {
  it('merges front and back into the correct details', () => {
    const f = byKey();
    expect(f.fullNameEn).toMatchObject({ value: 'Mahmoud Mohsen Mohamed Ahmed', reason: 'corrected' });
    // The back's check digits beat the front's misread expiry.
    expect(f.expiryDate).toMatchObject({ value: '27/04/2027', status: 'verified', reason: 'mrz', alternative: null });
    expect(f.dateOfBirth).toMatchObject({ value: '07/05/1996', status: 'verified' });
    expect(f.issueDate.value).toBe('26/04/2025');
    expect(f.genderAr).toMatchObject({ status: 'verified', rtl: true });
    expect(f.issuingPlaceAr).toMatchObject({ status: 'check', reason: 'low' });
  });
  it('hides confidences, flags and the duplicate nationality code', () => {
    const keys = buildReview(sides).map((f) => f.key);
    expect(keys.some((k) => k.endsWith('_confidence'))).toBe(false);
    expect(keys).not.toContain('mrzVerified');
    expect(keys).not.toContain('nationalityCode');
  });
  it('groups and orders the details', () => {
    const groups = groupReview(buildReview(sides));
    expect(groups.map((g) => g.group)).toEqual(['personal', 'document', 'work']);
    expect(groups[0].fields[0].key).toBe('fullNameEn');
    expect(groups[1].fields[0].key).toBe('emiratesIdNumber');
  });
  it('summarizes the card', () => {
    const values = Object.fromEntries(buildReview(sides).map((f) => [f.key, f.value]));
    expect(reviewSummary(values)).toEqual({
      name: 'Mahmoud Mohsen Mohamed Ahmed', nameAr: 'محمود محسن محمد احمد', number: '784-1996-3381489-4', expiry: '27/04/2027',
    });
  });
});

describe('checkEdit', () => {
  it('formats and validates an Emirates ID number', () => {
    expect(checkEdit('eid', '784199633814894')).toEqual({ value: '784-1996-3381489-4', error: null });
    expect(checkEdit('eid', '784199633814895').error).toBe('err_EID_CHECKSUM');
  });
  it('normalizes dates', () => {
    expect(checkEdit('date', '7/5/1996')).toEqual({ value: '07/05/1996', error: null });
    expect(checkEdit('date', '1996-05-07').value).toBe('07/05/1996');
    expect(checkEdit('date', '31/02/2027').error).toBe('err_REVIEW_DATE');
  });
  it('tidies text', () => {
    expect(checkEdit('text', '  Software   Engineer ')).toEqual({ value: 'Software Engineer', error: null });
  });
});

describe('identity verification', () => {
  const values = () => Object.fromEntries(buildReview(sides).map((f) => [f.key, f.value]));

  it('turns the reviewed values into the document details', () => {
    expect(toDocFields('EMIRATES_ID', values())).toMatchObject({
      documentNumber: '784-1996-3381489-4', expiryDate: '2027-04-27', dateOfBirth: '1996-05-07', fullName: 'Mahmoud Mohsen Mohamed Ahmed',
    });
  });
  it('puts validation errors on the review rows', () => {
    const v = { ...values(), expiryDate: '01/01/2099' };
    expect(validateReview('EMIRATES_ID', v)).toEqual({});
    expect(validateReview('EMIRATES_ID', { ...v, expiryDate: '01/01/2020' })).toEqual({ expiryDate: 'err_EXPIRED' });
    expect(validateReview('EMIRATES_ID', { ...v, emiratesIdNumber: '784-1996-3381489-5' })).toEqual({ emiratesIdNumber: 'err_EID_CHECKSUM' });
  });
  it('adds empty rows for required details OCR did not read', () => {
    const rows = withRequired('PASSPORT', buildReview([{ type: 'PASSPORT', res: { success: true, fields: { surname: 'ALI' } } }]));
    expect(rows.map((r) => [r.key, r.value, r.status, r.required])).toEqual([
      ['passportNumber', '', 'missing', true], ['expiryDate', '', 'missing', true], ['surname', 'ALI', 'read', undefined],
    ]);
    expect(validateReview('EMIRATES_ID', { fullNameEn: 'Ahmed Ali', emiratesIdNumber: '', expiryDate: '' }))
      .toEqual({ emiratesIdNumber: 'err_REQUIRED', expiryDate: 'err_REQUIRED' });
  });
});

describe('withMissing', () => {
  it('shows every Emirates ID detail OCR missed as an empty row', () => {
    const rows = withMissing('EMIRATES_ID', buildReview([{ type: 'EMIRATES_ID_FRONT', res: front }]));
    const missing = rows.filter((r) => r.status === 'missing').map((r) => r.key);
    expect(missing).toEqual(['gender', 'cardNumber', 'issuingPlace', 'occupation', 'employer']);
    expect(rows.find((r) => r.key === 'cardNumber')).toMatchObject({ value: '', required: false, group: 'document' });
  });
  it('treats aliases as present and marks required rows', () => {
    const rows = withRequired('EMIRATES_ID', buildReview([{ type: 'EMIRATES_ID_FRONT', res: { success: true, fields: { idNumber: '784-1990-1234567-6', sex: 'M' } } }]));
    expect(rows.some((r) => r.key === 'emiratesIdNumber')).toBe(false);
    expect(rows.some((r) => r.key === 'gender')).toBe(false);
    expect(rows.find((r) => r.key === 'expiryDate')).toMatchObject({ status: 'missing', required: true, kind: 'date' });
  });
});

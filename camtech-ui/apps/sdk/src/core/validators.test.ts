import { describe, expect, it } from 'vitest';
import { buildMrzLine2 } from '../mocks/server';
import { cleanDocFields, validateDocFields } from './doc-form';
import { EMPTY_FIELDS } from './fields';
import {
  eidDigits, findMrzLine2, formatEid, isIsoDate, luhnValid, mrzCheckDigit, normalizeMrz, toIsoDate, todayIso,
  validateBirthDate, validateCountry, validateEid, validateExpiry, validateMrzLine2, validatePassportNumber,
} from './validators';

describe('Emirates ID', () => {
  it('checks the Luhn digit', () => {
    expect(luhnValid('784199012345676')).toBe(true);
    expect(luhnValid('784199012345671')).toBe(false);
    expect(luhnValid('79927398713')).toBe(true);
    expect(luhnValid('')).toBe(false);
    expect(luhnValid('12a4')).toBe(false);
  });

  it('validates format, prefix and checksum', () => {
    expect(validateEid('784-1990-1234567-6')).toBeNull();
    expect(validateEid('784199012345676')).toBeNull();
    expect(validateEid(' 784 1990 1234567 6 ')).toBeNull();
    expect(validateEid('')).toBe('REQUIRED');
    expect(validateEid('784-1990-123456')).toBe('FORMAT');
    expect(validateEid('784-1990-1234567-6x')).toBe('FORMAT');
    expect(validateEid('785-1990-1234567-5')).toBe('PREFIX');
    expect(validateEid('784-1990-1234567-1')).toBe('CHECKSUM');
  });

  it('formats while typing', () => {
    expect(formatEid('784')).toBe('784');
    expect(formatEid('7841990')).toBe('784-1990');
    expect(formatEid('784199012345676')).toBe('784-1990-1234567-6');
    expect(formatEid('784-1990-1234567-6999')).toBe('784-1990-1234567-6');
    expect(eidDigits('a7b8c4')).toBe('784');
  });
});

describe('dates', () => {
  it('recognises real calendar dates only', () => {
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2023-02-29')).toBe(false);
    expect(isIsoDate('2023-13-01')).toBe(false);
    expect(isIsoDate('2023-1-01')).toBe(false);
  });

  it('converts common formats to YYYY-MM-DD', () => {
    expect(toIsoDate('28/02/2027')).toBe('2027-02-28');
    expect(toIsoDate('1-3-2025')).toBe('2025-03-01');
    expect(toIsoDate('2027.02.28')).toBe('2027-02-28');
    expect(toIsoDate('2027-02-28')).toBe('2027-02-28');
    expect(toIsoDate('31/02/2027')).toBeNull();
    expect(toIsoDate('soon')).toBeNull();
    expect(toIsoDate(null)).toBeNull();
  });

  it('validates expiry and birth dates against today', () => {
    const today = '2026-10-08';
    expect(validateExpiry('2026-10-08', today)).toBeNull();
    expect(validateExpiry('2026-10-07', today)).toBe('EXPIRED');
    expect(validateExpiry('', today)).toBe('REQUIRED');
    expect(validateExpiry('2026-02-30', today)).toBe('FORMAT');
    expect(validateBirthDate('', today)).toBeNull();
    expect(validateBirthDate('', today, true)).toBe('REQUIRED');
    expect(validateBirthDate('1990-01-15', today)).toBeNull();
    expect(validateBirthDate('2026-10-08', today)).toBe('FUTURE');
    expect(validateBirthDate('1880-01-01', today)).toBe('TOO_OLD');
  });

  it('formats today locally', () => {
    expect(todayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('MRZ (ICAO 9303)', () => {
  it('computes check digits with weights 7-3-1', () => {
    // ICAO 9303 part 3 specimen
    expect(mrzCheckDigit('L898902C3')).toBe(6);
    expect(mrzCheckDigit('740812')).toBe(2);
    expect(mrzCheckDigit('120415')).toBe(9);
    expect(mrzCheckDigit('ZE184226B<<<<<')).toBe(1);
    expect(mrzCheckDigit('<<<<')).toBe(0);
  });

  it('accepts the ICAO specimen line 2 and parses it', () => {
    const line = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
    const r = validateMrzLine2(line, '2010-01-01');
    expect(r.errors).toEqual([]);
    expect(r.parsed).toMatchObject({
      documentNumber: 'L898902C3', nationality: 'UTO', dateOfBirth: '1974-08-12', sex: 'F', expiryDate: '2012-04-15',
      personalNumber: 'ZE184226B',
    });
  });

  it('reports each wrong check digit', () => {
    const good = 'L898902C36UTO7408122F1204159ZE184226B<<<<<10';
    const badDoc = `${good.slice(0, 9)}5${good.slice(10)}`;
    expect(validateMrzLine2(badDoc).errors).toEqual(expect.arrayContaining(['DOCUMENT_NUMBER', 'COMPOSITE']));
    const badExpiry = `${good.slice(0, 27)}0${good.slice(28)}`;
    expect(validateMrzLine2(badExpiry).errors).toContain('EXPIRY_DATE');
    expect(validateMrzLine2('SHORT').errors).toEqual(['LENGTH']);
    expect(validateMrzLine2(`${good.slice(0, 43)}!`).errors).toEqual(['CHARSET']);
    expect(validateMrzLine2('').errors).toEqual(['REQUIRED']);
  });

  it('accepts an empty personal number with a < check digit', () => {
    const line = buildMrzLine2('A12345678', 'EGY', '900115', 'M', '301231');
    expect(line).toHaveLength(44);
    expect(validateMrzLine2(line).errors).toEqual([]);
  });

  it('normalizes typed input and finds line 2 in OCR text', () => {
    expect(normalizeMrz('l898902c3 6uto')).toBe('L898902C36UTO');
    const text = 'P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<\nL898902C36UTO7408122F1204159ZE184226B<<<<<10\n';
    expect(findMrzLine2(text)).toBe('L898902C36UTO7408122F1204159ZE184226B<<<<<10');
    expect(findMrzLine2('nothing here')).toBeNull();
  });

  it('validates passport numbers and countries', () => {
    expect(validatePassportNumber('A1234567')).toBeNull();
    expect(validatePassportNumber('')).toBe('REQUIRED');
    expect(validatePassportNumber('A1-23')).toBe('FORMAT');
    expect(validateCountry('EGY')).toBeNull();
    expect(validateCountry('')).toBeNull();
    expect(validateCountry('EG')).toBe('FORMAT');
  });
});

describe('confirmation form', () => {
  const today = '2026-10-08';

  it('requires the EID number and a valid expiry', () => {
    expect(validateDocFields('EMIRATES_ID', EMPTY_FIELDS, today)).toEqual({ documentNumber: 'err_REQUIRED', expiryDate: 'err_REQUIRED' });
    const ok = { ...EMPTY_FIELDS, documentNumber: '784-1990-1234567-6', expiryDate: '2027-01-01' };
    expect(validateDocFields('EMIRATES_ID', ok, today)).toEqual({});
    expect(validateDocFields('EMIRATES_ID', { ...ok, documentNumber: '784-1990-1234567-1' }, today)).toEqual({ documentNumber: 'err_EID_CHECKSUM' });
    expect(validateDocFields('EMIRATES_ID', { ...ok, expiryDate: '2025-01-01' }, today)).toEqual({ expiryDate: 'err_EXPIRED' });
  });

  it('checks the passport MRZ only when given', () => {
    const ok = { ...EMPTY_FIELDS, documentNumber: 'A12345678', expiryDate: '2030-12-31' };
    expect(validateDocFields('PASSPORT', ok, today)).toEqual({});
    expect(validateDocFields('PASSPORT', { ...ok, mrzLine2: 'ABC' }, today)).toEqual({ mrzLine2: 'err_MRZ_LENGTH' });
    const line = buildMrzLine2('A12345678', 'EGY', '900115', 'M', '301231');
    expect(validateDocFields('PASSPORT', { ...ok, mrzLine2: line }, today)).toEqual({});
    const broken = `${line.slice(0, 43)}${(Number(line[43]) + 1) % 10}`;
    expect(validateDocFields('PASSPORT', { ...ok, mrzLine2: broken }, today)).toEqual({ mrzLine2: 'err_MRZ_CHECK' });
  });

  it('normalizes values before sending', () => {
    const cleaned = cleanDocFields('EMIRATES_ID', { ...EMPTY_FIELDS, documentNumber: '784199012345676', fullName: '  Ahmed   Hassan ', mrzLine2: 'x' });
    expect(cleaned.documentNumber).toBe('784-1990-1234567-6');
    expect(cleaned.fullName).toBe('Ahmed Hassan');
    expect(cleaned.mrzLine2).toBe('');
    const p = cleanDocFields('PASSPORT', { ...EMPTY_FIELDS, documentNumber: 'a123', issuingCountry: 'egy', mrzLine2: 'l89 8' });
    expect(p).toMatchObject({ documentNumber: 'A123', issuingCountry: 'EGY', mrzLine2: 'L898' });
  });
});

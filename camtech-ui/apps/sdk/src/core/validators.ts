// Client-side validation of the identity document details, matching the server's checks
// (Emirates ID checksum, ICAO 9303 MRZ check digits, expiry).

/** Luhn (mod 10) check over a digit string. */
export function luhnValid(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

export function eidDigits(input: string): string {
  return input.replace(/\D/g, '').slice(0, 15);
}

/** Formats as 784-YYYY-NNNNNNN-C while typing. */
export function formatEid(input: string): string {
  const d = eidDigits(input);
  const parts = [d.slice(0, 3), d.slice(3, 7), d.slice(7, 14), d.slice(14, 15)].filter(Boolean);
  return parts.join('-');
}

export type EidError = 'REQUIRED' | 'FORMAT' | 'PREFIX' | 'CHECKSUM';

/** Emirates ID number: 15 digits, starts with 784, Luhn check digit. Dashes optional. */
export function validateEid(input: string): EidError | null {
  const s = input.trim();
  if (!s) return 'REQUIRED';
  if (!/^[\d\s-]+$/.test(s)) return 'FORMAT';
  const d = s.replace(/\D/g, '');
  if (d.length !== 15) return 'FORMAT';
  if (!d.startsWith('784')) return 'PREFIX';
  if (!luhnValid(d)) return 'CHECKSUM';
  return null;
}

/** A real calendar date as YYYY-MM-DD. */
export function isIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Accepts YYYY-MM-DD, YYYY/MM/DD, DD/MM/YYYY, DD-MM-YYYY, DD.MM.YYYY; returns YYYY-MM-DD or null. */
export function toIsoDate(input: string | null | undefined): string | null {
  if (!input) return null;
  const s = input.trim();
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s);
  let iso: string | null = null;
  if (m) iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s);
  if (m) iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return iso && isIsoDate(iso) ? iso : null;
}

/** Today as YYYY-MM-DD in local time. */
export function todayIso(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export type DateError = 'REQUIRED' | 'FORMAT' | 'EXPIRED' | 'FUTURE' | 'TOO_OLD';

/** Expiry date: valid and not before today. */
export function validateExpiry(input: string, today: string = todayIso()): DateError | null {
  if (!input.trim()) return 'REQUIRED';
  const iso = toIsoDate(input);
  if (!iso) return 'FORMAT';
  if (iso < today) return 'EXPIRED';
  return null;
}

/** Date of birth: valid, in the past, under 120 years. Optional unless `required`. */
export function validateBirthDate(input: string, today: string = todayIso(), required = false): DateError | null {
  if (!input.trim()) return required ? 'REQUIRED' : null;
  const iso = toIsoDate(input);
  if (!iso) return 'FORMAT';
  if (iso >= today) return 'FUTURE';
  const minYear = Number(today.slice(0, 4)) - 120;
  if (Number(iso.slice(0, 4)) < minYear) return 'TOO_OLD';
  return null;
}

// ------------------------------------------------------------------ MRZ (ICAO 9303)

const MRZ_WEIGHTS = [7, 3, 1];

function mrzValue(ch: string): number {
  if (ch >= '0' && ch <= '9') return ch.charCodeAt(0) - 48;
  if (ch >= 'A' && ch <= 'Z') return ch.charCodeAt(0) - 55;
  return 0; // '<'
}

/** ICAO 9303 check digit (weights 7, 3, 1; A=10 … Z=35; '<'=0). */
export function mrzCheckDigit(field: string): number {
  let sum = 0;
  for (let i = 0; i < field.length; i++) sum += mrzValue(field[i]) * MRZ_WEIGHTS[i % 3];
  return sum % 10;
}

function checkDigitMatches(field: string, digit: string): boolean {
  if (digit === '<') return /^<*$/.test(field) || mrzCheckDigit(field) === 0;
  return /^\d$/.test(digit) && mrzCheckDigit(field) === Number(digit);
}

export type MrzError = 'REQUIRED' | 'LENGTH' | 'CHARSET' | 'DOCUMENT_NUMBER' | 'BIRTH_DATE' | 'EXPIRY_DATE'
  | 'PERSONAL_NUMBER' | 'COMPOSITE';

export interface MrzLine2 {
  documentNumber: string;
  nationality: string;
  dateOfBirth: string | null;
  sex: string;
  expiryDate: string | null;
  personalNumber: string;
}

/** Normalizes typed MRZ text: upper case, no spaces, common OCR slips («, Ò…) to '<'. */
export function normalizeMrz(input: string): string {
  return input.toUpperCase().replace(/\s+/g, '').replace(/[«‹＜]/g, '<');
}

function yymmdd(s: string, kind: 'birth' | 'expiry', today: string): string | null {
  if (!/^\d{6}$/.test(s)) return null;
  const yy = Number(s.slice(0, 2));
  const currentYy = Number(today.slice(2, 4));
  const century = kind === 'birth' ? (yy > currentYy ? 1900 : 2000) : (yy >= 70 ? 1900 : 2000);
  const iso = `${century + yy}-${s.slice(2, 4)}-${s.slice(4, 6)}`;
  return isIsoDate(iso) ? iso : null;
}

/** Validates the second line of a TD3 (passport) MRZ: 44 characters with 5 check digits. */
export function validateMrzLine2(input: string, today: string = todayIso()): { errors: MrzError[]; parsed: MrzLine2 | null } {
  const line = normalizeMrz(input);
  if (!line) return { errors: ['REQUIRED'], parsed: null };
  if (line.length !== 44) return { errors: ['LENGTH'], parsed: null };
  if (!/^[A-Z0-9<]{44}$/.test(line)) return { errors: ['CHARSET'], parsed: null };
  const errors: MrzError[] = [];
  const docNo = line.slice(0, 9);
  const dob = line.slice(13, 19);
  const exp = line.slice(21, 27);
  const personal = line.slice(28, 42);
  if (!checkDigitMatches(docNo, line[9])) errors.push('DOCUMENT_NUMBER');
  if (!checkDigitMatches(dob, line[19])) errors.push('BIRTH_DATE');
  if (!checkDigitMatches(exp, line[27])) errors.push('EXPIRY_DATE');
  if (!checkDigitMatches(personal, line[42])) errors.push('PERSONAL_NUMBER');
  const composite = line.slice(0, 10) + line.slice(13, 20) + line.slice(21, 43);
  if (!checkDigitMatches(composite, line[43])) errors.push('COMPOSITE');
  return {
    errors,
    parsed: {
      documentNumber: docNo.replace(/<+$/g, '').replace(/</g, ''),
      nationality: line.slice(10, 13).replace(/</g, ''),
      dateOfBirth: yymmdd(dob, 'birth', today),
      sex: line[20] === '<' ? '' : line[20],
      expiryDate: yymmdd(exp, 'expiry', today),
      personalNumber: personal.replace(/<+$/g, ''),
    },
  };
}

/** Finds a TD3 line 2 in OCR text (44 chars of [A-Z0-9<] with valid check digits preferred). */
export function findMrzLine2(text: string | null | undefined, today: string = todayIso()): string | null {
  if (!text) return null;
  const candidates = text.toUpperCase().split(/\r?\n/).map((l) => l.replace(/\s+/g, ''))
    // Line 1 holds the names; line 2 has the birth date (digits) at positions 13–18.
    .filter((l) => /^[A-Z0-9<]{44}$/.test(l) && /^\d{6}$/.test(l.slice(13, 19)));
  const valid = candidates.find((l) => validateMrzLine2(l, today).errors.length === 0);
  return valid ?? candidates[0] ?? null;
}

/** ISO 3166 alpha-3 country code. */
export function validateCountry(input: string): 'FORMAT' | null {
  if (!input.trim()) return null;
  return /^[A-Za-z]{3}$/.test(input.trim()) ? null : 'FORMAT';
}

/** Passport number: 5–9 letters/digits. */
export function validatePassportNumber(input: string): 'REQUIRED' | 'FORMAT' | null {
  const s = input.trim().toUpperCase();
  if (!s) return 'REQUIRED';
  return /^[A-Z0-9]{5,9}$/.test(s) ? null : 'FORMAT';
}

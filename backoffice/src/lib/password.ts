// Password helpers for tenant portal users (created by CamTech operators in the Backoffice).
// Kept free of imports so it can be unit tested with plain Node.

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const DIGITS = '23456789';
/** Letters and digits only, without look-alikes (0/O, 1/l/I), so it can be read out or typed safely. */
export const PASSWORD_ALPHABET = LETTERS + DIGITS;

/** Minimum the server accepts (WEAK_PASSWORD below this). */
export const MIN_PASSWORD_LENGTH = 10;

function randomIndex(max: number): number {
  // Rejection sampling: avoids modulo bias.
  const limit = Math.floor(0x1_0000_0000 / max) * max;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}

/** Random password of letters and digits with at least one letter and at least one digit. */
export function generatePassword(length = 16): string {
  if (length < 2) throw new Error('length must be at least 2');
  for (;;) {
    let out = '';
    for (let i = 0; i < length; i++) out += PASSWORD_ALPHABET[randomIndex(PASSWORD_ALPHABET.length)];
    if (/[A-Za-z]/.test(out) && /\d/.test(out)) return out;
  }
}

/** Same rule as the server: at least 10 characters, with letters and digits. */
export function isStrongPassword(p: string): boolean {
  return p.length >= MIN_PASSWORD_LENGTH && /[A-Za-z]/.test(p) && /\d/.test(p);
}

export const PASSWORD_RULE_TEXT = `At least ${MIN_PASSWORD_LENGTH} characters, with letters and digits.`;

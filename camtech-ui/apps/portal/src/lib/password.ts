// Password rules (same as the server: at least 10 characters with letters and digits) and the generator.

export const PASSWORD_MIN_LENGTH = 10;

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz';
const DIGITS = '23456789';
const ALPHABET = LETTERS + DIGITS;

export function hasLettersAndDigits(password: string): boolean {
  return /[A-Za-z]/.test(password) && /\d/.test(password);
}

export function isStrongPassword(password: string): boolean {
  return password.length >= PASSWORD_MIN_LENGTH && hasLettersAndDigits(password);
}

/** Uniform random index below `n` from the crypto RNG (rejection sampling: no modulo bias). */
function randomIndex(n: number, random: RandomFill): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    random(buf);
    if (buf[0] < limit) return buf[0] % n;
  }
}

/** Fills the buffer with random values. */
export type RandomFill = (buf: Uint32Array<ArrayBuffer>) => unknown;

const cryptoRandom: RandomFill = (buf) => crypto.getRandomValues(buf);

/**
 * Random password of letters and digits (look-alikes such as 0/O and 1/l/I left out),
 * with at least one letter and one digit. Default length 16.
 */
export function generatePassword(length = 16, random: RandomFill = cryptoRandom): string {
  const n = Math.max(2, length);
  const chars = Array.from({ length: n }, () => ALPHABET[randomIndex(ALPHABET.length, random)]);
  // Guarantee a letter and a digit, at two distinct random positions. With no digit every character is a
  // letter (n >= 2), so placing the digit never removes the last letter.
  const letterAt = randomIndex(n, random);
  let digitAt = randomIndex(n - 1, random);
  if (digitAt >= letterAt) digitAt++;
  if (!/[A-Za-z]/.test(chars.join(''))) chars[letterAt] = LETTERS[randomIndex(LETTERS.length, random)];
  if (!/\d/.test(chars.join(''))) chars[digitAt] = DIGITS[randomIndex(DIGITS.length, random)];
  return chars.join('');
}

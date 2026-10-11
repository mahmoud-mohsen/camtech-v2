import { describe, expect, it } from 'vitest';
import { generatePassword, hasLettersAndDigits, isStrongPassword } from './password';

describe('generatePassword', () => {
  it('makes 16 letters/digits by default, always with a letter and a digit', () => {
    for (let i = 0; i < 500; i++) {
      const p = generatePassword();
      expect(p).toMatch(/^[A-Za-z0-9]{16}$/);
      expect(hasLettersAndDigits(p)).toBe(true);
      expect(isStrongPassword(p)).toBe(true);
    }
  });

  it('honours the length and is not repetitive', () => {
    expect(generatePassword(24)).toHaveLength(24);
    expect(new Set(Array.from({ length: 50 }, () => generatePassword())).size).toBe(50);
  });

  it('adds a digit when the random source only yields letters, and a letter when it only yields digits', () => {
    // Index 0 of the alphabet is a letter; a source of zeros gives only letters before the fix-up.
    const zeros = (buf: Uint32Array) => buf.fill(0);
    const p = generatePassword(16, zeros);
    expect(p).toHaveLength(16);
    expect(hasLettersAndDigits(p)).toBe(true);
    // The last alphabet entry is a digit: a source of 55 gives only digits before the fix-up.
    const high = (buf: Uint32Array) => buf.fill(55);
    const q = generatePassword(12, high);
    expect(hasLettersAndDigits(q)).toBe(true);
  });
});

describe('isStrongPassword', () => {
  it('needs 10+ characters with letters and digits', () => {
    expect(isStrongPassword('abcdefghij')).toBe(false);
    expect(isStrongPassword('1234567890')).toBe(false);
    expect(isStrongPassword('abc12345')).toBe(false);
    expect(isStrongPassword('abcde12345')).toBe(true);
  });
});

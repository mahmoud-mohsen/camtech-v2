// Run with: npm test (Node's built-in test runner, TypeScript via --experimental-strip-types).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { generatePassword, isStrongPassword, PASSWORD_ALPHABET } from '../src/lib/password.ts';

test('generates 16 letters/digits by default, with at least one letter and one digit', () => {
  for (let i = 0; i < 2000; i++) {
    const p = generatePassword();
    assert.equal(p.length, 16);
    assert.match(p, /^[A-Za-z0-9]+$/);
    assert.match(p, /[A-Za-z]/);
    assert.match(p, /\d/);
    assert.ok(isStrongPassword(p), p);
  }
});

test('short passwords still contain a letter and a digit', () => {
  for (let i = 0; i < 2000; i++) {
    const p = generatePassword(2);
    assert.match(p, /^(?=.*[A-Za-z])(?=.*\d)[A-Za-z0-9]{2}$/);
  }
});

test('only uses the alphabet and varies', () => {
  const seen = new Set<string>();
  for (let i = 0; i < 200; i++) {
    const p = generatePassword();
    for (const c of p) assert.ok(PASSWORD_ALPHABET.includes(c), c);
    seen.add(p);
  }
  assert.equal(seen.size, 200);
});

test('isStrongPassword matches the server rule', () => {
  assert.equal(isStrongPassword('abcdefgh12'), true);
  assert.equal(isStrongPassword('abcdefg12'), false); // 9 chars
  assert.equal(isStrongPassword('abcdefghij'), false); // no digit
  assert.equal(isStrongPassword('1234567890'), false); // no letter
});

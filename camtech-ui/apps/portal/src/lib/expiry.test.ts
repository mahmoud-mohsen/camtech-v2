import { describe, expect, it } from 'vitest';
import { exportFileName } from './download';
import { daysUntil, expiringBeforeFor, expiryState, ymd } from './expiry';

const today = new Date(2026, 9, 10); // 10 Oct 2026, local time

describe('document expiry', () => {
  it('counts whole days to the expiry date', () => {
    expect(daysUntil('2026-10-10', today)).toBe(0);
    expect(daysUntil('2026-10-11', today)).toBe(1);
    expect(daysUntil('2026-10-09', today)).toBe(-1);
    expect(daysUntil('2027-10-10', today)).toBe(365);
  });

  it('flags expired and soon-to-expire documents against the warning period', () => {
    expect(expiryState(null, 30, today)).toBeNull();
    expect(expiryState('2026-10-01', 30, today)).toBe('EXPIRED');
    expect(expiryState('2026-10-10', 30, today)).toBe('SOON');
    expect(expiryState('2026-11-09', 30, today)).toBe('SOON');
    expect(expiryState('2026-11-10', 30, today)).toBe('VALID');
    expect(expiryState('2026-10-15', 3, today)).toBe('VALID');
  });

  it('builds the exclusive expiringBefore filter that includes the last warning day', () => {
    expect(expiringBeforeFor(30, today)).toBe('2026-11-10');
    expect(expiringBeforeFor(1, today)).toBe('2026-10-12');
    expect(expiringBeforeFor(365, new Date(2026, 11, 31))).toBe('2028-01-01');
    expect(ymd(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('names the export file like the server', () => {
    expect(exportFileName('abc-123')).toBe('person-abc-123.zip');
  });
});

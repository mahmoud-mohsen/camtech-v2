import { describe, expect, it } from 'vitest';
import { hasTranslation, MESSAGE_KEYS } from '../i18n';
import { permissionsFor, ROLES } from './permissions';

describe('permissionsFor (usePermissions)', () => {
  it('OWNER can do everything', () => {
    expect(permissionsFor('OWNER')).toEqual({ role: 'OWNER', canBuild: true, canReview: true, isOwner: true });
  });

  it('DEVELOPER builds but does not review or manage users', () => {
    expect(permissionsFor('DEVELOPER')).toEqual({ role: 'DEVELOPER', canBuild: true, canReview: false, isOwner: false });
  });

  it('REVIEWER reviews but does not build or manage users', () => {
    expect(permissionsFor('REVIEWER')).toEqual({ role: 'REVIEWER', canBuild: false, canReview: true, isOwner: false });
  });

  it('VIEWER and signed-out users can change nothing', () => {
    expect(permissionsFor('VIEWER')).toEqual({ role: 'VIEWER', canBuild: false, canReview: false, isOwner: false });
    expect(permissionsFor(null)).toEqual({ role: null, canBuild: false, canReview: false, isOwner: false });
    expect(permissionsFor(undefined).canBuild).toBe(false);
  });

  it('lists every role once, most powerful first', () => {
    expect(ROLES).toEqual(['OWNER', 'DEVELOPER', 'REVIEWER', 'VIEWER']);
  });
});

describe('i18n', () => {
  it('has Arabic text for every sign-in, password, role and users string', () => {
    const scoped = MESSAGE_KEYS.filter((k) => /^(auth|password|role|users)\./.test(k) || k === 'nav.settings' || k.startsWith('settings.'));
    expect(scoped.length).toBeGreaterThan(50);
    expect(scoped.filter((k) => !hasTranslation('ar', k))).toEqual([]);
  });
});

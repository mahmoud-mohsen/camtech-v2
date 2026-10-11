import type { LivenessPolicy, LivenessSettings } from '@camtech/api-client';
import { describe, expect, it } from 'vitest';
import { countBounds, defaultMode, defaultSettings, drawHint, selectableModes, STARTING_POLICY, startingPolicy, validateLiveness } from './liveness';

const wide: LivenessPolicy = { allowedModes: ['ACTIVE', 'PASSIVE'], allowedActions: ['TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'SMILE'], minActions: 1, maxActions: 3, requireSpareAction: false };
const s = (mode: LivenessSettings['mode'], actions: LivenessSettings['actions'], challengeCount: number): LivenessSettings => ({ mode, actions, challengeCount });
const code = (flow: string, x: LivenessSettings, p: LivenessPolicy) => validateLiveness(flow, x, p)?.code ?? null;

describe('validateLiveness', () => {
  it('accepts the defaults of the starting policy', () => {
    expect(defaultSettings(STARTING_POLICY)).toEqual(s('ACTIVE', ['TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'LOOK_UP', 'LOOK_DOWN', 'SMILE', 'MOVE_CLOSER'], 2));
    expect(code('SELFIE_ID_VERIFICATION', defaultSettings(STARTING_POLICY), STARTING_POLICY)).toBeNull();
  });

  it('starts face authentication and the liveness check PASSIVE, the face-registering flows ACTIVE', () => {
    for (const flow of ['FACE_AUTHENTICATION', 'LIVENESS_CHECK']) {
      expect(startingPolicy(flow).allowedModes).toEqual(['ACTIVE', 'PASSIVE']);
      expect(defaultSettings(startingPolicy(flow), flow).mode).toBe('PASSIVE');
      expect(defaultMode(STARTING_POLICY, flow)).toBe('ACTIVE');
    }
    for (const flow of ['SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT']) {
      expect(startingPolicy(flow).allowedModes).toEqual(['ACTIVE']);
      expect(defaultMode(wide, flow)).toBe('ACTIVE');
    }
  });

  it('never allows PASSIVE for onboarding or face registration, even when the policy lists it', () => {
    expect(selectableModes('SELFIE_ID_VERIFICATION', wide)).toEqual(['ACTIVE']);
    expect(selectableModes('FACE_ENROLLMENT', wide)).toEqual(['ACTIVE']);
    expect(selectableModes('LIVENESS_CHECK', wide)).toEqual(['ACTIVE', 'PASSIVE']);
    expect(selectableModes('FACE_AUTHENTICATION', wide)).toEqual(['ACTIVE', 'PASSIVE']);
    expect(code('SELFIE_ID_VERIFICATION', s('PASSIVE', ['BLINK'], 1), wide)).toBe('MODE_NOT_ALLOWED');
    expect(code('FACE_ENROLLMENT', s('PASSIVE', ['BLINK'], 1), wide)).toBe('MODE_NOT_ALLOWED');
    expect(code('FACE_AUTHENTICATION', s('PASSIVE', ['BLINK'], 1), STARTING_POLICY)).toBe('MODE_NOT_ALLOWED');
  });

  it('mirrors the server codes, in order', () => {
    const f = 'FACE_AUTHENTICATION';
    expect(code(f, s('ACTIVE', ['BLINK', 'BLINK'], 1), wide)).toBe('DUPLICATE_ACTION');
    expect(code(f, s('ACTIVE', ['LOOK_UP', 'BLINK'], 1), wide)).toBe('ACTION_NOT_ALLOWED');
    expect(code(f, s('ACTIVE', ['BLINK', 'SMILE', 'TURN_LEFT', 'TURN_RIGHT'], 4), wide)).toBe('COUNT_OUT_OF_RANGE');
    expect(code(f, s('ACTIVE', ['BLINK'], 2), wide)).toBe('COUNT_EXCEEDS_SELECTION');
    expect(code(f, s('ACTIVE', ['BLINK', 'SMILE'], 2), wide)).toBeNull();
    expect(code(f, s('ACTIVE', ['BLINK', 'SMILE'], 2), { ...wide, requireSpareAction: true })).toBe('SPARE_ACTION_REQUIRED');
    expect(code(f, s('ACTIVE', ['TURN_LEFT', 'TURN_RIGHT'], 2), STARTING_POLICY)).toBe('SPARE_ACTION_REQUIRED');
  });

  it('skips the count rules in PASSIVE mode', () => {
    expect(code('FACE_AUTHENTICATION', s('PASSIVE', ['BLINK'], 3), wide)).toBeNull();
  });
});

describe('helpers', () => {
  it('bounds the count by the policy and the selection', () => {
    expect(countBounds(STARTING_POLICY, 3)).toEqual({ min: 2, max: 3 });
    expect(countBounds(STARTING_POLICY, 6)).toEqual({ min: 2, max: 4 });
    expect(countBounds(STARTING_POLICY, 1)).toEqual({ min: 2, max: 2 });
  });

  it('describes the draw', () => {
    expect(drawHint(2, 3)).toBe('Each user gets 2 of these 3, in random order');
    expect(drawHint(3, 3)).toBe('Each user does all 3, in random order');
    expect(drawHint(2, 0)).toBe('');
  });
});

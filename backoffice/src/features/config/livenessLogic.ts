// Liveness policy rules (mirrors the server), shared by the tenant screen and the mock backend.
import type { ChallengeAction, LivenessMode, LivenessPolicy, LivenessSettings } from '../../api/types';

/** Every challenge, in display order. */
export const CHALLENGE_ACTIONS: readonly ChallengeAction[] = ['TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'LOOK_UP', 'LOOK_DOWN', 'SMILE', 'MOVE_CLOSER'];
export const LIVENESS_MODES: readonly LivenessMode[] = ['ACTIVE', 'PASSIVE'];
/** Onboarding and face registration always use active liveness: PASSIVE may never be allowed for them. */
export const ACTIVE_ONLY_FLOWS: readonly string[] = ['SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT'];
/** Why PASSIVE is blocked for an active-only flow (validation message and tooltip). */
export const ACTIVE_ONLY_REASON = 'Onboarding and face registration always use active liveness';

/** React Query key of a tenant's liveness policies. */
export const livenessKey = (tenantId: number) => ['liveness-policies', tenantId] as const;

export const MIN_ACTIONS = 1;
export const MAX_ACTIONS = 7;

export const sortActions = (a: readonly ChallengeAction[]): ChallengeAction[] => CHALLENGE_ACTIONS.filter((x) => a.includes(x));

export interface PolicyIssue {
  code: 'MODE_NOT_ALLOWED' | 'VALIDATION_ERROR';
  message: string;
}

/** First rule the policy breaks, or null when it can be saved. */
export function validatePolicy(flowCode: string, p: LivenessPolicy): PolicyIssue | null {
  if (!p.allowedModes.length) return { code: 'MODE_NOT_ALLOWED', message: 'Allow at least one mode.' };
  if (p.allowedModes.includes('PASSIVE') && ACTIVE_ONLY_FLOWS.includes(flowCode)) {
    return { code: 'MODE_NOT_ALLOWED', message: `${ACTIVE_ONLY_REASON}: PASSIVE cannot be allowed.` };
  }
  if (!p.allowedActions.length) return { code: 'VALIDATION_ERROR', message: 'Allow at least one challenge.' };
  if (new Set(p.allowedActions).size !== p.allowedActions.length) return { code: 'VALIDATION_ERROR', message: 'A challenge is listed twice.' };
  const ok = (n: number) => Number.isInteger(n) && n >= MIN_ACTIONS && n <= MAX_ACTIONS;
  if (!ok(p.minActions) || !ok(p.maxActions)) return { code: 'VALIDATION_ERROR', message: `Min and max challenges must be between ${MIN_ACTIONS} and ${MAX_ACTIONS}.` };
  if (p.maxActions < p.minActions) return { code: 'VALIDATION_ERROR', message: 'Max challenges cannot be lower than min challenges.' };
  const needed = p.minActions + (p.requireSpareAction ? 1 : 0);
  if (p.allowedActions.length < needed) {
    return {
      code: 'VALIDATION_ERROR',
      message: `Allow at least ${needed} challenges: tenants must be able to select ${p.minActions}${p.requireSpareAction ? ' plus one spare' : ''}.`,
    };
  }
  return null;
}

/** Why the tenant's settings would not fit the policy, or null when they still fit. */
export function settingsConflict(s: LivenessSettings, p: LivenessPolicy): string | null {
  if (!p.allowedModes.includes(s.mode)) return `mode ${s.mode} is no longer allowed`;
  const notAllowed = s.actions.filter((a) => !p.allowedActions.includes(a));
  if (notAllowed.length) return `${notAllowed.join(', ')} would no longer be allowed`;
  if (s.mode === 'PASSIVE') return null;
  if (s.challengeCount < p.minActions || s.challengeCount > p.maxActions) return `${s.challengeCount} challenges per user is outside ${p.minActions}–${p.maxActions}`;
  if (s.challengeCount > s.actions.length) return 'more challenges per user than selected';
  if (p.requireSpareAction && s.actions.length < s.challengeCount + 1) return 'no spare challenge selected';
  return null;
}

/** What a tenant gets before it saves its own settings. */
export function defaultSettings(p: LivenessPolicy, flowCode?: string): LivenessSettings {
  const passive = !!flowCode && PASSIVE_DEFAULT_FLOWS.includes(flowCode) && p.allowedModes.includes('PASSIVE');
  const mode: LivenessMode = (flowCode && ACTIVE_ONLY_FLOWS.includes(flowCode)) || (!passive && p.allowedModes.includes('ACTIVE')) ? 'ACTIVE' : 'PASSIVE';
  return { mode, actions: sortActions(p.allowedActions), challengeCount: p.minActions };
}

/** Flows that register nothing: PASSIVE unless the tenant picks ACTIVE (same as the server). */
export const PASSIVE_DEFAULT_FLOWS: readonly string[] = ['FACE_AUTHENTICATION', 'LIVENESS_CHECK'];

/** Starting policy of the flows that register a face (ACTIVE only). */
export const STARTING_POLICY: LivenessPolicy = {
  allowedModes: ['ACTIVE'],
  allowedActions: [...CHALLENGE_ACTIONS],
  minActions: 2,
  maxActions: 4,
  requireSpareAction: true,
};

/** Starting policy for a flow: both modes for face authentication and the liveness check. */
export function startingPolicy(flowCode: string): LivenessPolicy {
  const p = structuredClone(STARTING_POLICY);
  return PASSIVE_DEFAULT_FLOWS.includes(flowCode) ? { ...p, allowedModes: ['ACTIVE', 'PASSIVE'] } : p;
}

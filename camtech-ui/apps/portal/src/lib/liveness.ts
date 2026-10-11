// Liveness settings per flow: the rules the server applies to a tenant's settings, mirrored for inline
// validation in the portal and for the mock backend.
import { CHALLENGE_ACTIONS, type ChallengeAction, type LivenessMode, type LivenessPolicy, type LivenessSettings } from '@camtech/api-client';
import { t, type MessageKey } from '../i18n';

export type LivenessErrorCode =
  | 'MODE_NOT_ALLOWED'
  | 'DUPLICATE_ACTION'
  | 'ACTION_NOT_ALLOWED'
  | 'COUNT_OUT_OF_RANGE'
  | 'COUNT_EXCEEDS_SELECTION'
  | 'SPARE_ACTION_REQUIRED';

export interface LivenessIssue {
  code: LivenessErrorCode;
  message: string;
}

/** Onboarding and face registration always use active liveness: PASSIVE is never offered for them. */
export const ACTIVE_ONLY_FLOWS: readonly string[] = ['SELFIE_ID_VERIFICATION', 'FACE_ENROLLMENT'];

export const actionLabel = (a: ChallengeAction) => t(`liveness.action.${a}` as MessageKey);
export const modeLabel = (m: LivenessMode) => t(`liveness.mode.${m}` as MessageKey);

/** Actions in display order (the order of CHALLENGE_ACTIONS), without duplicates. */
export function sortActions(actions: readonly ChallengeAction[]): ChallengeAction[] {
  return CHALLENGE_ACTIONS.filter((a) => actions.includes(a));
}

/** Modes the tenant may pick for a flow (PASSIVE never for onboarding, whatever the policy says). */
export function selectableModes(flowCode: string, policy: LivenessPolicy): LivenessMode[] {
  return (['ACTIVE', 'PASSIVE'] as const).filter((m) => policy.allowedModes.includes(m) && !(m === 'PASSIVE' && ACTIVE_ONLY_FLOWS.includes(flowCode)));
}

/** Bounds for the "challenges per user" input: the policy range, capped by what is selected. */
export function countBounds(policy: LivenessPolicy, selected: number): { min: number; max: number } {
  return { min: policy.minActions, max: Math.max(policy.minActions, Math.min(policy.maxActions, selected)) };
}

/**
 * First rule the settings break, or null when the server would accept them. Same order and codes as the
 * server. In PASSIVE mode no challenge is done, so the count rules don't apply.
 */
export function validateLiveness(flowCode: string, s: LivenessSettings, policy: LivenessPolicy): LivenessIssue | null {
  const issue = (code: LivenessErrorCode, vars?: Record<string, string | number>): LivenessIssue => ({ code, message: t(`liveness.error.${code}` as MessageKey, vars) });
  if (!selectableModes(flowCode, policy).includes(s.mode)) return issue('MODE_NOT_ALLOWED', { mode: s.mode });
  if (new Set(s.actions).size !== s.actions.length) return issue('DUPLICATE_ACTION');
  const notAllowed = s.actions.find((a) => !policy.allowedActions.includes(a));
  if (notAllowed) return issue('ACTION_NOT_ALLOWED', { action: notAllowed });
  if (s.mode === 'PASSIVE') return null;
  if (!Number.isInteger(s.challengeCount) || s.challengeCount < policy.minActions || s.challengeCount > policy.maxActions) {
    return issue('COUNT_OUT_OF_RANGE', { min: policy.minActions, max: policy.maxActions });
  }
  if (s.challengeCount > s.actions.length) return issue('COUNT_EXCEEDS_SELECTION', { count: s.challengeCount, selected: s.actions.length });
  if (policy.requireSpareAction && s.actions.length < s.challengeCount + 1) return issue('SPARE_ACTION_REQUIRED', { needed: s.challengeCount + 1 });
  return null;
}

/** "Each user gets 2 of these 3, in random order" / "Each user does all 3, in random order". */
export function drawHint(challengeCount: number, selected: number): string {
  if (selected <= 0) return '';
  return challengeCount >= selected ? t('liveness.hint.all', { n: selected }) : t('liveness.hint.some', { count: challengeCount, n: selected });
}

/** Settings a tenant gets before saving anything (the policy defaults). */
export function defaultSettings(policy: LivenessPolicy, flowCode?: string): LivenessSettings {
  return { mode: defaultMode(policy, flowCode), actions: sortActions(policy.allowedActions), challengeCount: policy.minActions };
}

/** Flows that register nothing: PASSIVE unless the tenant picks ACTIVE (same as the server). */
export const PASSIVE_DEFAULT_FLOWS: readonly string[] = ['FACE_AUTHENTICATION', 'LIVENESS_CHECK'];

/** The mode a tenant that saved nothing runs with. */
export function defaultMode(policy: LivenessPolicy, flowCode?: string): LivenessMode {
  if (flowCode && ACTIVE_ONLY_FLOWS.includes(flowCode)) return 'ACTIVE';
  if (flowCode && PASSIVE_DEFAULT_FLOWS.includes(flowCode) && policy.allowedModes.includes('PASSIVE')) return 'PASSIVE';
  return policy.allowedModes.includes('ACTIVE') ? 'ACTIVE' : 'PASSIVE';
}

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

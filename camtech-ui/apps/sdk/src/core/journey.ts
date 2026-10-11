// Journey planning (which flows run, from the capabilities) and the journey runner state.
import type {
  Capabilities, FlowCapability, IdDocumentType, LivenessChallengeRequest, LivenessChallengeTarget, LivenessMode,
} from '@camtech/api-client';
import { SUPPORTED_CHALLENGE_ACTIONS } from '@camtech/capture-core';
import { ID_DOCUMENT_TYPES, type JourneyFlow, type ScanType } from '../config/options';
import type { FlowResult } from './protocol';

export interface SkippedFlow {
  flow: JourneyFlow;
  reason: 'NOT_ALLOWED' | 'SUBJECT_REQUIRED';
}

export interface JourneyPlan {
  flows: JourneyFlow[];
  skipped: SkippedFlow[];
}

/** Flows bound to a person: face authentication matches, face enrollment registers, the face of `subjectRef`. */
export function needsSubject(flow: JourneyFlow): boolean {
  return flow === 'FACE_AUTHENTICATION' || flow === 'FACE_ENROLLMENT';
}

/**
 * Keeps the requested flows the app may use, in the requested order. Without capabilities (e.g. a session-token
 * only integration that cannot read them) every requested flow is kept and the server decides.
 */
export function planJourney(requested: readonly JourneyFlow[], caps: Capabilities | null, subjectRef: string | null): JourneyPlan {
  const flows: JourneyFlow[] = [];
  const skipped: SkippedFlow[] = [];
  for (const flow of requested) {
    if (flows.includes(flow)) continue;
    if (caps && !caps.flows.some((f) => f.code === flow)) {
      skipped.push({ flow, reason: 'NOT_ALLOWED' });
    } else if (needsSubject(flow) && !subjectRef) {
      skipped.push({ flow, reason: 'SUBJECT_REQUIRED' });
    } else {
      flows.push(flow);
    }
  }
  return { flows, skipped };
}

export function flowCapability(caps: Capabilities | null, flow: JourneyFlow): FlowCapability | null {
  return caps?.flows.find((f) => f.code === flow) ?? null;
}

/** Identity documents offered for the selfie verification. */
export function idDocumentsFor(caps: Capabilities | null): IdDocumentType[] {
  const cap = flowCapability(caps, 'SELFIE_ID_VERIFICATION');
  if (!cap || cap.documents.length === 0) return [...ID_DOCUMENT_TYPES];
  const allowed = ID_DOCUMENT_TYPES.filter((d) => cap.documents.includes(d));
  return allowed.length ? allowed : [...ID_DOCUMENT_TYPES];
}

/**
 * Whether an approved selfie verification registers the face: the integrator's `enrollFace`, else what the app may do
 * (faceEnrollmentAvailable). Unknown (no capabilities, older server) = false. Only used for display: the server decides.
 */
export function willEnrollFace(caps: Capabilities | null, enrollFace: boolean | null): boolean {
  return enrollFace ?? flowCapability(caps, 'SELFIE_ID_VERIFICATION')?.settings.faceEnrollmentAvailable ?? false;
}

/** Document types offered by DOCUMENT_SCAN: the requested ones the app may scan. */
export function scanTypesFor(caps: Capabilities | null, requested: readonly ScanType[]): ScanType[] {
  const cap = flowCapability(caps, 'DOCUMENT_SCAN');
  if (!cap || cap.documents.length === 0) return [...requested];
  return requested.filter((t) => cap.documents.includes(t)
    || (t === 'EMIRATES_ID' && cap.documents.some((d) => d.startsWith('EMIRATES_ID'))));
}

/** The liveness upload must carry an active challenge (no fallback to the normal selfie only). */
export function challengeRequired(caps: Capabilities | null, flow: JourneyFlow): boolean {
  return flowCapability(caps, flow)?.settings.livenessChallengeRequired ?? false;
}

/** PASSIVE = no challenge at all (anti-spoof model only). Unknown (no capabilities, older server) = ACTIVE. */
export function livenessMode(caps: Capabilities | null, flow: JourneyFlow): LivenessMode {
  return flowCapability(caps, flow)?.settings.livenessMode ?? 'ACTIVE';
}

/**
 * The POST /v2/liveness-challenges body for a flow (with every action this SDK can show), or null in PASSIVE mode:
 * then no challenge is requested and no challenge frames are sent.
 */
export function challengeRequest(caps: Capabilities | null, flow: JourneyFlow, target: LivenessChallengeTarget): LivenessChallengeRequest | null {
  if (livenessMode(caps, flow) === 'PASSIVE') return null;
  return { ...target, supportedActions: [...SUPPORTED_CHALLENGE_ACTIONS] };
}

export function uploadAllowed(caps: Capabilities | null, flow: JourneyFlow): boolean {
  return flowCapability(caps, flow)?.settings.fileUploadAllowed ?? false;
}

// ------------------------------------------------------------------ runner

export interface JourneyState {
  status: 'running' | 'complete' | 'cancelled';
  flows: JourneyFlow[];
  index: number;
  results: FlowResult[];
}

export type JourneyAction =
  | { type: 'FLOW_DONE'; result: FlowResult | null }
  | { type: 'CANCEL' }
  | { type: 'RESET'; flows: JourneyFlow[] };

export function initialJourney(flows: JourneyFlow[]): JourneyState {
  return { status: flows.length ? 'running' : 'complete', flows, index: 0, results: [] };
}

export function journeyReducer(state: JourneyState, action: JourneyAction): JourneyState {
  switch (action.type) {
    case 'FLOW_DONE': {
      if (state.status !== 'running') return state;
      const results = action.result ? [...state.results, action.result] : state.results;
      const index = state.index + 1;
      return { ...state, results, index, status: index >= state.flows.length ? 'complete' : 'running' };
    }
    case 'CANCEL':
      return state.status === 'running' ? { ...state, status: 'cancelled' } : state;
    case 'RESET':
      return initialJourney(action.flows);
    default:
      return state;
  }
}

export function currentFlow(state: JourneyState): JourneyFlow | null {
  return state.status === 'running' ? state.flows[state.index] ?? null : null;
}

// "Step 2 of 3" in the header: the journey's flows split into stages the user recognises (selfie, ID document…),
// and which one the current step belongs to.
import type { JourneyFlow } from '../config/options';
import type { StepName } from './protocol';

export type StageKey = 'selfie' | 'document' | 'faceAuth' | 'faceEnroll' | 'liveness' | 'scan';

export const FLOW_STAGES: Record<JourneyFlow, readonly StageKey[]> = {
  SELFIE_ID_VERIFICATION: ['selfie', 'document'],
  FACE_AUTHENTICATION: ['faceAuth'],
  FACE_ENROLLMENT: ['faceEnroll'],
  LIVENESS_CHECK: ['liveness'],
  DOCUMENT_SCAN: ['scan'],
};

const DOCUMENT_STEPS = new Set<StepName>([
  'DOCUMENT_CHOICE', 'DOCUMENT_FORMAT', 'DOCUMENT_CAPTURE', 'DOCUMENT_READING', 'DOCUMENT_CONFIRM', 'DOCUMENT_UPLOAD',
  'DOCUMENT_RESCAN', 'SCAN_RESULT',
]);

/** Steps that do not say where the user is: the previous position is kept. */
const NEUTRAL_STEPS = new Set<StepName>(['LOADING', 'ERROR', 'CAMERA_PROBLEM']);

export function isNeutralStep(step: StepName): boolean {
  return NEUTRAL_STEPS.has(step);
}

export interface JourneyProgress {
  stages: StageKey[];
  /** Index (in `stages`) of the stage in progress, or of the last stage of a finished flow. */
  current: number;
  /** The current flow has reached its result. */
  finished: boolean;
  /** Every flow of the journey is finished. */
  allDone: boolean;
  flowIndex: number;
}

/** Null when there is nothing worth showing: a single stage, the welcome screen, or the first load. */
export function journeyProgress(flows: readonly JourneyFlow[], index: number, step: StepName,
                                previous: JourneyProgress | null = null): JourneyProgress | null {
  const flow = flows[index];
  if (!flow) return null;
  const stages = flows.flatMap((f) => FLOW_STAGES[f]);
  if (stages.length < 2 || step === 'WELCOME') return null;
  if (NEUTRAL_STEPS.has(step)) return previous && previous.flowIndex === index ? previous : null;
  const offset = flows.slice(0, index).reduce((n, f) => n + FLOW_STAGES[f].length, 0);
  const own = FLOW_STAGES[flow];
  const finished = step === 'RESULT' || step === 'UNDER_REVIEW';
  const local = finished ? own.length - 1 : flow === 'SELFIE_ID_VERIFICATION' && DOCUMENT_STEPS.has(step) ? 1 : 0;
  return { stages, current: offset + local, finished, allDone: finished && index === flows.length - 1, flowIndex: index };
}

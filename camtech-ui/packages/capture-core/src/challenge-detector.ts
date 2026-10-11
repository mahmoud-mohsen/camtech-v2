// Active liveness: detects the server-issued actions (turn left / right, look up / down, blink, smile, move closer)
// frame by frame and decides which frames to keep for the upload. Pure (no DOM): the caller grabs a snapshot of the video whenever
// `capture` is set. Only frames with exactly one face are ever captured.
//
// Conventions (unmirrored camera image, as the server sees it):
//   TURN_LEFT  = the person turns to THEIR OWN left → the nose moves to the image's RIGHT → turn > 0
//   TURN_RIGHT = the person turns to their own right → the nose moves to the image's LEFT → turn < 0
//   LOOK_UP    = chin up → pitch > 0 (the server's head_pitch has the same sign)
//   LOOK_DOWN  = chin down → pitch < 0
//   BLINK      = eyes open → closed → open
//   SMILE      = relaxed mouth → smile → relaxed
//   MOVE_CLOSER = the face grows (area vs the opening neutral frame) → back to the normal distance
import type { FaceObservation } from './face';

/** Same values as the API's ChallengeAction. */
export type ChallengeAction = 'TURN_LEFT' | 'TURN_RIGHT' | 'BLINK' | 'LOOK_UP' | 'LOOK_DOWN' | 'SMILE' | 'MOVE_CLOSER';

/** Every action this detector can recognise (sent as supportedActions when requesting a challenge). */
export const SUPPORTED_CHALLENGE_ACTIONS: readonly ChallengeAction[] = [
  'TURN_LEFT', 'TURN_RIGHT', 'BLINK', 'LOOK_UP', 'LOOK_DOWN', 'SMILE', 'MOVE_CLOSER',
];

export interface ChallengeThresholds {
  /** |turn| (degrees) the head must reach (server minimum is 18°). */
  turnDeg: number;
  /** |turn| below which the face counts as frontal. */
  frontalDeg: number;
  /** |pitch| (degrees) the head must reach looking up / down (server minimum liveness.look_min_pitch is 15°). */
  lookDeg: number;
  /** |pitch| below which the head counts as level again after looking up / down. */
  levelDeg: number;
  /** Smile score (blendshapes, 0..1) at or above which the person smiles. */
  smileOn: number;
  /** Smile score at or below which the mouth counts as relaxed (the server compares the smile to the first frame). */
  smileOff: number;
  /** Face area / opening neutral face area at or above which the person moved closer (server min_closer_area_gain 1.1). */
  closerGain: number;
  /** Face area / opening neutral face area at or below which the person is back at the normal distance. */
  closerBackGain: number;
  /** Once the turn / pitch / smile / closer threshold is reached, keep looking for a stronger peak this long. */
  peakHoldMs: number;
  /** Blendshape blink score at or above which the eyes are closed. */
  blinkClosed: number;
  /** Blendshape blink score at or below which the eyes are open. */
  blinkOpen: number;
  /** Eye aspect ratio at or below which the eyes are closed (server liveness.eyes_closed_max: ≤ 0.21). */
  earClosed: number;
  /** Eye aspect ratio at or above which the eyes are open (server liveness.eyes_open_min: ≥ 0.24). */
  earOpen: number;
  /** Show "try again" after this long on one action (the action keeps running). */
  actionTimeoutMs: number;
  /** Losing the face (or a second face) longer than this restarts the whole challenge. */
  lostMs: number;
  /** Frontal frames in a row needed for a neutral frame. */
  frontalFrames: number;
}

export const DEFAULT_CHALLENGE_THRESHOLDS: ChallengeThresholds = {
  turnDeg: 26,
  // Below the server's 18° turn minimum, so a neutral frame never counts as a turn; phones held a little to the side
  // read 10–14° when the person faces the screen.
  frontalDeg: 15,
  // Server 15° + a margin: MediaPipe's pitch and the server's 68-point pose differ by a few degrees.
  lookDeg: 22,
  // Below the server's 15°, so the frame after looking up / down never counts as one itself.
  levelDeg: 12,
  // mouthSmile blendshapes: ≈0–0.1 relaxed, ≥0.5 a clear smile (the server wants the mouth ≥10% wider than at the start).
  smileOn: 0.5,
  smileOff: 0.2,
  // Server 1.1× + a margin: ≈ 1.16× the face height, a clear step towards the camera.
  closerGain: 1.35,
  // Between the server's 1.1× and closerGain, so the frame after moving closer is clearly back.
  closerBackGain: 1.15,
  peakHoldMs: 350,
  blinkClosed: 0.55,
  blinkOpen: 0.3,
  earClosed: 0.21,
  earOpen: 0.24,
  actionTimeoutMs: 8000,
  lostMs: 1200,
  frontalFrames: 2,
};

/**
 * Maximum number of challenge frames the server accepts. Seven different actions need at most 16 (the opening neutral
 * frame + 2 per action + 1 more for the blink).
 */
export const MAX_CHALLENGE_FRAMES = 16;

export interface ChallengeFrameInput {
  timestamp: number;
  faceCount: number;
  /** Signed head turn in degrees, + = the person's own left (see turnFromNoseOffset). */
  turn: number;
  /** Signed head pitch in degrees, + = looking up (see lookPitch). */
  pitch: number;
  /** Smile score 0 (relaxed) .. 1 (broad smile). */
  smile: number;
  /** Face box area as a fraction of the frame (FaceObservation.faceAreaRatio), 0 without a face. */
  faceArea: number;
  /** Blink score 0 (open) .. 1 (closed). */
  blink: number;
  /** Eye aspect ratio, when known. */
  ear: number | null;
}

/** Turn in degrees from the nose offset (nose vs eye midpoint / eye distance), like the server's keypoint yaw. */
export function turnFromNoseOffset(offset: number): number {
  // Nose tip ≈ 0.47 × eye distance in front of the eye line: offset ≈ 0.47·tan(yaw).
  return (Math.atan(offset / 0.47) * 180) / Math.PI;
}

/** Pitch with the server's sign (+ = looking up) from FaceObservation.pitch (+ = looking down, see eulerFromMatrix). */
export function lookPitch(observationPitch: number): number {
  return observationPitch === 0 ? 0 : -observationPitch;
}

export function challengeInput(obs: FaceObservation, timestamp: number): ChallengeFrameInput {
  return {
    timestamp,
    faceCount: obs.faceCount,
    turn: obs.faceCount ? turnFromNoseOffset(obs.noseOffset) : 0,
    pitch: obs.faceCount ? lookPitch(obs.pitch) : 0,
    smile: obs.smile,
    faceArea: obs.faceCount ? obs.faceAreaRatio : 0,
    blink: obs.blink,
    ear: obs.ear,
  };
}

export type ChallengeCaptureKind =
  | 'NEUTRAL' | 'TURN_PEAK' | 'PITCH_PEAK' | 'SMILE_PEAK' | 'CLOSER_PEAK' | 'BLINK_OPEN_BEFORE' | 'BLINK_CLOSED'
  | 'BLINK_OPEN_AFTER';

export interface ChallengeCapture {
  /**
   * Snapshot slot: a later capture with the same slot replaces the earlier one but keeps its position.
   * Slots are created in upload order.
   */
  slot: string;
  kind: ChallengeCaptureKind;
}

export type ChallengeHint =
  | 'LOOK_STRAIGHT'
  | 'TURN_LEFT'
  | 'TURN_RIGHT'
  | 'LOOK_UP'
  | 'LOOK_DOWN'
  | 'BLINK'
  | 'SMILE'
  | 'MOVE_CLOSER'
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'DONE';

export type ChallengeStage = 'NEUTRAL' | 'ACTION' | 'RETURN' | 'DONE';

export interface ChallengeStep {
  stage: ChallengeStage;
  /** Index of the current action (actions.length when done). */
  index: number;
  action: ChallengeAction | null;
  hint: ChallengeHint;
  /** Keep a snapshot of this frame. */
  capture: ChallengeCapture | null;
  /** An action was just recognised (haptic / announcement). */
  completed: ChallengeAction | null;
  /** The current action has been running longer than the timeout (shown as "try again"). */
  slow: boolean;
  /** The challenge started over (face lost or a second face): drop every snapshot. */
  restarted: boolean;
  /** Actions completed / total. */
  progress: number;
  done: boolean;
}

type EyeState = 'open' | 'closed' | 'between';

export function eyeState(input: Pick<ChallengeFrameInput, 'blink' | 'ear'>, t: ChallengeThresholds = DEFAULT_CHALLENGE_THRESHOLDS): EyeState {
  const closed = input.blink >= t.blinkClosed || (input.ear !== null && input.ear <= t.earClosed);
  if (closed) return 'closed';
  const open = input.blink <= t.blinkOpen && (input.ear === null || input.ear >= t.earOpen);
  return open ? 'open' : 'between';
}

export class ChallengeDetector {
  private readonly t: ChallengeThresholds;
  private stage: ChallengeStage = 'NEUTRAL';
  private index = 0;
  private frontalRun = 0;
  private actionStart = 0;
  private peak = 0;
  private peakAt: number | null = null;
  private closedScore = -1;
  private sawClosed = false;
  private lostSince: number | null = null;
  private started = false;
  /** Slots handed out since the last restart (never more than MAX_CHALLENGE_FRAMES). */
  private readonly slots = new Set<string>();
  private readonly withSmile: boolean;
  /** Face area of the opening neutral frame (the server's MOVE_CLOSER baseline); 0 before it. */
  private baseArea = 0;

  constructor(readonly actions: readonly ChallengeAction[], thresholds: Partial<ChallengeThresholds> = {}) {
    this.t = { ...DEFAULT_CHALLENGE_THRESHOLDS, ...thresholds };
    this.withSmile = actions.includes('SMILE');
  }

  get isDone(): boolean {
    return this.stage === 'DONE';
  }

  reset(): void {
    this.stage = this.actions.length ? 'NEUTRAL' : 'DONE';
    this.index = 0;
    this.frontalRun = 0;
    this.actionStart = 0;
    this.lostSince = null;
    this.slots.clear();
    this.baseArea = 0;
    this.resetAction();
  }

  private resetAction(): void {
    this.peak = 0;
    this.peakAt = null;
    this.closedScore = -1;
    this.sawClosed = false;
  }

  update(input: ChallengeFrameInput): ChallengeStep {
    const step = this.step(input);
    if (!step.capture) return step;
    // Never keep a frame without exactly one face, and never more frames than the server accepts.
    const known = this.slots.has(step.capture.slot);
    if (input.faceCount !== 1 || (!known && this.slots.size >= MAX_CHALLENGE_FRAMES)) return { ...step, capture: null };
    this.slots.add(step.capture.slot);
    return step;
  }

  private step(input: ChallengeFrameInput): ChallengeStep {
    if (!this.started) {
      this.started = true;
      this.reset();
    }
    const now = input.timestamp;
    const base = (over: Partial<ChallengeStep>): ChallengeStep => ({
      stage: this.stage, index: this.index, action: this.actions[this.index] ?? null,
      hint: this.hintFor(), capture: null, completed: null, slow: false, restarted: false,
      progress: this.actions.length ? Math.min(this.index, this.actions.length) / this.actions.length : 1,
      done: this.stage === 'DONE', ...over,
    });
    if (this.stage === 'DONE') return base({ hint: 'DONE' });

    // Exactly one face, all the time.
    if (input.faceCount !== 1) {
      this.lostSince ??= now;
      this.frontalRun = 0;
      if (now - this.lostSince > this.t.lostMs && (this.index > 0 || this.stage !== 'NEUTRAL')) {
        this.reset();
        this.lostSince = now;
        return base({ hint: input.faceCount ? 'MULTIPLE_FACES' : 'NO_FACE', restarted: true });
      }
      return base({ hint: input.faceCount ? 'MULTIPLE_FACES' : 'NO_FACE' });
    }
    this.lostSince = null;

    const eyes = eyeState(input, this.t);
    const frontal = Math.abs(input.turn) < this.t.frontalDeg;

    // Neutral frame (start, and between actions / at the end).
    if (this.stage === 'NEUTRAL' || this.stage === 'RETURN') {
      const previous = this.stage === 'RETURN' ? this.actions[this.index - 1] : undefined;
      const afterBlink = previous === 'BLINK';
      // Level again after looking up / down; a relaxed mouth whenever a smile is asked (the server's smile baseline).
      const level = (previous !== 'LOOK_UP' && previous !== 'LOOK_DOWN') || Math.abs(input.pitch) < this.t.levelDeg;
      const relaxed = !this.withSmile || input.smile <= this.t.smileOff;
      // Back at the normal distance after moving closer.
      const back = previous !== 'MOVE_CLOSER' || input.faceArea <= this.baseArea * this.t.closerBackGain;
      if (frontal && eyes === 'open' && level && relaxed && back) this.frontalRun++;
      else this.frontalRun = 0;
      if (this.frontalRun < this.t.frontalFrames) return base({});
      const slot = `n${this.index}`;
      const kind: ChallengeCaptureKind = afterBlink ? 'BLINK_OPEN_AFTER' : 'NEUTRAL';
      this.frontalRun = 0;
      if (this.index === 0) this.baseArea = input.faceArea;
      if (this.index >= this.actions.length) {
        this.stage = 'DONE';
        return base({ capture: { slot, kind }, hint: 'DONE', done: true, progress: 1 });
      }
      this.stage = 'ACTION';
      this.actionStart = now;
      this.resetAction();
      return base({ capture: { slot, kind } });
    }

    // ACTION
    const action = this.actions[this.index];
    const slow = now - this.actionStart > this.t.actionTimeoutMs;

    if (action === 'BLINK') {
      if (!this.sawClosed) {
        if (eyes === 'open' && frontal) return base({ capture: { slot: `a${this.index}-pre`, kind: 'BLINK_OPEN_BEFORE' }, slow });
        if (eyes === 'closed') {
          this.sawClosed = true;
          this.closedScore = closure(input);
          return base({ capture: { slot: `a${this.index}-closed`, kind: 'BLINK_CLOSED' }, slow });
        }
        return base({ slow });
      }
      if (eyes === 'closed') {
        const c = closure(input);
        if (c > this.closedScore) {
          this.closedScore = c;
          return base({ capture: { slot: `a${this.index}-closed`, kind: 'BLINK_CLOSED' }, slow });
        }
        return base({ slow });
      }
      if (eyes === 'open') return this.complete(base, action);
      return base({ slow });
    }

    // Turns, looking up / down, smiles and moving closer: track the strongest frame in the right direction.
    const { value: signed, threshold, kind } = peakMeasure(action, input, this.t, this.baseArea);
    if (signed >= threshold) {
      let capture: ChallengeCapture | null = null;
      if (signed > this.peak) {
        this.peak = signed;
        capture = { slot: `a${this.index}-peak`, kind };
      }
      this.peakAt ??= now;
      if (now - this.peakAt >= this.t.peakHoldMs) {
        const step = this.complete(base, action);
        return { ...step, capture: capture ?? step.capture };
      }
      return base({ capture, slow });
    }
    if (this.peakAt !== null) return this.complete(base, action); // coming back from the peak
    return base({ slow });
  }

  private complete(base: (over: Partial<ChallengeStep>) => ChallengeStep, action: ChallengeAction): ChallengeStep {
    this.index++;
    this.stage = 'RETURN';
    this.frontalRun = 0;
    this.resetAction();
    return base({ completed: action, hint: 'LOOK_STRAIGHT' });
  }

  private hintFor(): ChallengeHint {
    if (this.stage === 'DONE') return 'DONE';
    if (this.stage === 'ACTION') return this.actions[this.index] ?? 'LOOK_STRAIGHT';
    return 'LOOK_STRAIGHT';
  }
}

/** The value to maximise for a peak action (in its own direction), its threshold and the capture kind. */
function peakMeasure(action: Exclude<ChallengeAction, 'BLINK'>, input: ChallengeFrameInput, t: ChallengeThresholds,
                     baseArea: number): { value: number; threshold: number; kind: ChallengeCaptureKind } {
  switch (action) {
    case 'TURN_LEFT': return { value: input.turn, threshold: t.turnDeg, kind: 'TURN_PEAK' };
    case 'TURN_RIGHT': return { value: -input.turn, threshold: t.turnDeg, kind: 'TURN_PEAK' };
    case 'LOOK_UP': return { value: input.pitch, threshold: t.lookDeg, kind: 'PITCH_PEAK' };
    case 'LOOK_DOWN': return { value: -input.pitch, threshold: t.lookDeg, kind: 'PITCH_PEAK' };
    case 'SMILE': return { value: input.smile, threshold: t.smileOn, kind: 'SMILE_PEAK' };
    case 'MOVE_CLOSER': return { value: baseArea > 0 ? input.faceArea / baseArea : 0, threshold: t.closerGain, kind: 'CLOSER_PEAK' };
  }
}

function closure(input: Pick<ChallengeFrameInput, 'blink' | 'ear'>): number {
  return Math.max(input.blink, input.ear === null ? 0 : 1 - input.ear * 4);
}

// Guidance state machine for the two-shot selfie liveness (normal selfie, then closer selfie).
// It mirrors the server's liveness rules so that users are rarely rejected after uploading.
import type { FaceObservation, NormRect } from './face';

export type SelfiePhase = 'NORMAL' | 'CLOSER' | 'DONE';

export type HintCode =
  | 'NO_FACE'
  | 'MULTIPLE_FACES'
  | 'MOVE_CLOSER'
  | 'MOVE_BACK'
  | 'CENTER_FACE'
  | 'LOOK_STRAIGHT'
  | 'HEAD_LEVEL'
  | 'OPEN_EYES'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'HOLD_STILL'
  | 'BLURRY'
  | 'GOOD';

export interface SelfieThresholds {
  /** Face height / visible frame height for the normal selfie. */
  normalMinHeight: number;
  normalMaxHeight: number;
  /** Closer face area must be at least this × the normal face area (server minimum is 1.1). */
  closerAreaRatio: number;
  /** Closer face must not exceed this height ratio (face cut off). */
  closerMaxHeight: number;
  /** Max |centre offset| (fraction of the visible frame). */
  maxCenterOffset: number;
  maxYaw: number;
  maxPitch: number;
  maxRoll: number;
  minBrightness: number;
  maxBrightness: number;
  /** Fraction of blown-out pixels on the face that counts as too bright. */
  maxGlare: number;
  /** Minimum Laplacian variance of the face region (analysis resolution). */
  minSharpness: number;
  /** Mean absolute frame difference on the face above which the user is moving. */
  maxMotion: number;
  /** Landmark jitter (relative to face height) above which the user is moving. */
  maxJitter: number;
  /** How long all checks must pass before a shot is taken. */
  stableMs: number;
  /** Losing the face for longer than this during the closer phase restarts it. */
  trackingLossMs: number;
  /** A new hint must persist this long before it replaces the shown one. */
  hintDebounceMs: number;
  /** A blink shorter than this does not break the stable window. */
  blinkGraceMs: number;
}

export const DEFAULT_SELFIE_THRESHOLDS: SelfieThresholds = {
  // A face filling the oval (ovalSize: up to 0.54 of the stage) at a normal phone distance; 0.45 made people
  // hold the phone at arm's length on portrait phones.
  normalMinHeight: 0.28,
  normalMaxHeight: 0.58,
  closerAreaRatio: 1.3,
  closerMaxHeight: 0.85,
  maxCenterOffset: 0.12,
  // The server accepts up to 30° (SELFIE_MAX_YAW / SELFIE_MAX_PITCH). A phone held below the face reads as
  // 15–20° of pitch, so 15 kept phone users on "look straight".
  maxYaw: 20,
  maxPitch: 22,
  maxRoll: 10,
  minBrightness: 70,
  maxBrightness: 215,
  maxGlare: 0.25,
  minSharpness: 15,
  maxMotion: 6,
  maxJitter: 0.012,
  stableMs: 500,
  trackingLossMs: 1200,
  hintDebounceMs: 250,
  blinkGraceMs: 300,
};

/** Hysteresis margins: once a check fails, it must clear the threshold by this much to pass again. */
const MARGIN = { height: 0.02, center: 0.02, angle: 3, brightness: 8, sharpness: 5, motion: 1.5 };

export interface SelfieFrameInput {
  timestamp: number;
  observation: FaceObservation;
  /** Mean luminance of the face region, 0..255. */
  brightness: number;
  /** Fraction of blown-out pixels on the face. */
  glare?: number;
  /** Laplacian variance of the face region. */
  sharpness: number;
  /** Mean absolute difference vs the previous frame on the face region. */
  motion: number;
  /** From DeviceMotion; undefined = unknown (treated as steady). */
  deviceSteady?: boolean;
  /** Part of the video visible in the preview (normalized). Default: the whole frame. */
  visible?: NormRect;
}

export interface SelfieGuidance {
  phase: SelfiePhase;
  /** Debounced hint for display. */
  hint: HintCode;
  /** Raw hint of this frame. */
  rawHint: HintCode;
  /** 0..1 over both shots. */
  progress: number;
  /** All checks pass on this frame. */
  ready: boolean;
  observation: FaceObservation;
  /** This frame is the sharpest good frame so far in the stable window: keep a full-resolution copy. */
  keepFrame: boolean;
  /** A shot just completed: the last kept frame is the photo for this phase. */
  shot: 'NORMAL' | 'CLOSER' | null;
  /** The face was lost during the closer phase and the closer shot restarted. */
  warning: 'TRACKING_LOST' | null;
  /** Current face area / normal face area (1 before the normal shot). */
  areaRatio: number;
}

/** Which checks are failing; feeds hysteresis. */
type FailSet = Partial<Record<HintCode, boolean>>;

/** Face metrics relative to the visible part of the frame. */
export function relativeFace(obs: FaceObservation, visible?: NormRect): { height: number; area: number; cx: number; cy: number } {
  const v = visible ?? { x: 0, y: 0, width: 1, height: 1 };
  if (!obs.bbox) return { height: 0, area: 0, cx: 0, cy: 0 };
  const b = obs.bbox;
  return {
    height: b.height / v.height,
    area: (b.width * b.height) / (v.width * v.height),
    cx: (b.x + b.width / 2 - (v.x + v.width / 2)) / v.width,
    cy: (b.y + b.height / 2 - (v.y + v.height / 2)) / v.height,
  };
}

/**
 * The checks for one frame, in priority order. Pure: the result only depends on the inputs.
 * `failing` holds the checks that failed on the previous frame (hysteresis).
 */
export function assessSelfieFrame(input: SelfieFrameInput, phase: SelfiePhase, normalArea: number | null,
                                  t: SelfieThresholds = DEFAULT_SELFIE_THRESHOLDS, failing: FailSet = {}):
  { hint: HintCode; failing: FailSet; areaRatio: number } {
  const obs = input.observation;
  const next: FailSet = {};
  const fail = (h: HintCode): { hint: HintCode; failing: FailSet; areaRatio: number } => {
    next[h] = true;
    return { hint: h, failing: next, areaRatio };
  };
  const f = relativeFace(obs, input.visible);
  const areaRatio = normalArea && normalArea > 0 ? f.area / normalArea : 1;

  if (obs.faceCount === 0 || !obs.bbox) return fail('NO_FACE');
  if (obs.faceCount > 1) return fail('MULTIPLE_FACES');

  // Size
  if (phase === 'CLOSER') {
    const need = t.closerAreaRatio + (failing.MOVE_CLOSER ? 0.03 : 0);
    if (f.height > t.closerMaxHeight - (failing.MOVE_BACK ? MARGIN.height : 0) || touchesEdge(obs.bbox, input.visible)) {
      return fail('MOVE_BACK');
    }
    // Without a reference (normal shot taken manually with no face seen) only "not too close" can be checked.
    if (normalArea && areaRatio < need) return fail('MOVE_CLOSER');
  } else {
    if (f.height < t.normalMinHeight + (failing.MOVE_CLOSER ? MARGIN.height : 0)) return fail('MOVE_CLOSER');
    if (f.height > t.normalMaxHeight - (failing.MOVE_BACK ? MARGIN.height : 0)) return fail('MOVE_BACK');
  }

  // Position (the closer face is bigger, so allow a little more offset)
  const maxOffset = (phase === 'CLOSER' ? t.maxCenterOffset + 0.04 : t.maxCenterOffset)
    - (failing.CENTER_FACE ? MARGIN.center : 0);
  if (Math.abs(f.cx) > maxOffset || Math.abs(f.cy) > maxOffset) return fail('CENTER_FACE');

  // Pose
  const angleMargin = failing.LOOK_STRAIGHT ? MARGIN.angle : 0;
  if (Math.abs(obs.yaw) >= t.maxYaw - angleMargin || Math.abs(obs.pitch) >= t.maxPitch - angleMargin) {
    return fail('LOOK_STRAIGHT');
  }
  if (Math.abs(obs.roll) >= t.maxRoll - (failing.HEAD_LEVEL ? MARGIN.angle : 0)) return fail('HEAD_LEVEL');

  // Light
  if (input.brightness < t.minBrightness + (failing.TOO_DARK ? MARGIN.brightness : 0)) return fail('TOO_DARK');
  if (input.brightness > t.maxBrightness - (failing.TOO_BRIGHT ? MARGIN.brightness : 0)
    || (input.glare ?? 0) > t.maxGlare) {
    return fail('TOO_BRIGHT');
  }

  if (!obs.eyesOpen) return fail('OPEN_EYES');

  // Stillness, then sharpness (motion causes blur, so ask to hold still first)
  const motionLimit = t.maxMotion - (failing.HOLD_STILL ? MARGIN.motion : 0);
  if (input.motion > motionLimit || obs.jitter > t.maxJitter || input.deviceSteady === false) return fail('HOLD_STILL');
  if (input.sharpness < t.minSharpness + (failing.BLURRY ? MARGIN.sharpness : 0)) return fail('BLURRY');

  return { hint: 'GOOD', failing: next, areaRatio };
}

function touchesEdge(b: NormRect, visible?: NormRect): boolean {
  const v = visible ?? { x: 0, y: 0, width: 1, height: 1 };
  const m = 0.01;
  return b.x <= v.x + m || b.y <= v.y + m || b.x + b.width >= v.x + v.width - m || b.y + b.height >= v.y + v.height - m;
}

export class SelfieAnalyzer {
  private readonly t: SelfieThresholds;
  private phase: SelfiePhase = 'NORMAL';
  private failing: FailSet = {};
  private stableSince: number | null = null;
  private bestSharpness = -1;
  private bestArea = 0;
  private normalArea: number | null = null;
  private shownHint: HintCode | null = null;
  private candidateHint: HintCode | null = null;
  private candidateSince = 0;
  private lastFaceAt: number | null = null;
  private blinkSince: number | null = null;
  private trackingLost = false;
  private lastObservation: FaceObservation | null = null;
  private lastVisible: NormRect | undefined;

  constructor(thresholds: Partial<SelfieThresholds> = {}) {
    this.t = { ...DEFAULT_SELFIE_THRESHOLDS, ...thresholds };
  }

  get currentPhase(): SelfiePhase {
    return this.phase;
  }

  /** Face area (relative to the visible frame) of the normal selfie, once taken. */
  get normalFaceArea(): number | null {
    return this.normalArea;
  }

  reset(): void {
    this.phase = 'NORMAL';
    this.normalArea = null;
    this.restartWindow();
    this.failing = {};
    this.shownHint = null;
    this.candidateHint = null;
    this.lastFaceAt = null;
    this.trackingLost = false;
  }

  /** Restarts the closer shot (keeps the normal selfie). */
  restartCloser(): void {
    if (this.phase === 'NORMAL') return;
    this.phase = 'CLOSER';
    this.restartWindow();
  }

  /**
   * Records a shot taken with the manual shutter. For the normal selfie, the last observed face size becomes the
   * reference for the closer one (or none when no face was seen, e.g. the face model did not load).
   */
  manualShot(phase: 'NORMAL' | 'CLOSER'): void {
    if (phase === 'NORMAL') {
      const obs = this.lastObservation;
      this.normalArea = obs && obs.faceCount ? relativeFace(obs, this.lastVisible).area : null;
      this.phase = 'CLOSER';
    } else {
      this.phase = 'DONE';
    }
    this.restartWindow();
  }

  update(input: SelfieFrameInput): SelfieGuidance {
    const now = input.timestamp;
    this.lastObservation = input.observation;
    this.lastVisible = input.visible;
    if (this.phase === 'DONE') {
      return this.result(input, 'GOOD', 'GOOD', 1, false, null, null);
    }

    let warning: 'TRACKING_LOST' | null = null;
    const hasFace = input.observation.faceCount > 0;
    if (hasFace) {
      this.lastFaceAt = now;
    } else if (this.phase === 'CLOSER' && this.lastFaceAt !== null && now - this.lastFaceAt > this.t.trackingLossMs
      && !this.trackingLost) {
      // The face must stay tracked between the two selfies: start the closer shot again.
      this.trackingLost = true;
      warning = 'TRACKING_LOST';
      this.restartWindow();
    }

    const assessed = assessSelfieFrame(input, this.phase, this.normalArea, this.t, this.failing);
    this.failing = assessed.failing;
    let raw = assessed.hint;

    // Short blinks do not break the stable window, but a blinking frame is never kept.
    let blinking = false;
    if (raw === 'OPEN_EYES') {
      this.blinkSince ??= now;
      if (now - this.blinkSince < this.t.blinkGraceMs && this.stableSince !== null) {
        blinking = true;
        raw = 'GOOD';
      }
    } else {
      this.blinkSince = null;
    }

    const good = raw === 'GOOD';
    let keepFrame = false;
    let shot: 'NORMAL' | 'CLOSER' | null = null;
    if (good) {
      if (this.trackingLost && hasFace) this.trackingLost = false;
      this.stableSince ??= now;
      const area = relativeFace(input.observation, input.visible).area;
      if (!blinking && input.sharpness > this.bestSharpness) {
        this.bestSharpness = input.sharpness;
        this.bestArea = area;
        keepFrame = true;
      }
      if (now - this.stableSince >= this.t.stableMs && this.bestSharpness >= 0) {
        shot = this.phase === 'NORMAL' ? 'NORMAL' : 'CLOSER';
      }
    } else {
      this.restartWindow();
    }

    const hint = this.debounce(raw, now);
    const progress = this.progress(now, assessed.areaRatio);
    const result = this.result(input, hint, raw, progress, keepFrame, shot, warning, assessed.areaRatio, good);
    if (shot === 'NORMAL') {
      this.normalArea = this.bestArea || relativeFace(input.observation, input.visible).area;
      this.phase = 'CLOSER';
      this.restartWindow();
      this.failing = {};
      result.progress = 0.5;
    } else if (shot === 'CLOSER') {
      this.phase = 'DONE';
      result.progress = 1;
    }
    return result;
  }

  private restartWindow(): void {
    this.stableSince = null;
    this.bestSharpness = -1;
    this.bestArea = 0;
  }

  private debounce(raw: HintCode, now: number): HintCode {
    if (this.shownHint === null) {
      this.shownHint = raw;
      this.candidateHint = raw;
      this.candidateSince = now;
      return raw;
    }
    if (raw === this.shownHint) {
      this.candidateHint = raw;
      return raw;
    }
    if (raw !== this.candidateHint) {
      this.candidateHint = raw;
      this.candidateSince = now;
    }
    if (now - this.candidateSince >= this.t.hintDebounceMs) this.shownHint = raw;
    return this.shownHint;
  }

  private progress(now: number, areaRatio: number): number {
    const stable = this.stableSince === null ? 0 : Math.min(1, (now - this.stableSince) / this.t.stableMs);
    if (this.phase === 'NORMAL') return 0.45 * stable;
    const approach = this.normalArea
      ? Math.max(0, Math.min(1, (areaRatio - 1) / (this.t.closerAreaRatio - 1)))
      : 1;
    return 0.5 + 0.3 * approach + 0.2 * stable;
  }

  private result(input: SelfieFrameInput, hint: HintCode, rawHint: HintCode, progress: number, keepFrame: boolean,
                 shot: 'NORMAL' | 'CLOSER' | null, warning: 'TRACKING_LOST' | null, areaRatio = 1,
                 ready = false): SelfieGuidance {
    return {
      phase: this.phase, hint, rawHint, progress, ready, observation: input.observation, keepFrame, shot,
      warning: warning ?? (this.trackingLost ? 'TRACKING_LOST' : null), areaRatio,
    };
  }
}

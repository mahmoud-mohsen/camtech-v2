// Scripted guidance used with the simulated camera: a realistic progression of hints ending in GOOD,
// so every capture screen can be exercised without a face model or a real camera.
import type { ChallengeAction, DocumentHint, HintCode, SelfiePhase } from '@camtech/capture-core';

interface Beat<H> {
  hint: H;
  ms: number;
}

const NORMAL: Beat<HintCode>[] = [
  { hint: 'NO_FACE', ms: 700 },
  { hint: 'CENTER_FACE', ms: 900 },
  { hint: 'HOLD_STILL', ms: 700 },
  { hint: 'GOOD', ms: 700 },
];
const DOCUMENT: Beat<DocumentHint>[] = [
  { hint: 'NO_DOCUMENT', ms: 700 },
  { hint: 'ALIGN_DOCUMENT', ms: 900 },
  { hint: 'GLARE', ms: 800 },
  { hint: 'HOLD_STILL', ms: 600 },
  { hint: 'GOOD', ms: 700 },
];

function at<H>(beats: Beat<H>[], elapsed: number): { hint: H; index: number; fraction: number; done: boolean } {
  let t = 0;
  for (let i = 0; i < beats.length; i++) {
    if (elapsed < t + beats[i].ms) return { hint: beats[i].hint, index: i, fraction: (elapsed - t) / beats[i].ms, done: false };
    t += beats[i].ms;
  }
  const last = beats[beats.length - 1];
  return { hint: last.hint, index: beats.length - 1, fraction: 1, done: true };
}

export interface ScriptedSelfieStep {
  phase: SelfiePhase;
  hint: HintCode;
  progress: number;
  ready: boolean;
  keepFrame: boolean;
  /** The normal selfie (the only fixed photo) was just taken. */
  shot: 'NORMAL' | null;
}

export class ScriptedSelfie {
  private phase: SelfiePhase = 'NORMAL';
  private phaseStart: number | null = null;

  constructor(private readonly onPhase?: (phase: SelfiePhase) => void) {}

  update(now: number): ScriptedSelfieStep {
    if (this.phase === 'DONE') return { phase: 'DONE', hint: 'GOOD', progress: 1, ready: true, keepFrame: false, shot: null };
    this.phaseStart ??= now;
    const s = at(NORMAL, now - this.phaseStart);
    const good = s.hint === 'GOOD';
    const progress = 0.45 * (good ? s.fraction : 0);
    if (s.done) {
      this.phase = 'DONE';
      this.phaseStart = null;
      this.onPhase?.(this.phase);
      return { phase: this.phase, hint: 'GOOD', progress: 0.5, ready: true, keepFrame: true, shot: 'NORMAL' };
    }
    return { phase: this.phase, hint: s.hint, progress, ready: good, keepFrame: good, shot: null };
  }

  manualShot(): void {
    this.phase = 'DONE';
    this.phaseStart = null;
    this.onPhase?.(this.phase);
  }
}

export interface ScriptedDocumentStep {
  hint: DocumentHint;
  progress: number;
  ready: boolean;
  keepFrame: boolean;
  shot: boolean;
}

export class ScriptedDocument {
  private start: number | null = null;
  private done = false;

  update(now: number): ScriptedDocumentStep {
    if (this.done) return { hint: 'GOOD', progress: 1, ready: true, keepFrame: false, shot: false };
    this.start ??= now;
    const s = at(DOCUMENT, now - this.start);
    const good = s.hint === 'GOOD';
    if (s.done) {
      this.done = true;
      return { hint: 'GOOD', progress: 1, ready: true, keepFrame: true, shot: true };
    }
    return { hint: s.hint, progress: good ? s.fraction : 0, ready: good, keepFrame: good, shot: false };
  }

  reset(): void {
    this.start = null;
    this.done = false;
  }
}

export interface ChallengePose {
  /** Degrees, + = the person's own left (nose towards the image's right). */
  turn: number;
  /** Degrees, + = looking up. */
  pitch: number;
  /** 0 open .. 1 closed. */
  blink: number;
  /** 0 relaxed .. 1 broad smile. */
  smile: number;
  /** Face size (1 = normal selfie distance). */
  scale: number;
}

const REST: ChallengePose = { turn: 0, pitch: 0, blink: 0.05, smile: 0.02, scale: 1 };

/**
 * Synthetic head movements for a challenge (simulated camera). It follows the detector: frontal while a neutral frame
 * is expected, then performs the current action (turn / look up / look down / smile / move closer and hold, or blink
 * every 1.2 s)
 * until it is recognised, so it works at any frame rate. The poses feed both the drawing and the real ChallengeDetector.
 */
export class ScriptedChallenge {
  private key = '';
  private since = 0;

  constructor(private readonly actions: readonly ChallengeAction[]) {}

  pose(now: number, stage: string, index: number): ChallengePose {
    const key = `${stage}:${index}`;
    if (key !== this.key) {
      this.key = key;
      this.since = now;
    }
    const t = now - this.since;
    const action = this.actions[index];
    if (stage !== 'ACTION' || !action || t < 500) return REST;
    const a = t - 500;
    const r = Math.min(1, a / 450);
    const ramp = r * r * (3 - 2 * r); // ease in and out
    switch (action) {
      case 'BLINK': return { ...REST, blink: a % 1200 < 300 ? 0.92 : 0.05 };
      case 'TURN_LEFT': return { ...REST, turn: 36 * ramp };
      case 'TURN_RIGHT': return { ...REST, turn: -36 * ramp };
      case 'LOOK_UP': return { ...REST, pitch: 30 * ramp };
      case 'LOOK_DOWN': return { ...REST, pitch: -30 * ramp };
      case 'SMILE': return { ...REST, smile: 0.85 * ramp };
      case 'MOVE_CLOSER': return { ...REST, scale: 1 + 0.3 * ramp };
    }
  }
}

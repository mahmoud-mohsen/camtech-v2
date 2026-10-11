// Live selfie guidance: frames → face tracking + quality → SelfieAnalyzer → auto-capture.
// Order: NORMAL selfie (the only fixed photo) → active challenge (server-issued actions, MOVE_CLOSER included, frames
// kept for the upload) → done. Without a challenge (PASSIVE): the normal selfie only.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChallengeDetector, challengeInput, ChallengeSnapshots, encodeSelfie, FrameHolder, FrameLoop, glareRatio,
  laplacianVariance, MAX_CHALLENGE_FRAMES, meanLuminance, motionScore, MotionMonitor, SelfieAnalyzer, visibleVideoRect,
  type ChallengeAction, type ChallengeFrameInput, type ChallengeHint, type FaceTracker, type HintCode, type NormRect, type Rect, type SelfiePhase,
} from '@camtech/capture-core';
import type { ChallengeSubmission, LivenessChallenge } from '@camtech/api-client';
import type { VisionUrls } from '../../config/options';
import type { ScriptedChallenge } from '../../sim/scripted';
import type { SimulatedCamera } from '../../sim/simulated-camera';
import type { Size } from '../components/hooks';
import { loadedSim } from './sim';
import { getFaceTracker } from './vision';

export type ModelStatus = 'loading' | 'ready' | 'failed' | 'scripted';
export type CapturePhase = SelfiePhase | 'CHALLENGE';

export interface ChallengeView {
  actions: readonly ChallengeAction[];
  /** Current action index (actions.length when done). */
  index: number;
  hint: ChallengeHint;
  /** The current action takes long: show "try again". */
  slow: boolean;
  /** The challenge started over (face lost). */
  restarted: boolean;
  /** Increments each time an action is recognised. */
  completedCount: number;
  /** Timed instructions only (no face model): actions cannot be checked on the device. */
  timed: boolean;
}

export interface SelfieGuidanceView {
  phase: CapturePhase;
  hint: HintCode | null;
  progress: number;
  ready: boolean;
  warning: 'TRACKING_LOST' | null;
  /** Set in the CHALLENGE phase; null while the challenge is still loading. */
  challenge: ChallengeView | null;
}

export interface SelfieCapture extends SelfieGuidanceView {
  model: ModelStatus;
  /** Show the manual shutter (model failed, or no auto capture after 8 s in this phase). */
  manual: boolean;
  busy: boolean;
  /** Increments on each photo (flash animation key). */
  shots: number;
  shoot: () => void;
}

export interface SelfieCaptureOptions {
  video: HTMLVideoElement | null;
  live: boolean;
  stage: Size;
  sim: SimulatedCamera | null;
  vision: VisionUrls;
  /** undefined: still loading; null: no challenge (the normal selfie only). */
  challenge: LivenessChallenge | null | undefined;
  /** The challenge expired before it was completed: the screen should fetch a new one. */
  onChallengeExpired: () => void;
  onDone: (normal: Blob, challenge: ChallengeSubmission | null) => void;
}

const MANUAL_AFTER_MS = 8000;
const BASIC_MIN_BRIGHTNESS = 60;
const BASIC_MIN_SHARPNESS = 10;
const ANALYSIS_FPS = 13;
/** Blinks last 100–300 ms: analyse faster during the challenge so the closed frame is not missed. */
const CHALLENGE_FPS = 25;
/** The progress ring: the normal selfie fills the first half, the challenge the second. */
const CHALLENGE_PROGRESS = 0.5;
/** Face area ratio of the simulated face at scale 1 (scripted MOVE_CLOSER). */
const SIM_FACE_AREA = 0.12;

function faceRoi(bbox: NormRect | null, w: number, h: number): Rect {
  if (!bbox) return { x: w * 0.3, y: h * 0.25, width: w * 0.4, height: h * 0.5 };
  return { x: (bbox.x + bbox.width * 0.15) * w, y: (bbox.y + bbox.height * 0.15) * h, width: bbox.width * 0.7 * w, height: bbox.height * 0.7 * h };
}

function vibrate(ms = 60): void {
  try {
    navigator.vibrate?.(ms);
  } catch {
    /* not allowed in iframes without user activation */
  }
}

/**
 * Without a face model the actions cannot be checked on the device: show each instruction for a fixed time and keep
 * frames at moments where the action is likely (the server decides). At most MAX_CHALLENGE_FRAMES frames.
 */
class TimedChallenge {
  private start: number | null = null;
  private readonly plan: { at: number; slot: string; index: number }[] = [];
  private next = 0;
  readonly duration: number;

  constructor(readonly actions: readonly ChallengeAction[]) {
    let t = 800;
    this.plan.push({ at: 600, slot: 'n0', index: 0 });
    actions.forEach((a, i) => {
      const offsets = a === 'BLINK' ? [1000, 1400] : [1500];
      offsets.forEach((o, k) => this.plan.push({ at: t + o, slot: `a${i}-${k}`, index: i }));
      this.plan.push({ at: t + 2400, slot: `n${i + 1}`, index: i + 1 });
      t += 2800;
    });
    this.duration = t;
  }

  /** Returns the action index shown now and the slot to capture on this frame, if any. */
  update(now: number): { index: number; slot: string | null; done: boolean } {
    this.start ??= now;
    const t = now - this.start;
    let slot: string | null = null;
    if (this.next < this.plan.length && t >= this.plan[this.next].at) slot = this.plan[this.next++].slot;
    const index = Math.min(this.actions.length, Math.max(0, Math.floor((t - 800) / 2800)));
    return { index: t < 800 ? 0 : index, slot, done: this.next >= this.plan.length && t >= this.duration };
  }
}

export function useSelfieCapture({ video, live, stage, sim, vision, challenge, onChallengeExpired, onDone }: SelfieCaptureOptions): SelfieCapture {
  const [view, setView] = useState<SelfieGuidanceView>({ phase: 'NORMAL', hint: null, progress: 0, ready: false, warning: null, challenge: null });
  const [model, setModel] = useState<ModelStatus>(sim ? 'scripted' : 'loading');
  const [busy, setBusy] = useState(false);
  const [shots, setShots] = useState(0);
  const [manualDue, setManualDue] = useState(false);
  const stageRef = useRef(stage);
  stageRef.current = stage;
  const cbs = useRef({ onDone, onChallengeExpired });
  cbs.current = { onDone, onChallengeExpired };
  const challengeRef = useRef(challenge);
  challengeRef.current = challenge;
  const shootRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!video || !live) return;
    let disposed = false;
    let encoding = false;
    let tracker: FaceTracker | null = null;
    let modelFailed = false;
    let prevGray: Uint8ClampedArray | null = null;
    let normalBlob: Blob | null = null;
    let lastBasic = { brightness: 128, sharpness: 100 };
    let phase: CapturePhase = 'NORMAL';
    const analyzer = new SelfieAnalyzer();
    const holder = new FrameHolder();
    const snapshots = new ChallengeSnapshots(640);
    const motion = new MotionMonitor();
    motion.start();
    // A simulated camera only exists once the sim module is loaded (useCamera).
    const kit = sim ? loadedSim() : null;
    const scripted = kit ? new kit.ScriptedSelfie() : null;
    const neutral = (): void => {
      if (!sim || !kit) return;
      sim.setPose(kit.NEUTRAL_POSE);
      sim.setFaceScale(1);
    };
    if (sim) {
      neutral();
      setModel('scripted');
    }

    // Challenge state
    let active: LivenessChallenge | null = null;
    let detector: ChallengeDetector | null = null;
    let timed: TimedChallenge | null = null;
    let scriptedPoses: ScriptedChallenge | null = null;
    let completedCount = 0;
    let detectorStage = 'NEUTRAL';
    let detectorIndex = 0;
    let submission: Promise<ChallengeSubmission | null> = Promise.resolve(null);
    let expiredReported: string | null = null;

    if (!scripted) {
      setModel('loading');
      getFaceTracker(vision).then((t) => {
        if (disposed) return;
        t.reset();
        tracker = t;
        setModel('ready');
      }, () => {
        if (disposed) return;
        modelFailed = true;
        setModel('failed');
      });
    }

    let lastKey = '';
    const publish = (v: SelfieGuidanceView): void => {
      const c = v.challenge;
      const key = [v.phase, v.hint, v.ready, v.warning, Math.round(v.progress * 50),
        c ? `${c.index}|${c.hint}|${c.slow}|${c.restarted}|${c.completedCount}|${c.timed}` : '-'].join(':');
      if (key === lastKey) return;
      lastKey = key;
      setView(v);
    };

    /** The normal selfie is the only fixed photo: hand it over with the challenge frames, if any. */
    const finish = (): void => {
      const normal = normalBlob;
      if (phase === 'DONE' || !normal) return;
      phase = 'DONE';
      loop.stop();
      neutral();
      publish({ phase: 'DONE', hint: 'GOOD', progress: 1, ready: true, warning: null, challenge: null });
      void submission.then((ch) => {
        if (!disposed) cbs.current.onDone(normal, ch);
      });
    };

    const finishChallenge = (c: LivenessChallenge): void => {
      const frames = snapshots.encode(MAX_CHALLENGE_FRAMES);
      submission = frames.then((f) => ({ challengeId: c.challengeId, frames: f }));
      vibrate(80);
      finish();
    };

    const takeShot = async (): Promise<void> => {
      if (encoding) return;
      encoding = true;
      setBusy(true);
      try {
        const source = holder.frame ?? video;
        const { blob } = await encodeSelfie(source);
        if (disposed) return;
        vibrate();
        setShots((n) => n + 1);
        holder.clear();
        normalBlob = blob;
        setManualDue(false);
        if (challengeRef.current === null) {
          finish(); // no challenge (PASSIVE, or optional and unavailable)
        } else {
          phase = 'CHALLENGE';
          publish({ phase: 'CHALLENGE', hint: null, progress: CHALLENGE_PROGRESS, ready: false, warning: null, challenge: null });
        }
      } finally {
        encoding = false;
        if (!disposed) setBusy(false);
      }
    };

    const visibleNorm = (vw: number, vh: number): NormRect | undefined => {
      const s = stageRef.current;
      if (!s.width || !s.height) return undefined;
      const r = visibleVideoRect(s.width, s.height, vw, vh);
      return { x: r.x / vw, y: r.y / vh, width: r.width / vw, height: r.height / vh };
    };

    /** One frame of the challenge phase. */
    const challengeFrame = (ts: number): void => {
      const c = challengeRef.current;
      if (c === undefined) {
        publish({ phase: 'CHALLENGE', hint: null, progress: CHALLENGE_PROGRESS, ready: false, warning: null, challenge: null });
        return;
      }
      if (c === null || c.actions.length === 0) {
        finish();
        return;
      }
      if (Date.parse(c.expiresAt) <= Date.now()) {
        if (expiredReported !== c.challengeId) {
          expiredReported = c.challengeId;
          cbs.current.onChallengeExpired();
        }
        publish({ phase: 'CHALLENGE', hint: null, progress: CHALLENGE_PROGRESS, ready: false, warning: null, challenge: null });
        return;
      }
      if (!active || active.challengeId !== c.challengeId) {
        // New (or renewed) challenge: start from the first action with no frames.
        active = c;
        snapshots.clear();
        completedCount = 0;
        detector = new ChallengeDetector(c.actions);
        detectorStage = 'NEUTRAL';
        detectorIndex = 0;
        timed = !tracker && !scripted ? new TimedChallenge(c.actions) : null;
        scriptedPoses = kit ? new kit.ScriptedChallenge(c.actions) : null;
        loop.setFps(CHALLENGE_FPS);
      }
      const actions = c.actions;
      const progressFor = (i: number) => CHALLENGE_PROGRESS + (1 - CHALLENGE_PROGRESS) * (i / actions.length);

      if (timed) {
        const r = timed.update(ts);
        if (r.slot) snapshots.put(r.slot, video);
        if (r.index > completedCount && r.index <= actions.length) completedCount = r.index;
        if (r.done) {
          finishChallenge(c);
          return;
        }
        publish({
          phase: 'CHALLENGE', hint: null, progress: progressFor(r.index), ready: false, warning: null,
          challenge: { actions, index: r.index, hint: r.index < actions.length ? actions[r.index] : 'LOOK_STRAIGHT', slow: false, restarted: false, completedCount, timed: true },
        });
        return;
      }

      let input: ChallengeFrameInput;
      if (scriptedPoses) {
        const pose = scriptedPoses.pose(ts, detectorStage, detectorIndex);
        sim?.setPose({ turn: pose.turn, pitch: pose.pitch, eyesClosed: pose.blink > 0.5, smile: pose.smile });
        sim?.setFaceScale(pose.scale);
        input = {
          timestamp: ts, faceCount: 1, turn: pose.turn, pitch: pose.pitch, smile: pose.smile,
          faceArea: SIM_FACE_AREA * pose.scale * pose.scale, blink: pose.blink, ear: null,
        };
      } else if (tracker) {
        input = challengeInput(tracker.detect(video, ts), ts);
      } else {
        return;
      }
      const step = detector!.update(input);
      detectorStage = step.stage;
      detectorIndex = step.index;
      if (step.restarted) snapshots.clear();
      if (step.capture) snapshots.put(step.capture.slot, video);
      if (step.completed) {
        completedCount++;
        vibrate(40);
      }
      if (step.done) {
        finishChallenge(c);
        return;
      }
      publish({
        phase: 'CHALLENGE', hint: null, progress: progressFor(step.index), ready: false, warning: null,
        challenge: { actions, index: step.index, hint: step.hint, slow: step.slow, restarted: step.restarted, completedCount, timed: false },
      });
    };

    const loop = new FrameLoop({
      video,
      fps: ANALYSIS_FPS,
      analysisWidth: 320,
      onFrame: (f) => {
        if (encoding || disposed) return;
        const ts = f.timestamp;
        if (phase === 'CHALLENGE') {
          challengeFrame(ts);
          return;
        }
        if (phase === 'DONE') return;
        if (scripted) {
          const step = scripted.update(ts);
          if (step.keepFrame) holder.grab(video);
          publish({ phase: 'NORMAL', hint: step.hint, progress: Math.min(CHALLENGE_PROGRESS, step.progress), ready: step.ready, warning: null, challenge: null });
          if (step.shot) void takeShot();
          return;
        }
        if (tracker) {
          const obs = tracker.detect(video, ts);
          const roi = faceRoi(obs.bbox, f.width, f.height);
          const motionValue = motionScore(f.gray, prevGray, f.width, f.height, roi);
          if (!prevGray || prevGray.length !== f.gray.length) prevGray = new Uint8ClampedArray(f.gray.length);
          prevGray.set(f.gray);
          const g = analyzer.update({
            timestamp: ts,
            observation: obs,
            brightness: meanLuminance(f.gray, f.width, f.height, roi),
            glare: glareRatio(f.gray, f.width, f.height, roi),
            sharpness: laplacianVariance(f.gray, f.width, f.height, roi),
            motion: motionValue,
            deviceSteady: motion.available ? motion.isSteady() : undefined,
            visible: visibleNorm(f.videoWidth, f.videoHeight),
          });
          if (g.keepFrame) holder.grab(video);
          // The analyzer's NORMAL phase reaches 0.45 (0.5 at the shot); the challenge fills the second half of the ring.
          const progress = Math.min(CHALLENGE_PROGRESS, g.progress * CHALLENGE_PROGRESS / 0.45);
          publish({ phase: 'NORMAL', hint: g.hint, progress, ready: g.ready, warning: g.warning, challenge: null });
          if (g.shot === 'NORMAL') void takeShot();
          return;
        }
        // No face model (loading or failed): basic light and blur checks for the manual shutter.
        const roi = faceRoi(null, f.width, f.height);
        lastBasic = {
          brightness: meanLuminance(f.gray, f.width, f.height, roi),
          sharpness: laplacianVariance(f.gray, f.width, f.height, roi),
        };
        if (modelFailed) {
          const hint: HintCode = lastBasic.brightness < BASIC_MIN_BRIGHTNESS ? 'TOO_DARK'
            : lastBasic.sharpness < BASIC_MIN_SHARPNESS ? 'BLURRY' : 'GOOD';
          publish({ phase, hint, progress: 0, ready: false, warning: null, challenge: null });
        }
      },
    });
    loop.start();

    shootRef.current = () => {
      if (encoding || disposed || phase !== 'NORMAL') return;
      if (!tracker && !scripted) {
        if (lastBasic.brightness < BASIC_MIN_BRIGHTNESS || lastBasic.sharpness < BASIC_MIN_SHARPNESS) {
          publish({ phase, hint: lastBasic.brightness < BASIC_MIN_BRIGHTNESS ? 'TOO_DARK' : 'BLURRY', progress: 0, ready: false, warning: null, challenge: null });
          return;
        }
      }
      holder.grab(video);
      if (scripted) scripted.manualShot();
      else analyzer.manualShot('NORMAL');
      void takeShot();
    };

    return () => {
      disposed = true;
      loop.stop();
      motion.stop();
      holder.release();
      snapshots.clear();
      shootRef.current = () => undefined;
      tracker?.reset();
    };
  }, [video, live, sim, vision]);

  // Manual shutter after 8 s without an automatic shot in the current photo phase.
  useEffect(() => {
    if (!live) return;
    setManualDue(false);
    if (view.phase !== 'NORMAL') return;
    const t = setTimeout(() => setManualDue(true), MANUAL_AFTER_MS);
    return () => clearTimeout(t);
  }, [view.phase, live]);

  const shoot = useCallback(() => shootRef.current(), []);

  return {
    ...view,
    model,
    manual: view.phase === 'NORMAL' && (model === 'failed' || manualDue),
    busy,
    shots,
    shoot,
  };
}

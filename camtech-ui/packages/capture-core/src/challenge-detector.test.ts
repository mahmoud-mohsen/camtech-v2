import { describe, expect, it } from 'vitest';
import {
  ChallengeDetector, challengeInput, eyeState, lookPitch, MAX_CHALLENGE_FRAMES, SUPPORTED_CHALLENGE_ACTIONS,
  turnFromNoseOffset, type ChallengeAction, type ChallengeFrameInput, type ChallengeStep,
} from './challenge-detector';
import { emptyObservation, eyeAspectRatio, noseOffsetOf } from './face';

interface Pose {
  turn?: number;
  pitch?: number;
  smile?: number;
  /** Face area ratio (default 0.1). */
  area?: number;
  blink?: number;
  ear?: number | null;
  faces?: number;
}

/** Feeds poses at 25 fps and records the snapshot slots in upload order (Map keeps first insertion order). */
function run(actions: ChallengeAction[], script: [Pose, number][]) {
  const d = new ChallengeDetector(actions);
  const slots = new Map<string, string>();
  const steps: ChallengeStep[] = [];
  /** Face count of every frame that was captured. */
  const capturedFaces: number[] = [];
  let t = 0;
  for (const [pose, ms] of script) {
    for (const end = t + ms; t < end; t += 40) {
      const input: ChallengeFrameInput = {
        timestamp: t, faceCount: pose.faces ?? 1, turn: pose.turn ?? 0, pitch: pose.pitch ?? 0, smile: pose.smile ?? 0.02,
        faceArea: (pose.faces ?? 1) ? pose.area ?? 0.1 : 0, blink: pose.blink ?? 0.05, ear: pose.ear ?? null,
      };
      const s = d.update(input);
      if (s.restarted) slots.clear();
      if (s.capture) {
        slots.set(s.capture.slot, s.capture.kind);
        capturedFaces.push(input.faceCount);
      }
      steps.push(s);
    }
  }
  return { d, slots, steps, capturedFaces };
}

const frontal: Pose = {};
const left: Pose = { turn: 32 };
const right: Pose = { turn: -32 };
const closed: Pose = { blink: 0.9, ear: 0.08 };
const up: Pose = { pitch: 28 };
const down: Pose = { pitch: -28 };
const smiling: Pose = { smile: 0.75 };
const near: Pose = { area: 0.15 };

describe('turn and eye helpers', () => {
  it('converts the nose offset to degrees with the right sign', () => {
    expect(turnFromNoseOffset(0)).toBe(0);
    expect(turnFromNoseOffset(0.3)).toBeGreaterThan(30);
    expect(turnFromNoseOffset(-0.3)).toBeLessThan(-30);
  });

  it('classifies eyes with hysteresis between open and closed', () => {
    expect(eyeState({ blink: 0.05, ear: 0.3 })).toBe('open');
    expect(eyeState({ blink: 0.7, ear: null })).toBe('closed');
    expect(eyeState({ blink: 0.1, ear: 0.12 })).toBe('closed');
    expect(eyeState({ blink: 0.4, ear: 0.3 })).toBe('between');
    expect(eyeState({ blink: 0.1, ear: 0.225 })).toBe('between');
    // Server thresholds: closed at EAR ≤ 0.21, open at ≥ 0.24.
    expect(eyeState({ blink: 0.1, ear: 0.21 })).toBe('closed');
    expect(eyeState({ blink: 0.1, ear: 0.24 })).toBe('open');
  });

  it('measures nose offset and eye aspect ratio from mesh landmarks', () => {
    const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }));
    // Eyes: image-left eye at x 0.40, image-right eye at x 0.60 (distance 0.2); nose at 0.56 → offset +0.3.
    lm[33] = { x: 0.37, y: 0.4 }; lm[133] = { x: 0.43, y: 0.4 };
    lm[362] = { x: 0.57, y: 0.4 }; lm[263] = { x: 0.63, y: 0.4 };
    lm[1] = { x: 0.56, y: 0.5 };
    expect(noseOffsetOf(lm)).toBeCloseTo(0.3);
    for (const [t, b] of [[160, 144], [158, 153], [385, 380], [387, 373]]) {
      lm[t] = { x: 0.5, y: 0.39 };
      lm[b] = { x: 0.5, y: 0.408 };
    }
    expect(eyeAspectRatio(lm)).toBeCloseTo(0.3, 2);
    // The same eye in a portrait 720×1280 frame: normalized y spans 1.78× fewer pixels than normalized x.
    for (const [t, b] of [[160, 144], [158, 153], [385, 380], [387, 373]]) {
      lm[t] = { x: 0.5, y: 0.4 - 0.009 * 720 / 1280 };
      lm[b] = { x: 0.5, y: 0.4 + 0.009 * 720 / 1280 };
    }
    expect(eyeAspectRatio(lm, 720 / 1280)).toBeCloseTo(0.3, 2);
    const obs = { ...emptyObservation(), faceCount: 1, noseOffset: 0.3, blink: 0.2, ear: 0.3 };
    expect(challengeInput(obs, 5)).toMatchObject({ timestamp: 5, faceCount: 1, blink: 0.2, ear: 0.3 });
    expect(challengeInput(obs, 5).turn).toBeGreaterThan(30);
  });

  it('flips the face pitch to the server sign (+ = looking up) and passes the smile through', () => {
    // FaceObservation.pitch > 0 = looking down (eulerFromMatrix).
    expect(lookPitch(20)).toBe(-20);
    expect(lookPitch(-20)).toBe(20);
    const obs = { ...emptyObservation(), faceCount: 1, pitch: -25, smile: 0.6 };
    expect(challengeInput(obs, 0)).toMatchObject({ pitch: 25, smile: 0.6 });
    expect(challengeInput({ ...emptyObservation(), pitch: -25 }, 0).pitch).toBe(0);
    expect(SUPPORTED_CHALLENGE_ACTIONS).toHaveLength(7);
    expect(SUPPORTED_CHALLENGE_ACTIONS).toContain('MOVE_CLOSER');
    expect(challengeInput({ ...emptyObservation(), faceCount: 1, faceAreaRatio: 0.12 }, 0).faceArea).toBe(0.12);
  });
});

describe('ChallengeDetector', () => {
  it('recognises a turn to the left and keeps neutral, peak, neutral frames in order', () => {
    const { d, slots, steps } = run(['TURN_LEFT'], [[frontal, 200], [{ turn: 20 }, 120], [left, 200], [{ turn: 38 }, 200], [frontal, 300]]);
    expect(d.isDone).toBe(true);
    expect([...slots.entries()]).toEqual([['n0', 'NEUTRAL'], ['a0-peak', 'TURN_PEAK'], ['n1', 'NEUTRAL']]);
    expect(steps.some((s) => s.completed === 'TURN_LEFT')).toBe(true);
    expect(steps[steps.length - 1]).toMatchObject({ done: true, progress: 1, hint: 'DONE' });
  });

  it('ignores a turn in the wrong direction', () => {
    const { d, slots } = run(['TURN_LEFT'], [[frontal, 200], [right, 1000]]);
    expect(d.isDone).toBe(false);
    expect([...slots.keys()]).toEqual(['n0']);
  });

  it('recognises a blink: open before, closed at peak, open after', () => {
    const { d, slots } = run(['BLINK'], [
      [frontal, 200], [frontal, 120], [{ blink: 0.6 }, 40], [closed, 80], [{ blink: 0.95, ear: 0.05 }, 40], [{ blink: 0.7 }, 40], [frontal, 300],
    ]);
    expect(d.isDone).toBe(true);
    expect([...slots.entries()]).toEqual([
      ['n0', 'NEUTRAL'], ['a0-pre', 'BLINK_OPEN_BEFORE'], ['a0-closed', 'BLINK_CLOSED'], ['n1', 'BLINK_OPEN_AFTER'],
    ]);
  });

  it('runs several actions in the given order within the frame budget', () => {
    const { d, slots } = run(['TURN_RIGHT', 'BLINK', 'TURN_LEFT'], [
      [frontal, 200], [right, 500], [frontal, 200], [frontal, 80], [closed, 120], [frontal, 200], [left, 500], [frontal, 300],
    ]);
    expect(d.isDone).toBe(true);
    expect([...slots.keys()]).toEqual(['n0', 'a0-peak', 'n1', 'a1-pre', 'a1-closed', 'n2', 'a2-peak', 'n3']);
    expect(slots.size).toBeLessThanOrEqual(MAX_CHALLENGE_FRAMES);
  });

  it('recognises looking up and down with a level frame after each', () => {
    const u = run(['LOOK_UP'], [[frontal, 200], [{ pitch: 15 }, 120], [up, 200], [{ pitch: 34 }, 200], [{ pitch: 16 }, 200], [frontal, 300]]);
    expect(u.d.isDone).toBe(true);
    expect([...u.slots.entries()]).toEqual([['n0', 'NEUTRAL'], ['a0-peak', 'PITCH_PEAK'], ['n1', 'NEUTRAL']]);
    expect(u.steps.some((s) => s.completed === 'LOOK_UP')).toBe(true);
    expect(u.steps.some((s) => s.hint === 'LOOK_UP')).toBe(true);
    // Still looking up (16° > level 12°): no neutral frame yet.
    const notLevel = run(['LOOK_UP'], [[frontal, 200], [up, 500], [{ pitch: 16 }, 600]]);
    expect(notLevel.d.isDone).toBe(false);
    expect([...notLevel.slots.keys()]).toEqual(['n0', 'a0-peak']);

    const dn = run(['LOOK_DOWN'], [[frontal, 200], [down, 500], [frontal, 300]]);
    expect(dn.d.isDone).toBe(true);
    expect([...dn.slots.entries()]).toEqual([['n0', 'NEUTRAL'], ['a0-peak', 'PITCH_PEAK'], ['n1', 'NEUTRAL']]);
  });

  it('ignores looking the wrong way and a nod below the threshold', () => {
    const wrongUp = run(['LOOK_UP'], [[frontal, 200], [down, 1000], [frontal, 300]]);
    expect(wrongUp.d.isDone).toBe(false);
    expect([...wrongUp.slots.keys()]).toEqual(['n0']);
    const wrongDown = run(['LOOK_DOWN'], [[frontal, 200], [up, 1000], [frontal, 300]]);
    expect(wrongDown.d.isDone).toBe(false);
    const small = run(['LOOK_UP'], [[frontal, 200], [{ pitch: 16 }, 1000], [frontal, 300]]);
    expect(small.d.isDone).toBe(false);
    // A turn is not a look up / down.
    const turned = run(['LOOK_DOWN'], [[frontal, 200], [left, 1000], [frontal, 300]]);
    expect(turned.d.isDone).toBe(false);
  });

  it('recognises a smile from a relaxed mouth and back', () => {
    const { d, slots, steps } = run(['SMILE'], [[frontal, 200], [{ smile: 0.4 }, 120], [smiling, 200], [{ smile: 0.9 }, 200], [frontal, 300]]);
    expect(d.isDone).toBe(true);
    expect([...slots.entries()]).toEqual([['n0', 'NEUTRAL'], ['a0-peak', 'SMILE_PEAK'], ['n1', 'NEUTRAL']]);
    expect(steps.some((s) => s.completed === 'SMILE')).toBe(true);
    expect(steps.some((s) => s.hint === 'SMILE')).toBe(true);
  });

  it('needs a relaxed mouth for the neutral frames of a smile challenge, and a real smile for the action', () => {
    // Smiling from the start: no opening neutral frame (the server compares the smile to it).
    const early = run(['SMILE'], [[{ smile: 0.35 }, 600]]);
    expect(early.slots.size).toBe(0);
    // Half a smile does not count.
    const half = run(['SMILE'], [[frontal, 200], [{ smile: 0.4 }, 1000], [frontal, 300]]);
    expect(half.d.isDone).toBe(false);
    // Turning the head is not a smile.
    const turned = run(['SMILE'], [[frontal, 200], [left, 1000], [frontal, 300]]);
    expect(turned.d.isDone).toBe(false);
    // Without a smile in the challenge, a smiling face is a fine neutral frame.
    const turn = run(['TURN_LEFT'], [[{ smile: 0.35 }, 200], [{ turn: 32, smile: 0.35 }, 500], [{ smile: 0.35 }, 300]]);
    expect(turn.d.isDone).toBe(true);
  });

  it('recognises moving closer against the opening neutral frame, then back to the normal distance', () => {
    const { d, slots, steps } = run(['MOVE_CLOSER'], [[frontal, 200], [{ area: 0.12 }, 120], [near, 200], [{ area: 0.17 }, 200], [frontal, 300]]);
    expect(d.isDone).toBe(true);
    expect([...slots.entries()]).toEqual([['n0', 'NEUTRAL'], ['a0-peak', 'CLOSER_PEAK'], ['n1', 'NEUTRAL']]);
    expect(steps.some((s) => s.completed === 'MOVE_CLOSER')).toBe(true);
    expect(steps.some((s) => s.hint === 'MOVE_CLOSER')).toBe(true);
  });

  it('needs enough growth for moving closer and a real return to the normal distance', () => {
    // 1.3× the opening area is below the 1.35× target.
    const small = run(['MOVE_CLOSER'], [[frontal, 200], [{ area: 0.13 }, 1000], [frontal, 300]]);
    expect(small.d.isDone).toBe(false);
    expect([...small.slots.keys()]).toEqual(['n0']);
    // Moving away is not moving closer.
    const away = run(['MOVE_CLOSER'], [[frontal, 200], [{ area: 0.05 }, 1000]]);
    expect(away.d.isDone).toBe(false);
    // Still 1.25× bigger (above 1.15×): no neutral frame yet.
    const stay = run(['MOVE_CLOSER'], [[frontal, 200], [near, 500], [{ area: 0.125 }, 600]]);
    expect(stay.d.isDone).toBe(false);
    expect([...stay.slots.keys()]).toEqual(['n0', 'a0-peak']);
    // The baseline is the opening neutral frame, not the absolute size: a closer start needs a bigger face.
    const closeStart = run(['MOVE_CLOSER'], [[{ area: 0.2 }, 200], [{ area: 0.25 }, 1000]]);
    expect(closeStart.d.isDone).toBe(false);
  });

  it('runs all seven actions within the frame budget', () => {
    const { d, slots } = run(['LOOK_UP', 'TURN_LEFT', 'SMILE', 'BLINK', 'MOVE_CLOSER', 'LOOK_DOWN', 'TURN_RIGHT'], [
      [frontal, 200], [up, 500], [frontal, 200], [left, 500], [frontal, 200], [smiling, 500], [frontal, 200],
      [frontal, 80], [closed, 120], [frontal, 200], [near, 500], [frontal, 200], [down, 500], [frontal, 200], [right, 500],
      [frontal, 300],
    ]);
    expect(d.isDone).toBe(true);
    expect([...slots.keys()]).toEqual([
      'n0', 'a0-peak', 'n1', 'a1-peak', 'n2', 'a2-peak', 'n3', 'a3-pre', 'a3-closed', 'n4', 'a4-peak', 'n5', 'a5-peak', 'n6',
      'a6-peak', 'n7',
    ]);
    expect(slots.size).toBe(16);
    expect(MAX_CHALLENGE_FRAMES).toBe(16);
  });

  it('never hands out more than MAX_CHALLENGE_FRAMES slots', () => {
    // Repeated actions (more than the server ever issues) would need 1 + 9 × 2 = 19 frames.
    const actions: ChallengeAction[] = Array.from({ length: 9 }, (_v, i) => (i % 2 ? 'TURN_LEFT' : 'TURN_RIGHT'));
    const script: [Pose, number][] = [[frontal, 200]];
    for (const a of actions) script.push([a === 'TURN_LEFT' ? left : right, 500], [frontal, 200]);
    const { d, slots, steps } = run(actions, script);
    expect(d.isDone).toBe(true);
    expect(slots.size).toBe(MAX_CHALLENGE_FRAMES);
    expect(steps.filter((s) => s.capture).length).toBeGreaterThanOrEqual(MAX_CHALLENGE_FRAMES);
  });

  it('never keeps a frame without exactly one face', () => {
    const { capturedFaces, slots } = run(['LOOK_UP', 'BLINK', 'SMILE', 'MOVE_CLOSER'], [
      [{ faces: 0 }, 300], [frontal, 200], [{ faces: 0, pitch: 30 }, 200], [{ faces: 2, pitch: 30 }, 200], [up, 400],
      [{ faces: 0 }, 200], [frontal, 200], [{ faces: 0, blink: 0.9, ear: 0.05 }, 120], [closed, 120], [frontal, 200],
      [{ faces: 2, smile: 0.9 }, 300], [smiling, 400], [{ faces: 0 }, 200], [frontal, 300],
      [{ faces: 2, area: 0.2 }, 200], [near, 400], [{ faces: 0 }, 200], [frontal, 300],
    ]);
    expect(slots.size).toBeGreaterThan(0);
    expect(capturedFaces.every((n) => n === 1)).toBe(true);
  });

  it('needs the actions in order', () => {
    const { d } = run(['TURN_RIGHT', 'TURN_LEFT'], [[frontal, 200], [left, 600], [frontal, 300]]);
    expect(d.isDone).toBe(false);
  });

  it('flags a slow action and restarts after losing the face', () => {
    const slow = run(['BLINK'], [[frontal, 200], [{ turn: 12 }, 8500]]);
    expect(slow.steps[slow.steps.length - 1].slow).toBe(true);
    const lost = run(['TURN_LEFT', 'BLINK'], [[frontal, 200], [left, 500], [{ faces: 0 }, 1400], [frontal, 200]]);
    expect(lost.steps.some((s) => s.restarted)).toBe(true);
    expect([...lost.slots.keys()]).toEqual(['n0']);
    const two = run(['TURN_LEFT'], [[frontal, 200], [{ faces: 2 }, 200]]);
    expect(two.steps[two.steps.length - 1].hint).toBe('MULTIPLE_FACES');
  });

  it('is immediately done without actions', () => {
    const d = new ChallengeDetector([]);
    expect(d.update({ timestamp: 0, faceCount: 1, turn: 0, pitch: 0, smile: 0, faceArea: 0.1, blink: 0, ear: null }).done).toBe(true);
  });
});

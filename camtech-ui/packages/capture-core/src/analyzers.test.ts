import { describe, expect, it } from 'vitest';
import { emptyObservation, type FaceObservation } from './face';
import { assessSelfieFrame, SelfieAnalyzer, type SelfieFrameInput } from './selfie-analyzer';
import { DocumentAnalyzer, documentHint, measureDocumentFrame, type DocumentMetrics } from './document-analyzer';
import { edgeSharpness } from './quality';
import { boxBlur, fillRect, noise, solid, textBand, type TestImage } from './test-images';

function obs(over: Partial<FaceObservation> & { h?: number; cx?: number; cy?: number } = {}): FaceObservation {
  const h = over.h ?? 0.38;
  const w = h * 0.75;
  const cx = 0.5 + (over.cx ?? 0);
  const cy = 0.5 + (over.cy ?? 0);
  return {
    ...emptyObservation(),
    faceCount: 1,
    bbox: { x: cx - w / 2, y: cy - h / 2, width: w, height: h },
    faceAreaRatio: w * h,
    faceHeightRatio: h,
    centerOffset: { x: cx - 0.5, y: cy - 0.5 },
    eyesOpen: true,
    eyeOpenness: 1,
    ...over,
  };
}

function frame(t: number, o: FaceObservation, over: Partial<SelfieFrameInput> = {}): SelfieFrameInput {
  return { timestamp: t, observation: o, brightness: 130, glare: 0, sharpness: 60, motion: 1, ...over };
}

describe('assessSelfieFrame', () => {
  const cases: [string, SelfieFrameInput, string][] = [
    ['no face', frame(0, emptyObservation()), 'NO_FACE'],
    ['two faces', frame(0, obs({ faceCount: 2 })), 'MULTIPLE_FACES'],
    ['too far', frame(0, obs({ h: 0.2 })), 'MOVE_CLOSER'],
    ['too near', frame(0, obs({ h: 0.6 })), 'MOVE_BACK'],
    ['off centre', frame(0, obs({ cx: 0.2 })), 'CENTER_FACE'],
    ['turned', frame(0, obs({ yaw: 25 })), 'LOOK_STRAIGHT'],
    ['nodding', frame(0, obs({ pitch: -28 })), 'LOOK_STRAIGHT'],
    ['tilted', frame(0, obs({ roll: 14 })), 'HEAD_LEVEL'],
    ['dark', frame(0, obs(), { brightness: 40 }), 'TOO_DARK'],
    ['bright', frame(0, obs(), { brightness: 240 }), 'TOO_BRIGHT'],
    ['glare', frame(0, obs(), { glare: 0.4 }), 'TOO_BRIGHT'],
    ['eyes closed', frame(0, obs({ eyesOpen: false })), 'OPEN_EYES'],
    ['moving', frame(0, obs(), { motion: 12 }), 'HOLD_STILL'],
    ['jittery', frame(0, obs({ jitter: 0.05 })), 'HOLD_STILL'],
    ['phone shaking', frame(0, obs(), { deviceSteady: false }), 'HOLD_STILL'],
    ['blurry', frame(0, obs(), { sharpness: 5 }), 'BLURRY'],
    ['good', frame(0, obs()), 'GOOD'],
  ];
  it.each(cases)('%s', (_name, input, expected) => {
    expect(assessSelfieFrame(input, 'NORMAL', null).hint).toBe(expected);
  });

  it('applies hysteresis: a failing check must clear a margin to pass', () => {
    const borderline = frame(0, obs({ h: 0.285 }));
    expect(assessSelfieFrame(borderline, 'NORMAL', null).hint).toBe('GOOD');
    expect(assessSelfieFrame(borderline, 'NORMAL', null, undefined, { MOVE_CLOSER: true }).hint).toBe('MOVE_CLOSER');
  });

  it('requires the closer face to be 1.3× the normal area', () => {
    const normalArea = obs().faceAreaRatio;
    expect(assessSelfieFrame(frame(0, obs({ h: 0.4 })), 'CLOSER', normalArea).hint).toBe('MOVE_CLOSER');
    const closer = assessSelfieFrame(frame(0, obs({ h: 0.38 * 1.2 })), 'CLOSER', normalArea);
    expect(closer.hint).toBe('GOOD');
    expect(closer.areaRatio).toBeCloseTo(1.44, 2);
    expect(assessSelfieFrame(frame(0, obs({ h: 0.95 })), 'CLOSER', normalArea).hint).toBe('MOVE_BACK');
  });

  it('measures size relative to the visible part of the frame', () => {
    // Face is 0.25 of the full frame height but the preview only shows the middle 60%.
    const input = frame(0, obs({ h: 0.25 }), { visible: { x: 0, y: 0.2, width: 1, height: 0.6 } });
    expect(assessSelfieFrame(input, 'NORMAL', null).hint).toBe('GOOD');
  });
});

describe('SelfieAnalyzer', () => {
  it('takes the normal shot after 500 ms of stability, then the closer shot', () => {
    const a = new SelfieAnalyzer();
    let t = 0;
    let shots: string[] = [];
    let kept = 0;
    const run = (o: FaceObservation, ms: number, over: Partial<SelfieFrameInput> = {}) => {
      for (const end = t + ms; t < end; t += 70) {
        const g = a.update(frame(t, o, over));
        if (g.keepFrame) kept++;
        if (g.shot) shots = [...shots, g.shot];
      }
    };
    run(emptyObservation(), 300);
    run(obs({ h: 0.2 }), 300);
    expect(shots).toEqual([]);
    run(obs(), 700, { sharpness: 50 });
    expect(shots).toEqual(['NORMAL']);
    expect(kept).toBeGreaterThan(0);
    expect(a.currentPhase).toBe('CLOSER');
    expect(a.normalFaceArea).toBeCloseTo(obs().faceAreaRatio);

    run(obs(), 700);
    expect(shots).toEqual(['NORMAL']);
    run(obs({ h: 0.38 * 1.2 }), 700);
    expect(shots).toEqual(['NORMAL', 'CLOSER']);
    expect(a.currentPhase).toBe('DONE');
    expect(a.update(frame(t, obs())).progress).toBe(1);
  });

  it('keeps only frames sharper than the best one in the window', () => {
    const a = new SelfieAnalyzer();
    expect(a.update(frame(0, obs(), { sharpness: 40 })).keepFrame).toBe(true);
    expect(a.update(frame(70, obs(), { sharpness: 30 })).keepFrame).toBe(false);
    expect(a.update(frame(140, obs(), { sharpness: 80 })).keepFrame).toBe(true);
  });

  it('restarts the closer shot and warns when the face is lost for more than 1.2 s', () => {
    const a = new SelfieAnalyzer();
    let t = 0;
    for (; t <= 600; t += 60) a.update(frame(t, obs()));
    expect(a.currentPhase).toBe('CLOSER');
    let warned = false;
    for (const end = t + 1500; t < end; t += 100) {
      const g = a.update(frame(t, emptyObservation()));
      if (g.warning === 'TRACKING_LOST') warned = true;
    }
    expect(warned).toBe(true);
    expect(a.currentPhase).toBe('CLOSER');
    const g = a.update(frame(t, obs({ h: 0.38 * 1.2 })));
    expect(g.warning).toBeNull();
  });

  it('debounces hint changes', () => {
    const a = new SelfieAnalyzer();
    expect(a.update(frame(0, obs({ h: 0.2 }))).hint).toBe('MOVE_CLOSER');
    expect(a.update(frame(50, obs({ yaw: 30 }))).hint).toBe('MOVE_CLOSER');
    expect(a.update(frame(100, obs({ h: 0.2 }))).hint).toBe('MOVE_CLOSER');
    expect(a.update(frame(150, obs({ yaw: 30 }))).hint).toBe('MOVE_CLOSER');
    expect(a.update(frame(450, obs({ yaw: 30 }))).hint).toBe('LOOK_STRAIGHT');
  });

  it('tolerates a short blink without breaking the stable window', () => {
    const a = new SelfieAnalyzer();
    a.update(frame(0, obs()));
    a.update(frame(200, obs()));
    const blink = a.update(frame(260, obs({ eyesOpen: false })));
    expect(blink.keepFrame).toBe(false);
    expect(blink.rawHint).toBe('GOOD');
    const g = a.update(frame(520, obs()));
    expect(g.shot).toBe('NORMAL');
  });

  it('supports a manual normal shot without a face model', () => {
    const a = new SelfieAnalyzer();
    a.manualShot('NORMAL');
    expect(a.currentPhase).toBe('CLOSER');
    expect(a.normalFaceArea).toBeNull();
    a.manualShot('CLOSER');
    expect(a.currentPhase).toBe('DONE');
  });
});

describe('document analysis', () => {
  const W = 320;
  const H = 240;
  const guide = { x: 20, y: 40, width: 280, height: 176 };

  function card(over: { glare?: boolean; dark?: boolean; small?: boolean; mrz?: boolean; washed?: boolean } = {}) {
    const bg = noise(W, H, over.dark ? 20 : 70, 6);
    const r = over.small ? { x: 76, y: 75, width: 168, height: 106 } : guide;
    fillRect(bg, r, over.dark ? 45 : 200);
    // Printed content so the card is sharp.
    textBand(bg, { x: r.x + r.width * 0.4, y: r.y + r.height * 0.15, width: r.width * 0.5, height: r.height * 0.4 });
    if (over.mrz) textBand(bg, { x: r.x + 8, y: r.y + r.height * 0.82, width: r.width - 16, height: r.height * 0.15 });
    if (over.glare) fillRect(bg, { x: r.x + 30, y: r.y + 20, width: 30, height: 20 }, 255);
    if (over.dark) for (let i = 0; i < bg.data.length; i++) bg.data[i] = bg.data[i] * 0.25;
    // Screen glow: everything pushed towards light grey.
    if (over.washed) for (let i = 0; i < bg.data.length; i++) bg.data[i] = 175 + bg.data[i] * 0.15;
    return bg;
  }

  const metrics = (img: ReturnType<typeof card>, mrz = false, portrait: boolean | null = null): DocumentMetrics => ({
    ...measureDocumentFrame(img.data, W, H, guide, null, mrz),
    portrait,
    detail: null,
  });
  const noReq = { portrait: false, mrz: false };

  it('accepts a well-placed card', () => {
    expect(documentHint(metrics(card()), 'ID_CARD', noReq)).toBe('GOOD');
  });

  it('detects glare, darkness, a small card and an empty scene', () => {
    expect(documentHint(metrics(card({ glare: true })), 'ID_CARD', noReq)).toBe('GLARE');
    expect(documentHint(metrics(card({ dark: true })), 'ID_CARD', noReq)).toBe('TOO_DARK');
    expect(documentHint(metrics(card({ washed: true })), 'ID_CARD', noReq)).toBe('LOW_CONTRAST');
    expect(documentHint(metrics(card({ small: true })), 'ID_CARD', noReq)).toBe('MOVE_CLOSER');
    expect(documentHint(metrics(noise(W, H, 70, 2)), 'ID_CARD', noReq)).toBe('NO_DOCUMENT');
  });

  it('requires a portrait and the MRZ when asked', () => {
    expect(documentHint(metrics(card(), false, false), 'ID_CARD', { portrait: true, mrz: false })).toBe('NO_PORTRAIT');
    expect(documentHint(metrics(card(), false, true), 'ID_CARD', { portrait: true, mrz: false })).toBe('GOOD');
    expect(documentHint(metrics(card(), true, true), 'PASSPORT', { portrait: true, mrz: true })).toBe('ALIGN_DOCUMENT');
    expect(documentHint(metrics(card({ mrz: true }), true, true), 'PASSPORT', { portrait: true, mrz: true })).toBe('GOOD');
  });

  it('shoots after the document is good and still for 800 ms', () => {
    const a = new DocumentAnalyzer('ID_CARD', { portrait: true, mrz: false });
    const img = card();
    const inside = [{ bbox: { x: 0.2, y: 0.4, width: 0.15, height: 0.2 }, score: 0.9 }];
    let shot = false;
    let kept = false;
    for (let t = 0; t <= 910 && !shot; t += 70) {
      const g = a.update({ timestamp: t, gray: img.data, width: W, height: H, guide, portraits: t === 0 ? inside : undefined });
      kept ||= g.keepFrame;
      shot = g.shot;
    }
    expect(kept).toBe(true);
    expect(shot).toBe(true);
  });

  it('reports motion between frames', () => {
    const a = new DocumentAnalyzer('ID_CARD', noReq);
    a.update({ timestamp: 0, gray: card().data, width: W, height: H, guide });
    const moved = card();
    for (let i = 0; i < moved.data.length; i++) moved.data[i] = Math.min(255, moved.data[i] + 20);
    const g = a.update({ timestamp: 70, gray: moved.data, width: W, height: H, guide });
    expect(g.rawHint).toBe('HOLD_STILL');
  });

  it('skips the portrait check when no detector is available', () => {
    const a = new DocumentAnalyzer('ID_CARD', { portrait: true, mrz: false });
    const g = a.update({ timestamp: 0, gray: card().data, width: W, height: H, guide, portraits: null });
    expect(g.metrics.portrait).toBeNull();
    expect(g.rawHint).toBe('GOOD');
  });
});

describe('document text sharpness', () => {
  const W = 600;
  const H = 200;
  /** Glyph-like strokes: 3 px wide, 12 px tall, a line every 20 px. */
  function print(ink: number, paper: number): TestImage {
    const t = solid(W, H, paper);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (y % 20 < 12 && x % 7 < 3 && Math.floor(x / 40) % 5 !== 4) t.data[y * W + x] = ink;
      }
    }
    return t;
  }
  const withNoise = (img: TestImage, amplitude: number): TestImage => {
    let seed = 7;
    for (let i = 0; i < img.data.length; i++) {
      seed = (seed * 16807) % 2147483647;
      img.data[i] = img.data[i] + (seed / 2147483647 * 2 - 1) * amplitude;
    }
    return img;
  };
  const score = (img: TestImage): number => edgeSharpness(img.data, W, H);

  it('keeps sharp or slightly soft print above the threshold, also with sensor noise', () => {
    expect(score(print(40, 210))).toBeGreaterThan(0.9);
    expect(score(withNoise(boxBlur(print(40, 210), 2), 10))).toBeGreaterThan(0.6);
    expect(score(boxBlur(print(40, 210), 4))).toBeGreaterThan(0.4);
  });

  it('drops blurred print below the threshold', () => {
    expect(score(boxBlur(print(40, 210), 10))).toBeLessThan(0.35);
    expect(score(withNoise(boxBlur(print(40, 210), 16), 10))).toBeLessThan(0.35);
  });

  it('scores 0 when there is no readable contrast', () => {
    expect(score(withNoise(solid(W, H, 200), 10))).toBe(0);
  });
});

describe('document lighting and detail', () => {
  const W = 320;
  const H = 240;
  const guide = { x: 20, y: 40, width: 280, height: 176 };
  const noReq = { portrait: false, mrz: false };
  function card(): TestImage {
    const bg = noise(W, H, 70, 6);
    fillRect(bg, guide, 200);
    return textBand(bg, { x: guide.x + guide.width * 0.4, y: guide.y + guide.height * 0.15, width: guide.width * 0.5, height: guide.height * 0.4 });
  }
  const at = (img: TestImage, detail: number | null = null): DocumentMetrics => ({
    ...measureDocumentFrame(img.data, W, H, guide, null, false), portrait: null, detail,
  });

  it('asks for less light when the card is overexposed', () => {
    const img = card();
    for (let i = 0; i < img.data.length; i++) img.data[i] = Math.min(255, img.data[i] + 90);
    expect(documentHint(at(img), 'ID_CARD', noReq)).toBe('TOO_BRIGHT');
  });

  it('rejects blurry text found on the full-resolution frame', () => {
    expect(documentHint(at(card(), 0.2), 'ID_CARD', noReq)).toBe('BLURRY');
    expect(documentHint(at(card(), 0.6), 'ID_CARD', noReq)).toBe('GOOD');
  });

  it('measures the detail only when everything else passes, and keeps the sharpest frame by it', () => {
    const a = new DocumentAnalyzer('ID_CARD', noReq);
    let calls = 0;
    const img = card();
    const values = [0.5, 0.8, 0.6];
    const kept: boolean[] = [];
    for (let i = 0; i < 3; i++) {
      kept.push(a.update({ timestamp: i * 80, gray: img.data, width: W, height: H, guide, detail: () => values[calls++] }).keepFrame);
    }
    expect(calls).toBe(3);
    expect(kept).toEqual([true, true, false]);
    const dark = new DocumentAnalyzer('ID_CARD', noReq);
    const black = noise(W, H, 10, 2);
    dark.update({ timestamp: 0, gray: black.data, width: W, height: H, guide, detail: () => { calls++; return 1; } });
    expect(calls).toBe(3);
  });
});

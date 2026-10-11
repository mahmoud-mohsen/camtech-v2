import { describe, expect, it } from 'vitest';
import type { NormalizedLandmark } from '@mediapipe/tasks-vision';
import { eulerFromMatrix, observationFromResult } from './face';
import { CameraError, pickMainRearCamera, toCameraError } from './camera';

/** Column-major 4×4 from a row-major 3×3 rotation. */
function matrix(r: number[][]): number[] {
  const m = new Array<number>(16).fill(0);
  for (let row = 0; row < 3; row++) for (let col = 0; col < 3; col++) m[col * 4 + row] = r[row][col];
  m[15] = 1;
  return m;
}
const rad = (d: number) => (d * Math.PI) / 180;

describe('eulerFromMatrix', () => {
  it('reads identity as facing the camera', () => {
    const e = eulerFromMatrix(matrix([[1, 0, 0], [0, 1, 0], [0, 0, 1]]));
    expect(e.yaw).toBeCloseTo(0);
    expect(e.pitch).toBeCloseTo(0);
    expect(e.roll).toBeCloseTo(0);
  });

  it('reads yaw, pitch and roll from single-axis rotations', () => {
    const c = Math.cos(rad(20));
    const s = Math.sin(rad(20));
    expect(eulerFromMatrix(matrix([[c, 0, s], [0, 1, 0], [-s, 0, c]])).yaw).toBeCloseTo(20);
    expect(eulerFromMatrix(matrix([[1, 0, 0], [0, c, -s], [0, s, c]])).pitch).toBeCloseTo(20);
    expect(eulerFromMatrix(matrix([[c, -s, 0], [s, c, 0], [0, 0, 1]])).roll).toBeCloseTo(20);
  });

  it('handles short input', () => {
    expect(eulerFromMatrix([1, 2])).toEqual({ yaw: 0, pitch: 0, roll: 0 });
  });
});

function face(x0: number, y0: number, w: number, h: number, shift = 0): NormalizedLandmark[] {
  // 478 points spread over the box; anchors land inside it.
  return Array.from({ length: 478 }, (_, i) => ({
    x: x0 + shift + ((i * 37) % 100) / 100 * w,
    y: y0 + ((i * 53) % 100) / 100 * h,
    z: 0,
    visibility: 1,
  })).concat([{ x: x0 + shift + w, y: y0 + h, z: 0, visibility: 1 }]);
}

const blend = (blink: number) => ({
  categories: [
    { categoryName: 'eyeBlinkLeft', score: blink, index: 0, displayName: '' },
    { categoryName: 'eyeBlinkRight', score: blink, index: 1, displayName: '' },
  ],
  headIndex: 0,
  headName: '',
});

describe('observationFromResult', () => {
  it('returns an empty observation without faces', () => {
    const o = observationFromResult({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] });
    expect(o.faceCount).toBe(0);
    expect(o.bbox).toBeNull();
  });

  it('measures the main face box, centre, eyes and jitter', () => {
    const lm = face(0.3, 0.3, 0.4, 0.4);
    const ident = { rows: 4, columns: 4, data: matrix([[1, 0, 0], [0, 1, 0], [0, 0, 1]]) };
    const first = observationFromResult({ faceLandmarks: [lm], faceBlendshapes: [blend(0.1)], facialTransformationMatrixes: [ident] });
    expect(first.faceCount).toBe(1);
    expect(first.faceHeightRatio).toBeCloseTo(0.4);
    expect(first.faceAreaRatio).toBeCloseTo(0.16);
    expect(first.centerOffset.x).toBeCloseTo(0);
    expect(first.eyesOpen).toBe(true);
    expect(first.jitter).toBe(0);

    const moved = observationFromResult({
      faceLandmarks: [face(0.3, 0.3, 0.4, 0.4, 0.04)], faceBlendshapes: [blend(0.8)], facialTransformationMatrixes: [ident],
    }, first);
    expect(moved.eyesOpen).toBe(false);
    expect(moved.jitter).toBeCloseTo(0.1, 2);
  });

  it('reads the smile from both mouth corners and the pitch sign from the matrix', () => {
    const c = Math.cos(rad(20));
    const s = Math.sin(rad(20));
    // Rotation about +x by +20°: the nose (+z) turns towards −y, i.e. the person looks down.
    const down = { rows: 4, columns: 4, data: matrix([[1, 0, 0], [0, c, -s], [0, s, c]]) };
    const shapes = {
      categories: [
        { categoryName: 'mouthSmileLeft', score: 0.6, index: 0, displayName: '' },
        { categoryName: 'mouthSmileRight', score: 0.8, index: 1, displayName: '' },
      ],
      headIndex: 0,
      headName: '',
    };
    const o = observationFromResult({ faceLandmarks: [face(0.3, 0.3, 0.4, 0.4)], faceBlendshapes: [shapes], facialTransformationMatrixes: [down] });
    expect(o.smile).toBeCloseTo(0.7);
    expect(o.pitch).toBeCloseTo(20);
    expect(observationFromResult({ faceLandmarks: [], faceBlendshapes: [], facialTransformationMatrixes: [] }).smile).toBe(0);
  });

  it('picks the largest of several faces', () => {
    const o = observationFromResult({
      faceLandmarks: [face(0, 0, 0.1, 0.1), face(0.4, 0.4, 0.3, 0.3)], faceBlendshapes: [], facialTransformationMatrixes: [],
    });
    expect(o.faceCount).toBe(2);
    expect(o.bbox?.x).toBeCloseTo(0.4);
  });
});

describe('camera helpers', () => {
  const dev = (deviceId: string, label: string, kind: MediaDeviceKind = 'videoinput') => ({ deviceId, label, kind });

  it('picks the main rear lens on a multi-lens Android phone', () => {
    const picked = pickMainRearCamera([
      dev('f', 'camera2 1, facing front'),
      dev('u', 'camera2 2, facing back (ultra wide)'),
      dev('m', 'camera2 0, facing back'),
      dev('t', 'camera2 3, facing back telephoto'),
    ]);
    expect(picked?.deviceId).toBe('m');
  });

  it('picks the iPhone back camera over ultra wide and telephoto', () => {
    const picked = pickMainRearCamera([
      dev('1', 'Front Camera'),
      dev('2', 'Back Ultra Wide Camera'),
      dev('3', 'Back Camera'),
      dev('4', 'Back Telephoto Camera'),
      dev('5', 'Back Dual Wide Camera'),
    ]);
    expect(picked?.deviceId).toBe('3');
  });

  it('returns undefined without labels or rear cameras', () => {
    expect(pickMainRearCamera([dev('a', ''), dev('b', '')])).toBeUndefined();
    expect(pickMainRearCamera([dev('a', 'Integrated Webcam'), dev('m', 'Mic', 'audioinput')])).toBeUndefined();
  });

  it('maps getUserMedia errors to codes', () => {
    const err = (name: string) => Object.assign(new Error('x'), { name });
    expect(toCameraError(err('NotAllowedError')).code).toBe('PERMISSION_DENIED');
    expect(toCameraError(err('NotFoundError')).code).toBe('NOT_FOUND');
    expect(toCameraError(err('NotReadableError')).code).toBe('IN_USE');
    expect(toCameraError(err('OverconstrainedError')).code).toBe('OVERCONSTRAINED');
    expect(toCameraError(err('Weird')).code).toBe('UNKNOWN');
    const ce = new CameraError('INSECURE_CONTEXT');
    expect(toCameraError(ce)).toBe(ce);
  });
});

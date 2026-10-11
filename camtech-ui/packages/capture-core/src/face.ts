// On-device face tracking with MediaPipe Tasks Vision, loaded lazily (the wasm and models are several MB).
import type {
  Classifications, Detection, FaceDetector, FaceLandmarker, FaceLandmarkerResult, FilesetResolver, Matrix,
  NormalizedLandmark,
} from '@mediapipe/tasks-vision';

export type VisionModule = typeof import('@mediapipe/tasks-vision');
type WasmFileset = Awaited<ReturnType<typeof FilesetResolver.forVisionTasks>>;

export const DEFAULT_WASM_BASE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/wasm';
export const DEFAULT_FACE_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';
export const DEFAULT_FACE_DETECTOR_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite';

export interface VisionOptions {
  wasmBaseUrl?: string;
  faceLandmarkerModelUrl?: string;
  faceDetectorModelUrl?: string;
  /** Give up after this long (download + compile). Default 20 s. */
  timeoutMs?: number;
  /** Preferred delegate. GPU falls back to CPU automatically. Default GPU. */
  delegate?: 'GPU' | 'CPU';
  /** Loads the MediaPipe module. Default: bundled dynamic import. */
  loadModule?: () => Promise<VisionModule>;
}

export type VisionErrorCode = 'TIMEOUT' | 'LOAD_FAILED' | 'UNSUPPORTED';

export class VisionLoadError extends Error {
  readonly code: VisionErrorCode;

  constructor(code: VisionErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'VisionLoadError';
    this.code = code;
  }
}

/** A normalized (0..1) rectangle in video coordinates (not mirrored). */
export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceObservation {
  faceCount: number;
  /** Bounding box of the main (largest) face, from its landmarks. */
  bbox: NormRect | null;
  /** Face box area as a fraction of the frame area. */
  faceAreaRatio: number;
  /** Face box height as a fraction of the frame height. */
  faceHeightRatio: number;
  /** Face centre minus frame centre, normalized (−0.5..0.5). */
  centerOffset: { x: number; y: number };
  /** Head pose in degrees (0 = facing the camera). pitch: + = looking down (see eulerFromMatrix). */
  yaw: number;
  pitch: number;
  roll: number;
  eyesOpen: boolean;
  /** 0 (closed) .. 1 (wide open). */
  eyeOpenness: number;
  /** Mean landmark displacement since the previous observation, relative to the face height. */
  jitter: number;
  /**
   * Nose tip minus eye midpoint, divided by the eye distance, in the unmirrored image (+ = nose towards the image's
   * right, i.e. the person turned to their own left). 0 without a face.
   */
  noseOffset: number;
  /** Eye blink score from the blendshapes, 0 (open) .. 1 (closed); the larger of both eyes. */
  blink: number;
  /** Mean eye aspect ratio from the mesh (≈0.25–0.35 open, < 0.21 closed), or null. */
  ear: number | null;
  /** Smile score from the blendshapes, 0 (neutral) .. 1 (broad smile); mean of both mouth corners. */
  smile: number;
  /** Selected landmarks of the main face (for jitter); internal use. */
  anchors: readonly { x: number; y: number }[];
}

export function emptyObservation(): FaceObservation {
  return {
    faceCount: 0, bbox: null, faceAreaRatio: 0, faceHeightRatio: 0, centerOffset: { x: 0, y: 0 }, yaw: 0, pitch: 0,
    roll: 0, eyesOpen: false, eyeOpenness: 0, jitter: 0, noseOffset: 0, blink: 0, ear: null, smile: 0,
    anchors: [],
  };
}

const RAD = 180 / Math.PI;

/**
 * Euler angles (degrees) from MediaPipe's 4×4 facial transformation matrix (column-major).
 * yaw = turn left/right, pitch = nod up/down, roll = tilt towards a shoulder.
 *
 * MediaPipe's metric space is right-handed with y up and z towards the camera (the face looks along +z). pitch is the
 * rotation about +x: a positive angle turns the nose (+z) towards −y, so pitch > 0 = the person looks DOWN.
 * Mirroring x (front camera) does not change this sign. The challenge detector flips it (+ = looking up, like the server).
 */
export function eulerFromMatrix(data: readonly number[]): { yaw: number; pitch: number; roll: number } {
  if (data.length < 16) return { yaw: 0, pitch: 0, roll: 0 };
  const r = (row: number, col: number): number => data[col * 4 + row];
  const sy = Math.max(-1, Math.min(1, -r(2, 0)));
  const yaw = Math.asin(sy) * RAD;
  const pitch = Math.atan2(r(2, 1), r(2, 2)) * RAD;
  const roll = Math.atan2(r(1, 0), r(0, 0)) * RAD;
  return { yaw, pitch, roll };
}

/** Landmark indices of the 478-point face mesh used to measure jitter: nose tip, chin, eye corners, forehead. */
const ANCHORS = [1, 152, 33, 263, 10];

function blendshape(c: Classifications | undefined, name: string): number {
  return c?.categories.find((k) => k.categoryName === name)?.score ?? 0;
}

function bboxOf(points: readonly NormalizedLandmark[]): NormRect {
  let minX = 1;
  let minY = 1;
  let maxX = 0;
  let maxY = 0;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) };
}

type Pt = Pick<NormalizedLandmark, 'x' | 'y'>;
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

/** Horizontal nose offset from the eye midpoint, normalized by the eye distance (see FaceObservation.noseOffset). */
export function noseOffsetOf(lm: readonly Pt[]): number {
  if (lm.length < 364) return 0;
  const eyeA = mid(lm[33], lm[133]);
  const eyeB = mid(lm[362], lm[263]);
  const d = Math.abs(eyeB.x - eyeA.x);
  if (d < 1e-6) return 0;
  return (lm[1].x - (eyeA.x + eyeB.x) / 2) / d;
}

/**
 * Mean eye aspect ratio of both eyes from the 478-point mesh (68-point style: 2 vertical / 1 horizontal).
 * `aspect` = image width / height: landmarks are normalized per axis, so without it a portrait phone frame shrinks
 * the ratio (open eyes read as closed) and a landscape webcam inflates it.
 */
export function eyeAspectRatio(lm: readonly Pt[], aspect = 1): number | null {
  if (lm.length < 388) return null;
  const d = (a: Pt, b: Pt): number => Math.hypot((a.x - b.x) * aspect, a.y - b.y);
  const one = (outer: number, inner: number, t1: number, b1: number, t2: number, b2: number): number => {
    const w = d(lm[outer], lm[inner]);
    return w > 1e-6 ? (d(lm[t1], lm[b1]) + d(lm[t2], lm[b2])) / (2 * w) : 0;
  };
  return (one(33, 133, 160, 144, 158, 153) + one(362, 263, 385, 380, 387, 373)) / 2;
}

/** Builds an observation from a FaceLandmarker result (pure; exported for tests). `aspect` = image width / height. */
export function observationFromResult(result: Pick<FaceLandmarkerResult, 'faceLandmarks' | 'faceBlendshapes' |
  'facialTransformationMatrixes'>, previous?: FaceObservation | null, aspect = 1): FaceObservation {
  const faces = result.faceLandmarks ?? [];
  if (faces.length === 0) return emptyObservation();
  // The main face is the largest one.
  let main = 0;
  let mainBox = bboxOf(faces[0]);
  for (let i = 1; i < faces.length; i++) {
    const b = bboxOf(faces[i]);
    if (b.width * b.height > mainBox.width * mainBox.height) {
      main = i;
      mainBox = b;
    }
  }
  const landmarks = faces[main];
  const matrix: Matrix | undefined = result.facialTransformationMatrixes?.[main];
  const pose = matrix ? eulerFromMatrix(matrix.data) : { yaw: 0, pitch: 0, roll: 0 };
  const shapes = result.faceBlendshapes?.[main];
  const blink = Math.max(blendshape(shapes, 'eyeBlinkLeft'), blendshape(shapes, 'eyeBlinkRight'));
  const smile = (blendshape(shapes, 'mouthSmileLeft') + blendshape(shapes, 'mouthSmileRight')) / 2;
  const anchors = ANCHORS.map((i) => landmarks[i]).filter(Boolean).map((p) => ({ x: p.x, y: p.y }));
  let jitter = 0;
  if (previous && previous.anchors.length === anchors.length && anchors.length && mainBox.height > 0) {
    let sum = 0;
    for (let i = 0; i < anchors.length; i++) {
      sum += Math.hypot(anchors[i].x - previous.anchors[i].x, anchors[i].y - previous.anchors[i].y);
    }
    jitter = sum / anchors.length / mainBox.height;
  }
  return {
    faceCount: faces.length,
    bbox: mainBox,
    faceAreaRatio: mainBox.width * mainBox.height,
    faceHeightRatio: mainBox.height,
    centerOffset: { x: mainBox.x + mainBox.width / 2 - 0.5, y: mainBox.y + mainBox.height / 2 - 0.5 },
    yaw: pose.yaw,
    pitch: pose.pitch,
    roll: pose.roll,
    eyesOpen: shapes ? blink < 0.5 : true,
    eyeOpenness: shapes ? 1 - blink : 1,
    jitter,
    noseOffset: noseOffsetOf(landmarks),
    blink,
    ear: eyeAspectRatio(landmarks, aspect),
    smile,
    anchors,
  };
}

// ------------------------------------------------------------------ loading

const filesets = new Map<string, Promise<WasmFileset>>();
const modules = new Map<string, Promise<VisionModule>>();

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new VisionLoadError('TIMEOUT', `Face model did not load within ${ms} ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e: unknown) => { clearTimeout(timer); reject(e); },
    );
  });
}

function loadModule(opts: VisionOptions): Promise<VisionModule> {
  const key = opts.loadModule ? 'custom' : 'bundled';
  let p = modules.get(key);
  if (!p) {
    p = (opts.loadModule ?? (() => import('@mediapipe/tasks-vision')))();
    p.catch(() => modules.delete(key));
    modules.set(key, p);
  }
  return p;
}

async function fileset(vision: VisionModule, wasmBaseUrl: string): Promise<WasmFileset> {
  let p = filesets.get(wasmBaseUrl);
  if (!p) {
    p = vision.FilesetResolver.forVisionTasks(wasmBaseUrl);
    p.catch(() => filesets.delete(wasmBaseUrl));
    filesets.set(wasmBaseUrl, p);
  }
  return p;
}

function assertVisionSupport(): void {
  if (typeof window === 'undefined' || typeof WebAssembly === 'undefined') {
    throw new VisionLoadError('UNSUPPORTED', 'WebAssembly is not available');
  }
}

async function createWithFallback<T>(create: (delegate: 'GPU' | 'CPU') => Promise<T>, preferred: 'GPU' | 'CPU'): Promise<T> {
  if (preferred === 'CPU') return create('CPU');
  try {
    return await create('GPU');
  } catch {
    return create('CPU');
  }
}

function asLoadError(e: unknown): VisionLoadError {
  if (e instanceof VisionLoadError) return e;
  return new VisionLoadError('LOAD_FAILED', e instanceof Error ? e.message : 'Face model failed to load');
}

/** Tracks faces in a live video (VIDEO running mode: timestamps must increase). */
export class FaceTracker {
  private lastTs = 0;
  private previous: FaceObservation | null = null;
  private closed = false;

  private constructor(private readonly landmarker: FaceLandmarker) {}

  static async create(opts: VisionOptions = {}): Promise<FaceTracker> {
    assertVisionSupport();
    const timeout = opts.timeoutMs ?? 20000;
    try {
      const landmarker = await withTimeout((async () => {
        const vision = await loadModule(opts);
        const files = await fileset(vision, opts.wasmBaseUrl ?? DEFAULT_WASM_BASE_URL);
        return createWithFallback((delegate) => vision.FaceLandmarker.createFromOptions(files, {
          baseOptions: { modelAssetPath: opts.faceLandmarkerModelUrl ?? DEFAULT_FACE_LANDMARKER_MODEL_URL, delegate },
          runningMode: 'VIDEO',
          numFaces: 2,
          outputFaceBlendshapes: true,
          outputFacialTransformationMatrixes: true,
          minFaceDetectionConfidence: 0.5,
          minFacePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        }), opts.delegate ?? 'GPU');
      })(), timeout);
      return new FaceTracker(landmarker);
    } catch (e) {
      throw asLoadError(e);
    }
  }

  /** Detects faces in the current video frame. */
  detect(video: HTMLVideoElement | HTMLCanvasElement | ImageBitmap, timestamp = performance.now()): FaceObservation {
    if (this.closed) return emptyObservation();
    const ts = Math.max(timestamp, this.lastTs + 1);
    this.lastTs = ts;
    const result = this.landmarker.detectForVideo(video, ts);
    const w = 'videoWidth' in video ? video.videoWidth : video.width;
    const h = 'videoHeight' in video ? video.videoHeight : video.height;
    const obs = observationFromResult(result, this.previous, w > 0 && h > 0 ? w / h : 1);
    this.previous = obs.faceCount ? obs : null;
    return obs;
  }

  /** Forget the previous frame (jitter restarts from zero). */
  reset(): void {
    this.previous = null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.landmarker.close();
    } catch {
      /* already closed */
    }
  }
}

export interface PortraitObservation {
  /** Normalized box in the source image. */
  bbox: NormRect;
  score: number;
}

/** Detects the portrait photo on an identity document (BlazeFace short range). */
export class PortraitDetector {
  private lastTs = 0;
  private closed = false;

  private constructor(private readonly detector: FaceDetector) {}

  static async create(opts: VisionOptions = {}): Promise<PortraitDetector> {
    assertVisionSupport();
    const timeout = opts.timeoutMs ?? 20000;
    try {
      const detector = await withTimeout((async () => {
        const vision = await loadModule(opts);
        const files = await fileset(vision, opts.wasmBaseUrl ?? DEFAULT_WASM_BASE_URL);
        return createWithFallback((delegate) => vision.FaceDetector.createFromOptions(files, {
          baseOptions: { modelAssetPath: opts.faceDetectorModelUrl ?? DEFAULT_FACE_DETECTOR_MODEL_URL, delegate },
          runningMode: 'VIDEO',
          minDetectionConfidence: 0.5,
        }), opts.delegate ?? 'GPU');
      })(), timeout);
      return new PortraitDetector(detector);
    } catch (e) {
      throw asLoadError(e);
    }
  }

  detect(source: HTMLVideoElement | HTMLCanvasElement | ImageBitmap, sourceWidth: number, sourceHeight: number,
         timestamp = performance.now()): PortraitObservation[] {
    if (this.closed || !sourceWidth || !sourceHeight) return [];
    const ts = Math.max(timestamp, this.lastTs + 1);
    this.lastTs = ts;
    const result = this.detector.detectForVideo(source, ts);
    return result.detections.flatMap((d: Detection) => {
      if (!d.boundingBox) return [];
      const b = d.boundingBox;
      return [{
        bbox: { x: b.originX / sourceWidth, y: b.originY / sourceHeight, width: b.width / sourceWidth, height: b.height / sourceHeight },
        score: d.categories[0]?.score ?? 0,
      }];
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    try {
      this.detector.close();
    } catch {
      /* already closed */
    }
  }
}

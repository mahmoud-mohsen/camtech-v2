// Analysis frame loop: samples the live video at a modest rate into a small reused canvas, so quality checks
// and face tracking stay cheap on mid-range phones.
import { rgbaToGray } from './quality';

export interface FrameSample {
  /** Downscaled grayscale frame (`width` × `height`). Reused between frames: copy it to keep it. */
  gray: Uint8ClampedArray;
  /** Downscaled RGBA frame. Reused between frames. */
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  /** Scale from video pixels to analysis pixels (analysis = video × scale). */
  scale: number;
  videoWidth: number;
  videoHeight: number;
  /** Monotonic timestamp in ms (performance.now()). */
  timestamp: number;
  video: HTMLVideoElement;
}

export interface FrameLoopOptions {
  video: HTMLVideoElement;
  /** Target analysis rate. Default 13 fps. */
  fps?: number;
  /** Width of the analysis frame. Default 320. */
  analysisWidth?: number;
  /** Called for each sampled frame. A returned promise holds the loop until it settles (frames are skipped meanwhile). */
  onFrame: (sample: FrameSample) => void | Promise<void>;
  onError?: (err: unknown) => void;
}

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function hasVideoFrameCallback(v: HTMLVideoElement): boolean {
  // Missing on older Firefox and Safari < 15.4 despite the DOM typings.
  return typeof (v as { requestVideoFrameCallback?: unknown }).requestVideoFrameCallback === 'function';
}

/** Creates a 2D canvas, preferring OffscreenCanvas (no DOM, cheaper readback). */
export function createAnalysisCanvas(width: number, height: number): { canvas: HTMLCanvasElement | OffscreenCanvas; ctx: Ctx2D } {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (ctx) return { canvas, ctx };
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is not available');
  return { canvas, ctx };
}

export class FrameLoop {
  private running = false;
  private busy = false;
  private handle: number | null = null;
  private usingVfc = false;
  private lastRun = 0;
  private canvas: HTMLCanvasElement | OffscreenCanvas | null = null;
  private ctx: Ctx2D | null = null;
  private gray: Uint8ClampedArray | null = null;
  private interval: number;
  private readonly analysisWidth: number;

  constructor(private readonly opts: FrameLoopOptions) {
    this.interval = 1000 / (opts.fps ?? 13);
    this.analysisWidth = opts.analysisWidth ?? 320;
  }

  /** Changes the analysis rate (e.g. faster while the user blinks). */
  setFps(fps: number): void {
    this.interval = 1000 / Math.max(1, Math.min(60, fps));
  }

  get isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule();
  }

  stop(): void {
    this.running = false;
    this.cancel();
  }

  /** Samples the current frame immediately (outside the loop). Returns null when the video has no frame yet. */
  sampleNow(): FrameSample | null {
    const video = this.opts.video;
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    if (!vw || !vh || video.readyState < 2) return null;
    const scale = Math.min(1, this.analysisWidth / vw);
    const w = Math.max(1, Math.round(vw * scale));
    const h = Math.max(1, Math.round(vh * scale));
    if (!this.canvas || !this.ctx || this.canvas.width !== w || this.canvas.height !== h) {
      const created = createAnalysisCanvas(w, h);
      this.canvas = created.canvas;
      this.ctx = created.ctx;
    }
    this.ctx.drawImage(video, 0, 0, w, h);
    const rgba = this.ctx.getImageData(0, 0, w, h).data;
    this.gray = rgbaToGray(rgba, this.gray ?? undefined);
    return {
      gray: this.gray, rgba, width: w, height: h, scale, videoWidth: vw, videoHeight: vh,
      timestamp: performance.now(), video,
    };
  }

  private schedule(): void {
    if (!this.running) return;
    const video = this.opts.video;
    if (hasVideoFrameCallback(video)) {
      this.usingVfc = true;
      this.handle = video.requestVideoFrameCallback(this.tick);
    } else {
      this.usingVfc = false;
      this.handle = requestAnimationFrame(this.tick);
    }
  }

  private cancel(): void {
    if (this.handle === null) return;
    const video = this.opts.video;
    if (this.usingVfc) video.cancelVideoFrameCallback(this.handle);
    else cancelAnimationFrame(this.handle);
    this.handle = null;
  }

  private readonly tick = (): void => {
    this.handle = null;
    if (!this.running) return;
    const now = performance.now();
    if (!this.busy && now - this.lastRun >= this.interval - 2) {
      this.lastRun = now;
      let sample: FrameSample | null = null;
      try {
        sample = this.sampleNow();
      } catch (e) {
        this.opts.onError?.(e);
      }
      if (sample) {
        try {
          const result = this.opts.onFrame(sample);
          if (result && typeof (result as Promise<void>).then === 'function') {
            this.busy = true;
            (result as Promise<void>).then(
              () => { this.busy = false; },
              (e: unknown) => { this.busy = false; this.opts.onError?.(e); },
            );
          }
        } catch (e) {
          this.opts.onError?.(e);
        }
      }
    }
    this.schedule();
  };
}

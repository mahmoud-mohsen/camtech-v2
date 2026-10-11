// Full-resolution capture: grab a video frame, crop, resize and encode JPEG under the upload limit.
import { edgeSharpness, rgbaToGray, type Rect } from './quality';

export const MAX_UPLOAD_BYTES = 2 * 1024 * 1024;

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyCtx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type DrawSource = HTMLVideoElement | HTMLCanvasElement | OffscreenCanvas | ImageBitmap | HTMLImageElement;

/** A DOM canvas when a document exists (best toBlob support), otherwise an OffscreenCanvas. */
export function createCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: AnyCtx } {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    return { canvas, ctx };
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    return { canvas, ctx };
  }
  throw new Error('Canvas is not available');
}

function sourceSize(src: DrawSource): { width: number; height: number } {
  if (typeof HTMLVideoElement !== 'undefined' && src instanceof HTMLVideoElement) {
    return { width: src.videoWidth, height: src.videoHeight };
  }
  if (typeof HTMLImageElement !== 'undefined' && src instanceof HTMLImageElement) {
    return { width: src.naturalWidth, height: src.naturalHeight };
  }
  return { width: src.width, height: src.height };
}

/** Encodes a canvas as JPEG. */
export function canvasToJpeg(canvas: AnyCanvas, quality: number): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/jpeg', quality });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the image'))),
      'image/jpeg',
      quality,
    );
  });
}

export interface EncodeOptions {
  maxBytes?: number;
  /** First JPEG quality tried. Default 0.9. */
  startQuality?: number;
  /** Lowest quality before downscaling. Default 0.6. */
  minQuality?: number;
}

/**
 * Encodes JPEG, lowering quality from `startQuality` to `minQuality` (step 0.05) until under `maxBytes`;
 * if still too big, downscales by 15% and repeats.
 */
export async function encodeUnderLimit(canvas: AnyCanvas, opts: EncodeOptions = {}): Promise<Blob> {
  const maxBytes = opts.maxBytes ?? MAX_UPLOAD_BYTES;
  const start = opts.startQuality ?? 0.9;
  const min = opts.minQuality ?? 0.6;
  let current: AnyCanvas = canvas;
  for (let round = 0; round < 6; round++) {
    let last: Blob | null = null;
    for (let q = start; q >= min - 1e-6; q -= 0.05) {
      last = await canvasToJpeg(current, Math.round(q * 100) / 100);
      if (last.size <= maxBytes) return last;
    }
    const scaled = createCanvas(current.width * 0.85, current.height * 0.85);
    scaled.ctx.imageSmoothingQuality = 'high';
    scaled.ctx.drawImage(current, 0, 0, scaled.canvas.width, scaled.canvas.height);
    current = scaled.canvas;
    if (round === 5 && last) return last;
  }
  return canvasToJpeg(current, min);
}

/** Output size so that the short side is within [minShort, maxShort] (upscales only up to minShort). */
export function fitShortSide(width: number, height: number, minShort: number, maxShort: number): { width: number; height: number } {
  const short = Math.min(width, height);
  if (!short) return { width, height };
  let scale = 1;
  if (short > maxShort) scale = maxShort / short;
  else if (short < minShort) scale = minShort / short;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Output size so that the width is within [minWidth, maxWidth]. */
export function fitWidth(width: number, height: number, minWidth: number, maxWidth: number): { width: number; height: number } {
  if (!width) return { width, height };
  let scale = 1;
  if (width > maxWidth) scale = maxWidth / width;
  else if (width < minWidth) scale = minWidth / width;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Draws `crop` of the source (source pixels; default the whole frame) into a canvas of `outW`×`outH`. */
export function drawFrame(src: DrawSource, crop: Rect | null, outW?: number, outH?: number): AnyCanvas {
  const size = sourceSize(src);
  const c = crop ?? { x: 0, y: 0, width: size.width, height: size.height };
  const w = outW ?? c.width;
  const h = outH ?? c.height;
  const { canvas, ctx } = createCanvas(w, h);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, c.x, c.y, c.width, c.height, 0, 0, canvas.width, canvas.height);
  return canvas;
}

/**
 * Holds a full-resolution copy of the best frame seen so far, without encoding it (drawImage is cheap,
 * JPEG encoding is not). Never mirrored.
 */
export class FrameHolder {
  private canvas: AnyCanvas | null = null;
  private ctx: AnyCtx | null = null;
  private filled = false;

  get hasFrame(): boolean {
    return this.filled;
  }

  get frame(): AnyCanvas | null {
    return this.filled ? this.canvas : null;
  }

  grab(src: DrawSource): boolean {
    const { width, height } = sourceSize(src);
    if (!width || !height) return false;
    if (!this.canvas || !this.ctx || this.canvas.width !== width || this.canvas.height !== height) {
      const created = createCanvas(width, height);
      this.canvas = created.canvas;
      this.ctx = created.ctx;
    }
    this.ctx.drawImage(src, 0, 0, width, height);
    this.filled = true;
    return true;
  }

  clear(): void {
    this.filled = false;
  }

  release(): void {
    this.filled = false;
    if (this.canvas) {
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
    this.canvas = null;
    this.ctx = null;
  }
}

/**
 * Measures how sharp the printed text is, from the full-resolution video rather than the small analysis frame
 * (where blurry text still looks sharp). The region is drawn at its native size, downscaled to `maxWidth` at
 * most, and scored with {@link edgeSharpness}.
 */
export class DetailProbe {
  private canvas: AnyCanvas | null = null;
  private ctx: AnyCtx | null = null;
  private gray: Uint8ClampedArray | undefined;

  constructor(private readonly maxWidth = 640) {}

  /** Edge sharpness of `region` (source pixels), or null when it cannot be measured. */
  measure(src: DrawSource, region: Rect): number | null {
    if (region.width < 16 || region.height < 16) return null;
    const scale = Math.min(1, this.maxWidth / region.width);
    const w = Math.max(1, Math.round(region.width * scale));
    const h = Math.max(1, Math.round(region.height * scale));
    try {
      if (!this.canvas || !this.ctx || this.canvas.width !== w || this.canvas.height !== h) {
        const created = createReadableCanvas(w, h);
        this.canvas = created.canvas;
        this.ctx = created.ctx;
      }
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = 'high';
      this.ctx.drawImage(src, region.x, region.y, region.width, region.height, 0, 0, w, h);
      this.gray = rgbaToGray(this.ctx.getImageData(0, 0, w, h).data, this.gray);
      return edgeSharpness(this.gray, w, h);
    } catch {
      return null;
    }
  }

  release(): void {
    if (this.canvas) {
      this.canvas.width = 1;
      this.canvas.height = 1;
    }
    this.canvas = null;
    this.ctx = null;
    this.gray = undefined;
  }
}

/** Like createCanvas, but tells the browser pixels are read back often (keeps the canvas on the CPU). */
function createReadableCanvas(width: number, height: number): { canvas: AnyCanvas; ctx: AnyCtx } {
  const opts: CanvasRenderingContext2DSettings = { willReadFrequently: true };
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', opts);
    if (ctx) return { canvas, ctx };
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', opts);
    if (ctx) return { canvas, ctx };
  }
  throw new Error('Canvas 2D is not available');
}

export interface CapturedImage {
  blob: Blob;
  width: number;
  height: number;
}

/** Selfie: whole frame, short side 720–1280, JPEG ~0.85, under 2 MB. */
export async function encodeSelfie(src: DrawSource, opts: EncodeOptions = {}): Promise<CapturedImage> {
  const size = sourceSize(src);
  const out = fitShortSide(size.width, size.height, 720, 1280);
  const canvas = drawFrame(src, null, out.width, out.height);
  const blob = await encodeUnderLimit(canvas, { startQuality: 0.85, ...opts });
  return { blob, width: canvas.width, height: canvas.height };
}

/**
 * Document: crop (source pixels), at most 2000 wide, under 2 MB. Never upscaled: enlarging a small webcam crop
 * adds no detail for OCR, only bytes.
 */
export async function encodeDocument(src: DrawSource, crop: Rect | null, opts: EncodeOptions = {}): Promise<CapturedImage> {
  const size = sourceSize(src);
  const c = crop ?? { x: 0, y: 0, width: size.width, height: size.height };
  const out = fitWidth(c.width, c.height, 0, 2000);
  const canvas = drawFrame(src, c, out.width, out.height);
  const blob = await encodeUnderLimit(canvas, { startQuality: 0.9, ...opts });
  return { blob, width: canvas.width, height: canvas.height };
}

export class ImageFileError extends Error {
  readonly code: 'NOT_AN_IMAGE' | 'UNREADABLE';

  constructor(code: 'NOT_AN_IMAGE' | 'UNREADABLE', message?: string) {
    super(message ?? code);
    this.name = 'ImageFileError';
    this.code = code;
  }
}

async function decodeWithImage(file: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Converts a gallery file to an upright JPEG (EXIF orientation applied), width 1200–2000 by default, under 2 MB.
 */
export async function fileToJpeg(file: Blob, opts: { minWidth?: number; maxWidth?: number } & EncodeOptions = {}):
  Promise<CapturedImage> {
  if (file.type && !file.type.startsWith('image/')) throw new ImageFileError('NOT_AN_IMAGE');
  let source: ImageBitmap | HTMLImageElement;
  try {
    source = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    try {
      // Browsers apply EXIF orientation to <img> by default (image-orientation: from-image).
      source = await decodeWithImage(file);
    } catch {
      throw new ImageFileError('UNREADABLE');
    }
  }
  try {
    const size = sourceSize(source);
    if (!size.width || !size.height) throw new ImageFileError('UNREADABLE');
    const out = fitWidth(size.width, size.height, opts.minWidth ?? 1200, opts.maxWidth ?? 2000);
    const canvas = drawFrame(source, null, out.width, out.height);
    const blob = await encodeUnderLimit(canvas, opts);
    return { blob, width: canvas.width, height: canvas.height };
  } finally {
    if ('close' in source && typeof source.close === 'function') source.close();
  }
}

/**
 * Small snapshots of the video for the active-liveness challenge (slot order = upload order), encoded at the end:
 * long side ≤ 640 px, JPEG ≈ 0.8, each under 1 MB, never mirrored.
 */
export class ChallengeSnapshots {
  private readonly slots = new Map<string, AnyCanvas>();

  constructor(private readonly maxLongSide = 640) {}

  get size(): number {
    return this.slots.size;
  }

  /** Copies the current frame into `slot` (replacing an earlier copy, keeping its position). */
  put(slot: string, src: DrawSource): boolean {
    const { width, height } = sourceSize(src);
    if (!width || !height) return false;
    const scale = Math.min(1, this.maxLongSide / Math.max(width, height));
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    let canvas = this.slots.get(slot);
    if (!canvas || canvas.width !== w || canvas.height !== h) canvas = createCanvas(w, h).canvas;
    const ctx = canvas.getContext('2d') as AnyCtx | null;
    if (!ctx) return false;
    ctx.drawImage(src, 0, 0, w, h);
    this.slots.set(slot, canvas);
    return true;
  }

  clear(): void {
    this.slots.clear();
  }

  /** JPEG blobs in slot order (at most `max`; the first frames are kept). */
  async encode(max = 10): Promise<Blob[]> {
    const out: Blob[] = [];
    for (const canvas of Array.from(this.slots.values()).slice(0, max)) {
      out.push(await encodeUnderLimit(canvas, { maxBytes: 1024 * 1024 - 1, startQuality: 0.8, minQuality: 0.6 }));
    }
    return out;
  }
}

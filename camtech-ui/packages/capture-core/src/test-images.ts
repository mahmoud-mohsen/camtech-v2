// Synthetic grayscale images for unit tests (not exported from the package).
import type { Rect } from './quality';

export interface TestImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export function solid(width: number, height: number, value: number): TestImage {
  return { data: new Uint8ClampedArray(width * height).fill(value), width, height };
}

/** Deterministic pseudo-random noise around `mean` (±amplitude). */
export function noise(width: number, height: number, mean: number, amplitude: number, seed = 1): TestImage {
  const data = new Uint8ClampedArray(width * height);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    data[i] = mean + ((s / 0x7fffffff) * 2 - 1) * amplitude;
  }
  return { data, width, height };
}

export function checkerboard(width: number, height: number, cell: number, a = 0, b = 255): TestImage {
  const data = new Uint8ClampedArray(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[y * width + x] = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 ? b : a;
    }
  }
  return { data, width, height };
}

export function fillRect(img: TestImage, r: Rect, value: number): TestImage {
  for (let y = Math.max(0, Math.round(r.y)); y < Math.min(img.height, Math.round(r.y + r.height)); y++) {
    for (let x = Math.max(0, Math.round(r.x)); x < Math.min(img.width, Math.round(r.x + r.width)); x++) {
      img.data[y * img.width + x] = value;
    }
  }
  return img;
}

/** 3×3 box blur, applied `passes` times. */
export function boxBlur(img: TestImage, passes = 1): TestImage {
  let src = img.data;
  const { width, height } = img;
  for (let p = 0; p < passes; p++) {
    const out = new Uint8ClampedArray(src.length);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let sum = 0;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            const yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= width || yy >= height) continue;
            sum += src[yy * width + xx];
            n++;
          }
        }
        out[y * width + x] = sum / n;
      }
    }
    src = out;
  }
  return { data: src, width, height };
}

/** Horizontal "text" stripes: alternating dark glyph-like runs on a light band. */
export function textBand(img: TestImage, r: Rect, glyph = 3, gap = 3): TestImage {
  for (let y = Math.round(r.y); y < Math.round(r.y + r.height); y++) {
    const lineIndex = Math.floor((y - r.y) / 6);
    const inLine = (y - r.y) % 6 < 4;
    for (let x = Math.round(r.x); x < Math.round(r.x + r.width); x++) {
      const dark = inLine && ((x + lineIndex) % (glyph + gap)) < glyph;
      img.data[y * img.width + x] = dark ? 30 : 220;
    }
  }
  return img;
}

// Pure image-quality measures on 8-bit grayscale buffers. No DOM access, so they run in tests and workers.
// Every function takes the buffer plus its width/height and an optional region of interest (pixels).

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Grayscale buffer with its size. */
export interface GrayImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

interface Bounds {
  x0: number;
  y0: number;
  x1: number; // exclusive
  y1: number; // exclusive
}

/** Clamps a rect to the image; an empty or missing rect means the whole image. */
export function clampRect(width: number, height: number, roi?: Rect | null): Bounds {
  if (!roi) return { x0: 0, y0: 0, x1: width, y1: height };
  const x0 = Math.max(0, Math.min(width, Math.floor(roi.x)));
  const y0 = Math.max(0, Math.min(height, Math.floor(roi.y)));
  const x1 = Math.max(x0, Math.min(width, Math.ceil(roi.x + roi.width)));
  const y1 = Math.max(y0, Math.min(height, Math.ceil(roi.y + roi.height)));
  return { x0, y0, x1, y1 };
}

/** ITU-R BT.601 luma of an RGBA buffer, written into `out` (reused when the size matches). */
export function rgbaToGray(rgba: Uint8ClampedArray, out?: Uint8ClampedArray): Uint8ClampedArray {
  const n = rgba.length >> 2;
  const gray = out && out.length === n ? out : new Uint8ClampedArray(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    // (77R + 150G + 29B) / 256 ≈ 0.299R + 0.587G + 0.114B
    gray[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return gray;
}

/** Mean luminance 0..255. */
export function meanLuminance(gray: Uint8ClampedArray, width: number, height: number, roi?: Rect | null): number {
  const b = clampRect(width, height, roi);
  let sum = 0;
  let count = 0;
  for (let y = b.y0; y < b.y1; y++) {
    const row = y * width;
    for (let x = b.x0; x < b.x1; x++) sum += gray[row + x];
    count += b.x1 - b.x0;
  }
  return count ? sum / count : 0;
}

/** Contrast as the standard deviation of luminance. */
export function contrast(gray: Uint8ClampedArray, width: number, height: number, roi?: Rect | null): number {
  const b = clampRect(width, height, roi);
  let sum = 0;
  let sq = 0;
  let count = 0;
  for (let y = b.y0; y < b.y1; y++) {
    const row = y * width;
    for (let x = b.x0; x < b.x1; x++) {
      const v = gray[row + x];
      sum += v;
      sq += v * v;
    }
    count += b.x1 - b.x0;
  }
  if (!count) return 0;
  const mean = sum / count;
  return Math.sqrt(Math.max(0, sq / count - mean * mean));
}

/** Fraction (0..1) of pixels at or above `threshold` (blown-out highlights). */
export function glareRatio(gray: Uint8ClampedArray, width: number, height: number, roi?: Rect | null,
                           threshold = 250): number {
  const b = clampRect(width, height, roi);
  let hot = 0;
  let count = 0;
  for (let y = b.y0; y < b.y1; y++) {
    const row = y * width;
    for (let x = b.x0; x < b.x1; x++) if (gray[row + x] >= threshold) hot++;
    count += b.x1 - b.x0;
  }
  return count ? hot / count : 0;
}

/**
 * Size of the largest connected (4-neighbour) blob of pixels ≥ threshold, as a fraction of the ROI area.
 * A single specular reflection on a card is one big blob, while bright paper texture is many small specks.
 */
export function largestGlareBlob(gray: Uint8ClampedArray, width: number, height: number, roi?: Rect | null,
                                 threshold = 250): number {
  const b = clampRect(width, height, roi);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  if (w <= 0 || h <= 0) return 0;
  const visited = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let largest = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = y * w + x;
      if (visited[idx] || gray[(y + b.y0) * width + x + b.x0] < threshold) continue;
      let top = 0;
      stack[top++] = idx;
      visited[idx] = 1;
      let size = 0;
      while (top > 0) {
        const cur = stack[--top];
        size++;
        const cx = cur % w;
        const cy = (cur - cx) / w;
        // left, right, up, down
        if (cx > 0) top = pushIfHot(cur - 1, cx - 1, cy, top);
        if (cx < w - 1) top = pushIfHot(cur + 1, cx + 1, cy, top);
        if (cy > 0) top = pushIfHot(cur - w, cx, cy - 1, top);
        if (cy < h - 1) top = pushIfHot(cur + w, cx, cy + 1, top);
      }
      if (size > largest) largest = size;
    }
  }
  return largest / (w * h);

  function pushIfHot(i: number, px: number, py: number, top: number): number {
    if (visited[i]) return top;
    if (gray[(py + b.y0) * width + px + b.x0] < threshold) return top;
    visited[i] = 1;
    stack[top] = i;
    return top + 1;
  }
}

/**
 * Sharpness as the variance of the 4-neighbour Laplacian. Higher is sharper; a blurry frame has a low value.
 * The value depends on resolution and content, so compare it against thresholds tuned for the analysis size.
 */
export function laplacianVariance(gray: Uint8ClampedArray, width: number, height: number, roi?: Rect | null): number {
  const b = clampRect(width, height, roi);
  const x0 = Math.max(1, b.x0);
  const y0 = Math.max(1, b.y0);
  const x1 = Math.min(width - 1, b.x1);
  const y1 = Math.min(height - 1, b.y1);
  let sum = 0;
  let sq = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    const row = y * width;
    for (let x = x0; x < x1; x++) {
      const i = row + x;
      const lap = gray[i - 1] + gray[i + 1] + gray[i - width] + gray[i + width] - 4 * gray[i];
      sum += lap;
      sq += lap * lap;
      count++;
    }
  }
  if (!count) return 0;
  const mean = sum / count;
  return Math.max(0, sq / count - mean * mean);
}

/** Mean absolute difference 0..255 between two frames of the same size (camera or subject motion). */
export function motionScore(gray: Uint8ClampedArray, previous: Uint8ClampedArray | null | undefined,
                            width: number, height: number, roi?: Rect | null): number {
  if (!previous || previous.length !== gray.length) return 0;
  const b = clampRect(width, height, roi);
  let sum = 0;
  let count = 0;
  // Every other pixel is plenty for a global motion estimate and halves the cost.
  for (let y = b.y0; y < b.y1; y += 2) {
    const row = y * width;
    for (let x = b.x0; x < b.x1; x += 2) {
      const i = row + x;
      sum += Math.abs(gray[i] - previous[i]);
      count++;
    }
  }
  return count ? sum / count : 0;
}

/** Sobel gradients of the whole image. Border pixels are 0. */
export interface SobelResult {
  gx: Int16Array;
  gy: Int16Array;
  magnitude: Float32Array;
}

export function sobel(gray: Uint8ClampedArray, width: number, height: number): SobelResult {
  const n = width * height;
  const gx = new Int16Array(n);
  const gy = new Int16Array(n);
  const magnitude = new Float32Array(n);
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = y * width + x;
      const tl = gray[i - width - 1];
      const t = gray[i - width];
      const tr = gray[i - width + 1];
      const l = gray[i - 1];
      const r = gray[i + 1];
      const bl = gray[i + width - 1];
      const bm = gray[i + width];
      const br = gray[i + width + 1];
      const sx = tr + 2 * r + br - tl - 2 * l - bl;
      const sy = bl + 2 * bm + br - tl - 2 * t - tr;
      gx[i] = sx;
      gy[i] = sy;
      magnitude[i] = Math.sqrt(sx * sx + sy * sy);
    }
  }
  return { gx, gy, magnitude };
}

/**
 * Edge steepness 0..1: the strongest Sobel gradients (98th percentile) relative to the contrast range
 * (2nd–98th luminance percentile). About 2 / edge width in pixels, so blur lowers it, while sensor noise
 * (weak gradients) and dim lighting (normalized away) do not change it much. Depends on scale: measure text
 * at a fixed size (see DetailProbe). 0 when the ROI has too little contrast to hold readable print.
 */
export function edgeSharpness(gray: Uint8ClampedArray, width: number, height: number, roi?: Rect | null): number {
  const b = clampRect(width, height, roi);
  const x0 = Math.max(1, b.x0);
  const y0 = Math.max(1, b.y0);
  const x1 = Math.min(width - 1, b.x1);
  const y1 = Math.min(height - 1, b.y1);
  const lum = new Uint32Array(256);
  const grad = new Uint32Array(1444);
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      const sx = gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1]
        - gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1];
      const sy = gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]
        - gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1];
      grad[Math.min(1443, Math.round(Math.sqrt(sx * sx + sy * sy)))]++;
      lum[gray[i]]++;
      count++;
    }
  }
  if (count < 64) return 0;
  const percentile = (hist: Uint32Array, p: number): number => {
    const target = count * p;
    let acc = 0;
    for (let v = 0; v < hist.length; v++) {
      acc += hist[v];
      if (acc >= target) return v;
    }
    return hist.length - 1;
  };
  const range = percentile(lum, 0.98) - percentile(lum, 0.02);
  if (range < 40) return 0;
  // A one-pixel step of height `range` gives a Sobel response of 4 × range.
  return Math.min(1, percentile(grad, 0.98) / (4 * range));
}

/** Mean Sobel edge magnitude inside the ROI (texture / "is there something here"). */
export function meanEdgeMagnitude(gray: Uint8ClampedArray, width: number, height: number, roi?: Rect | null): number {
  const b = clampRect(width, height, roi);
  const x0 = Math.max(1, b.x0);
  const y0 = Math.max(1, b.y0);
  const x1 = Math.min(width - 1, b.x1);
  const y1 = Math.min(height - 1, b.y1);
  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      const sx = gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1]
        - gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1];
      const sy = gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]
        - gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1];
      sum += Math.abs(sx) + Math.abs(sy);
      count++;
    }
  }
  return count ? sum / count : 0;
}

export interface EdgeAlignment {
  /** Fraction (0..1) of positions along each side where a strong edge runs parallel to it. */
  top: number;
  right: number;
  bottom: number;
  left: number;
  /** Mean of the four sides. */
  score: number;
  /** Number of sides with coverage ≥ `sideThreshold`. */
  sidesAligned: number;
}

export interface EdgeAlignmentOptions {
  /** Half-height of the band searched around each side, as a fraction of the rect's shorter side. Default 0.06. */
  band?: number;
  /** Minimum perpendicular gradient (Sobel units) counted as an edge. Default 60. */
  edgeThreshold?: number;
  /** Coverage needed for a side to count as aligned. Default 0.5. */
  sideThreshold?: number;
}

/**
 * How strongly edges run along the 4 sides of a guide rectangle. For each position along a side, the strongest
 * gradient perpendicular to that side inside a narrow band is compared with `edgeThreshold`. A document that
 * fills the guide gives high coverage on all four sides; an empty table or a card that is too small gives low values.
 */
export function edgeAlignment(gray: Uint8ClampedArray, width: number, height: number, rect: Rect,
                              opts: EdgeAlignmentOptions = {}): EdgeAlignment {
  const bandFrac = opts.band ?? 0.06;
  const threshold = opts.edgeThreshold ?? 60;
  const sideThreshold = opts.sideThreshold ?? 0.5;
  const band = Math.max(2, Math.round(Math.min(rect.width, rect.height) * bandFrac));
  const left = Math.round(rect.x);
  const top = Math.round(rect.y);
  const right = Math.round(rect.x + rect.width);
  const bottom = Math.round(rect.y + rect.height);

  const gyAt = (x: number, y: number): number => {
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return 0;
    const i = y * width + x;
    return Math.abs(gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]
      - gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1]);
  };
  const gxAt = (x: number, y: number): number => {
    if (x < 1 || y < 1 || x >= width - 1 || y >= height - 1) return 0;
    const i = y * width + x;
    return Math.abs(gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1]
      - gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1]);
  };

  // Ignore the rounded corners: sample the middle 80% of each side.
  const horizontal = (yc: number): number => {
    const xs = left + Math.round(rect.width * 0.1);
    const xe = right - Math.round(rect.width * 0.1);
    let hits = 0;
    let total = 0;
    for (let x = xs; x < xe; x += 2) {
      let best = 0;
      for (let y = yc - band; y <= yc + band; y++) best = Math.max(best, gyAt(x, y));
      if (best >= threshold) hits++;
      total++;
    }
    return total ? hits / total : 0;
  };
  const vertical = (xc: number): number => {
    const ys = top + Math.round(rect.height * 0.1);
    const ye = bottom - Math.round(rect.height * 0.1);
    let hits = 0;
    let total = 0;
    for (let y = ys; y < ye; y += 2) {
      let best = 0;
      for (let x = xc - band; x <= xc + band; x++) best = Math.max(best, gxAt(x, y));
      if (best >= threshold) hits++;
      total++;
    }
    return total ? hits / total : 0;
  };

  const result = { top: horizontal(top), bottom: horizontal(bottom), left: vertical(left), right: vertical(right) };
  const sides = [result.top, result.right, result.bottom, result.left];
  return {
    ...result,
    score: (result.top + result.right + result.bottom + result.left) / 4,
    sidesAligned: sides.filter((s) => s >= sideThreshold).length,
  };
}

export interface TextDensity {
  /** Dark/light transitions per pixel along rows (text gives 0.08–0.4, flat areas ≈ 0). */
  transitionsPerPx: number;
  /** Fraction of pixels darker than the local threshold (ink coverage). */
  inkRatio: number;
  /** Fraction of rows that contain text-like transitions. */
  rowCoverage: number;
}

/**
 * Text-likeness of a band (e.g. the passport MRZ zone): binarise with the band's mean minus a margin and count
 * transitions along each row. Machine-readable text gives many regular transitions on most rows.
 */
export function textDensity(gray: Uint8ClampedArray, width: number, height: number, rect: Rect): TextDensity {
  const b = clampRect(width, height, rect);
  const w = b.x1 - b.x0;
  const h = b.y1 - b.y0;
  if (w < 4 || h < 2) return { transitionsPerPx: 0, inkRatio: 0, rowCoverage: 0 };
  const mean = meanLuminance(gray, width, height, rect);
  const sd = contrast(gray, width, height, rect);
  const threshold = mean - Math.max(8, sd * 0.5);
  let transitions = 0;
  let ink = 0;
  let textRows = 0;
  for (let y = b.y0; y < b.y1; y++) {
    const row = y * width;
    let prevDark = gray[row + b.x0] < threshold;
    let rowTransitions = 0;
    for (let x = b.x0; x < b.x1; x++) {
      const dark = gray[row + x] < threshold;
      if (dark) ink++;
      if (dark !== prevDark) rowTransitions++;
      prevDark = dark;
    }
    transitions += rowTransitions;
    if (rowTransitions / w >= 0.04) textRows++;
  }
  return { transitionsPerPx: transitions / (w * h), inkRatio: ink / (w * h), rowCoverage: textRows / h };
}

/** Whether a band looks like printed machine-readable text. */
export function looksLikeText(d: TextDensity): boolean {
  return d.transitionsPerPx >= 0.03 && d.transitionsPerPx <= 0.6 && d.inkRatio >= 0.04 && d.inkRatio <= 0.6
    && d.rowCoverage >= 0.25;
}

/** Fraction (0..1) of pixels whose Sobel response |gx|+|gy| exceeds `threshold` (printed content, edges). */
export function edgeDensity(gray: Uint8ClampedArray, width: number, height: number, roi?: Rect | null,
                            threshold = 80): number {
  const b = clampRect(width, height, roi);
  const x0 = Math.max(1, b.x0);
  const y0 = Math.max(1, b.y0);
  const x1 = Math.min(width - 1, b.x1);
  const y1 = Math.min(height - 1, b.y1);
  let strong = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      const sx = gray[i - width + 1] + 2 * gray[i + 1] + gray[i + width + 1]
        - gray[i - width - 1] - 2 * gray[i - 1] - gray[i + width - 1];
      const sy = gray[i + width - 1] + 2 * gray[i + width] + gray[i + width + 1]
        - gray[i - width - 1] - 2 * gray[i - width] - gray[i - width + 1];
      if (Math.abs(sx) + Math.abs(sy) > threshold) strong++;
      count++;
    }
  }
  return count ? strong / count : 0;
}

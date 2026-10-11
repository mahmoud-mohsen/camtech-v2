import { describe, expect, it } from 'vitest';
import {
  clampRect, contrast, edgeAlignment, glareRatio, laplacianVariance, largestGlareBlob, looksLikeText,
  edgeDensity, meanEdgeMagnitude, meanLuminance, motionScore, rgbaToGray, sobel, textDensity,
} from './quality';
import { boxBlur, checkerboard, fillRect, noise, solid, textBand } from './test-images';

describe('rgbaToGray', () => {
  it('converts with BT.601 weights and reuses the output buffer', () => {
    const rgba = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
    const out = new Uint8ClampedArray(4);
    const gray = rgbaToGray(rgba, out);
    expect(gray).toBe(out);
    expect(gray[0]).toBeGreaterThanOrEqual(254);
    expect(gray[1]).toBe(0);
    expect(gray[2]).toBeCloseTo(76, -1);
    expect(gray[3]).toBeCloseTo(149, -1);
  });

  it('allocates when the buffer size differs', () => {
    const gray = rgbaToGray(new Uint8ClampedArray(8), new Uint8ClampedArray(1));
    expect(gray.length).toBe(2);
  });
});

describe('clampRect', () => {
  it('defaults to the whole image and clamps out-of-range rects', () => {
    expect(clampRect(10, 8)).toEqual({ x0: 0, y0: 0, x1: 10, y1: 8 });
    expect(clampRect(10, 8, { x: -5, y: 2, width: 100, height: 3 })).toEqual({ x0: 0, y0: 2, x1: 10, y1: 5 });
    expect(clampRect(10, 8, { x: 20, y: 20, width: 5, height: 5 })).toEqual({ x0: 10, y0: 8, x1: 10, y1: 8 });
  });
});

describe('meanLuminance / contrast', () => {
  it('measures a flat image', () => {
    const img = solid(20, 10, 100);
    expect(meanLuminance(img.data, img.width, img.height)).toBe(100);
    expect(contrast(img.data, img.width, img.height)).toBe(0);
  });

  it('measures a half-black half-white image and respects the ROI', () => {
    const img = fillRect(solid(20, 10, 0), { x: 10, y: 0, width: 10, height: 10 }, 200);
    expect(meanLuminance(img.data, 20, 10)).toBe(100);
    expect(contrast(img.data, 20, 10)).toBeCloseTo(100, 5);
    expect(meanLuminance(img.data, 20, 10, { x: 10, y: 0, width: 10, height: 10 })).toBe(200);
  });

  it('returns 0 for an empty ROI', () => {
    const img = solid(4, 4, 50);
    expect(meanLuminance(img.data, 4, 4, { x: 10, y: 10, width: 2, height: 2 })).toBe(0);
  });
});

describe('glare', () => {
  it('measures the fraction of blown-out pixels', () => {
    const img = fillRect(solid(10, 10, 120), { x: 0, y: 0, width: 5, height: 2 }, 255);
    expect(glareRatio(img.data, 10, 10)).toBeCloseTo(0.1);
    expect(glareRatio(img.data, 10, 10, null, 256)).toBe(0);
  });

  it('finds the largest connected blob, not scattered specks', () => {
    const specks = solid(40, 40, 100);
    for (let i = 0; i < 40 * 40; i += 7) specks.data[i] = 255;
    const blob = fillRect(solid(40, 40, 100), { x: 5, y: 5, width: 10, height: 8 }, 255);
    expect(largestGlareBlob(blob.data, 40, 40)).toBeCloseTo(80 / 1600);
    expect(largestGlareBlob(specks.data, 40, 40)).toBeLessThan(0.002);
    expect(glareRatio(specks.data, 40, 40)).toBeGreaterThan(0.1);
  });

  it('limits the blob search to the ROI', () => {
    const img = fillRect(solid(40, 40, 100), { x: 0, y: 0, width: 10, height: 10 }, 255);
    expect(largestGlareBlob(img.data, 40, 40, { x: 20, y: 20, width: 20, height: 20 })).toBe(0);
    expect(largestGlareBlob(img.data, 40, 40, { x: 0, y: 0, width: 20, height: 20 })).toBeCloseTo(100 / 400);
  });
});

describe('laplacianVariance (blur)', () => {
  it('is zero for a flat image and high for a sharp pattern', () => {
    const flat = solid(32, 32, 128);
    const sharp = checkerboard(32, 32, 2);
    expect(laplacianVariance(flat.data, 32, 32)).toBe(0);
    expect(laplacianVariance(sharp.data, 32, 32)).toBeGreaterThan(10000);
  });

  it('drops when the same image is blurred', () => {
    const sharp = checkerboard(64, 64, 4, 40, 220);
    const blurred = boxBlur(sharp, 3);
    const s = laplacianVariance(sharp.data, 64, 64);
    const b = laplacianVariance(blurred.data, 64, 64);
    expect(b).toBeLessThan(s / 5);
  });
});

describe('motionScore', () => {
  it('is 0 for identical frames or no previous frame', () => {
    const a = noise(30, 30, 128, 50);
    expect(motionScore(a.data, a.data, 30, 30)).toBe(0);
    expect(motionScore(a.data, null, 30, 30)).toBe(0);
    expect(motionScore(a.data, new Uint8ClampedArray(3), 30, 30)).toBe(0);
  });

  it('measures the mean absolute difference', () => {
    const a = solid(30, 30, 100);
    const b = solid(30, 30, 110);
    expect(motionScore(b.data, a.data, 30, 30)).toBe(10);
  });
});

describe('sobel', () => {
  it('responds to a vertical edge horizontally only', () => {
    const img = fillRect(solid(10, 10, 0), { x: 5, y: 0, width: 5, height: 10 }, 100);
    const { gx, gy, magnitude } = sobel(img.data, 10, 10);
    const i = 5 * 10 + 5;
    expect(Math.abs(gx[i])).toBe(400);
    expect(gy[i]).toBe(0);
    expect(magnitude[i]).toBe(400);
    expect(magnitude[0]).toBe(0);
  });

  it('meanEdgeMagnitude is higher with texture', () => {
    const flat = solid(20, 20, 90);
    const tex = checkerboard(20, 20, 2);
    expect(meanEdgeMagnitude(flat.data, 20, 20)).toBe(0);
    expect(meanEdgeMagnitude(tex.data, 20, 20)).toBeGreaterThan(100);
  });
});

describe('edgeAlignment', () => {
  const W = 200;
  const H = 150;
  const guide = { x: 20, y: 25, width: 160, height: 100 };

  it('scores a card that fills the guide on all four sides', () => {
    const img = fillRect(noise(W, H, 60, 8), guide, 210);
    const a = edgeAlignment(img.data, W, H, guide);
    expect(a.sidesAligned).toBe(4);
    expect(a.score).toBeGreaterThan(0.9);
  });

  it('tolerates a few pixels of misalignment within the band', () => {
    const img = fillRect(noise(W, H, 60, 8), { x: 23, y: 27, width: 155, height: 97 }, 210);
    expect(edgeAlignment(img.data, W, H, guide).sidesAligned).toBe(4);
  });

  it('is low for an empty scene and for a card that is too small', () => {
    const empty = noise(W, H, 60, 8);
    expect(edgeAlignment(empty.data, W, H, guide).score).toBeLessThan(0.1);
    const small = fillRect(noise(W, H, 60, 8), { x: 60, y: 50, width: 80, height: 50 }, 210);
    const a = edgeAlignment(small.data, W, H, guide);
    expect(a.sidesAligned).toBe(0);
  });

  it('counts only the sides that have an edge', () => {
    // Card shifted right: its left edge is inside the guide, right edge outside the image.
    const img = fillRect(noise(W, H, 60, 8), { x: 70, y: 25, width: 200, height: 100 }, 210);
    const a = edgeAlignment(img.data, W, H, guide);
    expect(a.left).toBeLessThan(0.2);
    expect(a.top).toBeGreaterThan(0.5);
    expect(a.sidesAligned).toBeLessThan(4);
  });
});

describe('textDensity', () => {
  it('recognises a text band and rejects flat or noisy areas', () => {
    const W = 200;
    const H = 60;
    const band = { x: 10, y: 10, width: 180, height: 40 };
    const text = textBand(solid(W, H, 220), band);
    const flat = solid(W, H, 220);
    const d = textDensity(text.data, W, H, band);
    expect(looksLikeText(d)).toBe(true);
    expect(looksLikeText(textDensity(flat.data, W, H, band))).toBe(false);
  });

  it('handles degenerate rects', () => {
    const img = solid(10, 10, 100);
    expect(textDensity(img.data, 10, 10, { x: 0, y: 0, width: 2, height: 1 })).toEqual({
      transitionsPerPx: 0, inkRatio: 0, rowCoverage: 0,
    });
  });
});

describe('edgeDensity', () => {
  it('is near zero for sensor noise and high for printed content', () => {
    const W = 60;
    const H = 40;
    expect(edgeDensity(noise(W, H, 70, 3).data, W, H)).toBeLessThan(0.01);
    expect(edgeDensity(textBand(solid(W, H, 220), { x: 0, y: 0, width: W, height: H }).data, W, H)).toBeGreaterThan(0.3);
  });
});

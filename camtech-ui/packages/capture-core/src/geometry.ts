import type { Rect } from './quality';

/**
 * How a video of `videoW`×`videoH` is drawn into a `viewW`×`viewH` box with `object-fit: cover`:
 * scaled by `scale` and shifted by (`offsetX`, `offsetY`) (negative = cropped on that side).
 */
export interface CoverTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

export function coverTransform(videoW: number, videoH: number, viewW: number, viewH: number): CoverTransform {
  if (videoW <= 0 || videoH <= 0 || viewW <= 0 || viewH <= 0) return { scale: 1, offsetX: 0, offsetY: 0 };
  const scale = Math.max(viewW / videoW, viewH / videoH);
  return { scale, offsetX: (viewW - videoW * scale) / 2, offsetY: (viewH - videoH * scale) / 2 };
}

/**
 * Maps a rect in preview (view) coordinates to video pixel coordinates, for an `object-fit: cover` preview.
 * When the preview is mirrored (front camera), the rect is mirrored back so the crop matches what the user saw.
 */
export function viewRectToVideoRect(rect: Rect, viewW: number, viewH: number, videoW: number, videoH: number,
                                    mirrored = false): Rect {
  const t = coverTransform(videoW, videoH, viewW, viewH);
  const x = mirrored ? viewW - (rect.x + rect.width) : rect.x;
  const out = {
    x: (x - t.offsetX) / t.scale,
    y: (rect.y - t.offsetY) / t.scale,
    width: rect.width / t.scale,
    height: rect.height / t.scale,
  };
  return clampToBounds(out, videoW, videoH);
}

/** The part of the video that is visible in the preview, in video pixels. */
export function visibleVideoRect(viewW: number, viewH: number, videoW: number, videoH: number): Rect {
  return viewRectToVideoRect({ x: 0, y: 0, width: viewW, height: viewH }, viewW, viewH, videoW, videoH);
}

/** Grows a rect by `margin` (fraction of its size) on every side, clamped to the bounds. */
export function expandRect(rect: Rect, margin: number, boundsW: number, boundsH: number): Rect {
  const dx = rect.width * margin;
  const dy = rect.height * margin;
  return clampToBounds({ x: rect.x - dx, y: rect.y - dy, width: rect.width + 2 * dx, height: rect.height + 2 * dy },
    boundsW, boundsH);
}

/** Scales a rect from one image size to another (e.g. video pixels to the downscaled analysis frame). */
export function scaleRect(rect: Rect, sx: number, sy: number = sx): Rect {
  return { x: rect.x * sx, y: rect.y * sy, width: rect.width * sx, height: rect.height * sy };
}

/** Shrinks a rect around its centre by `factor` (0.8 = 80% of the size). */
export function insetRect(rect: Rect, factor: number): Rect {
  const w = rect.width * factor;
  const h = rect.height * factor;
  return { x: rect.x + (rect.width - w) / 2, y: rect.y + (rect.height - h) / 2, width: w, height: h };
}

export function clampToBounds(rect: Rect, boundsW: number, boundsH: number): Rect {
  const x = Math.max(0, Math.min(boundsW, rect.x));
  const y = Math.max(0, Math.min(boundsH, rect.y));
  const x2 = Math.max(x, Math.min(boundsW, rect.x + rect.width));
  const y2 = Math.max(y, Math.min(boundsH, rect.y + rect.height));
  return { x, y, width: x2 - x, height: y2 - y };
}

export function rectContainsPoint(rect: Rect, px: number, py: number): boolean {
  return px >= rect.x && px <= rect.x + rect.width && py >= rect.y && py <= rect.y + rect.height;
}

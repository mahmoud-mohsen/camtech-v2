// Guidance for document capture: the document must fill the guide frame, be sharp, evenly lit, still and,
// for identity documents, show a portrait photo (and the MRZ for passports).
import type { PortraitObservation } from './face';
import { insetRect } from './geometry';
import {
  contrast, edgeAlignment, edgeDensity, glareRatio, laplacianVariance, largestGlareBlob, looksLikeText, meanLuminance,
  motionScore, textDensity, type EdgeAlignment, type Rect, type TextDensity,
} from './quality';

/** Physical layout of the document: ID-1 card (Emirates ID), TD3 passport data page, A4 portrait page. */
export type DocumentKind = 'ID_CARD' | 'PASSPORT' | 'A4';

/** Width / height of each document kind. */
export const DOCUMENT_ASPECT: Record<DocumentKind, number> = {
  ID_CARD: 1.586,
  PASSPORT: 1.42,
  A4: 0.707,
};

/** Fraction of the passport data page height occupied by the MRZ (bottom band). */
export const MRZ_BAND = 0.2;

export type DocumentHint =
  | 'NO_DOCUMENT'
  | 'ALIGN_DOCUMENT'
  | 'MOVE_CLOSER'
  | 'GLARE'
  | 'TOO_DARK'
  | 'TOO_BRIGHT'
  | 'LOW_CONTRAST'
  | 'BLURRY'
  | 'HOLD_STILL'
  | 'NO_PORTRAIT'
  | 'GOOD';

export interface GuideOptions {
  /** Max guide width as a fraction of the view width. Default 0.9. */
  maxWidth?: number;
  /** Max guide height as a fraction of the view height. Default 0.72 (0.8 for A4). */
  maxHeight?: number;
}

/** The guide frame, in view pixels, centred in a `viewW`×`viewH` preview. */
export function documentGuideRect(kind: DocumentKind, viewW: number, viewH: number, opts: GuideOptions = {}): Rect {
  const aspect = DOCUMENT_ASPECT[kind];
  const maxW = viewW * (opts.maxWidth ?? 0.9);
  const maxH = viewH * (opts.maxHeight ?? (kind === 'A4' ? 0.8 : 0.72));
  let width = maxW;
  let height = width / aspect;
  if (height > maxH) {
    height = maxH;
    width = height * aspect;
  }
  return { x: (viewW - width) / 2, y: (viewH - height) / 2, width, height };
}

export interface DocumentThresholds {
  /** Mean edge coverage along the guide sides. */
  minAlignment: number;
  /** Sides (out of 4) that must show an edge. */
  minSidesAligned: number;
  /** Below this edge density inside the guide there is nothing to read. */
  minContent: number;
  minBrightness: number;
  /** Above this mean luminance the card is washed out (screen glow, direct light). */
  maxBrightness: number;
  /** Luminance standard deviation inside the document; below it the print is too faint to read. */
  minContrast: number;
  /** Largest glare blob, fraction of the guide area. */
  maxGlareBlob: number;
  /** Total blown-out fraction of the guide. */
  maxGlareRatio: number;
  minSharpness: number;
  /** Edge sharpness of the text measured on the full-resolution video (see DetailProbe). */
  minDetailSharpness: number;
  maxMotion: number;
  stableMs: number;
  hintDebounceMs: number;
  /** A portrait detection stays valid this long (the detector runs at a lower rate). */
  portraitTtlMs: number;
}

export const DEFAULT_DOCUMENT_THRESHOLDS: DocumentThresholds = {
  minAlignment: 0.5,
  minSidesAligned: 3,
  minContent: 0.01,
  minBrightness: 60,
  maxBrightness: 230,
  minContrast: 25,
  maxGlareBlob: 0.004,
  maxGlareRatio: 0.02,
  minSharpness: 35,
  minDetailSharpness: 0.35,
  maxMotion: 4,
  stableMs: 800,
  hintDebounceMs: 250,
  portraitTtlMs: 1000,
};

export interface DocumentRequirements {
  /** A face photo must be visible inside the guide (Emirates ID front, passport). */
  portrait: boolean;
  /** The MRZ band must contain text (passport). */
  mrz: boolean;
}

export interface DocumentFrameInput {
  timestamp: number;
  /** Analysis frame (grayscale). */
  gray: Uint8ClampedArray;
  width: number;
  height: number;
  /** Guide frame in analysis-frame pixels. */
  guide: Rect;
  /**
   * Portrait detections of this frame, normalized to the analysis frame. `undefined`: detector not run on this
   * frame (the last result is reused). `null`: no detector available (the check is skipped).
   */
  portraits?: PortraitObservation[] | null;
  deviceSteady?: boolean;
  /**
   * Measures the text sharpness on the full-resolution frame. Called only when every other check passes
   * (it is the expensive one); null when it cannot be measured.
   */
  detail?: () => number | null;
}

export interface DocumentMetrics {
  alignment: EdgeAlignment;
  innerAlignment: number;
  content: number;
  brightness: number;
  glareRatio: number;
  glareBlob: number;
  contrast: number;
  sharpness: number;
  /** Full-resolution text sharpness; null when not measured. */
  detail: number | null;
  motion: number;
  portrait: boolean | null;
  mrz: TextDensity | null;
}

/** Measures one frame (pure). */
export function measureDocumentFrame(gray: Uint8ClampedArray, width: number, height: number, guide: Rect,
                                     previous: Uint8ClampedArray | null, mrz: boolean): Omit<DocumentMetrics, 'portrait' | 'detail'> {
  const alignment = edgeAlignment(gray, width, height, guide);
  // A document that is too small shows its edges inside the guide instead of on it.
  const inner = Math.max(
    edgeAlignment(gray, width, height, insetRect(guide, 0.82)).score,
    edgeAlignment(gray, width, height, insetRect(guide, 0.7)).score,
    edgeAlignment(gray, width, height, insetRect(guide, 0.58)).score,
  );
  const inside = insetRect(guide, 0.9);
  return {
    alignment,
    innerAlignment: inner,
    content: edgeDensity(gray, width, height, inside),
    brightness: meanLuminance(gray, width, height, guide),
    contrast: contrast(gray, width, height, inside),
    glareRatio: glareRatio(gray, width, height, guide, 245),
    glareBlob: largestGlareBlob(gray, width, height, guide, 245),
    sharpness: laplacianVariance(gray, width, height, inside),
    motion: motionScore(gray, previous, width, height, guide),
    mrz: mrz ? textDensity(gray, width, height, {
      x: guide.x + guide.width * 0.03,
      y: guide.y + guide.height * (1 - MRZ_BAND),
      width: guide.width * 0.94,
      height: guide.height * MRZ_BAND * 0.92,
    }) : null,
  };
}

/** Turns metrics into a hint, in priority order (pure). */
export function documentHint(m: DocumentMetrics, kind: DocumentKind, req: DocumentRequirements,
                             t: DocumentThresholds = DEFAULT_DOCUMENT_THRESHOLDS,
                             failing: Partial<Record<DocumentHint, boolean>> = {}): DocumentHint {
  const minSides = kind === 'A4' ? Math.min(2, t.minSidesAligned) : t.minSidesAligned;
  const minAlign = kind === 'A4' ? t.minAlignment * 0.8 : t.minAlignment;
  const hyst = (h: DocumentHint, v: number): number => (failing[h] ? v : 0);

  if (m.brightness < t.minBrightness + hyst('TOO_DARK', 8)) return 'TOO_DARK';
  if (m.brightness > t.maxBrightness - hyst('TOO_BRIGHT', 8)) return 'TOO_BRIGHT';
  const aligned = m.alignment.sidesAligned >= minSides && m.alignment.score >= minAlign + hyst('ALIGN_DOCUMENT', 0.05);
  if (!aligned) {
    if (m.content < t.minContent && m.alignment.score < 0.2 && m.innerAlignment < 0.3) return 'NO_DOCUMENT';
    if (m.innerAlignment >= minAlign && m.innerAlignment > m.alignment.score + 0.15) return 'MOVE_CLOSER';
    return 'ALIGN_DOCUMENT';
  }
  if (m.glareBlob > t.maxGlareBlob || m.glareRatio > t.maxGlareRatio) return 'GLARE';
  if (m.contrast < t.minContrast + hyst('LOW_CONTRAST', 4)) return 'LOW_CONTRAST';
  if (m.motion > t.maxMotion - hyst('HOLD_STILL', 1)) return 'HOLD_STILL';
  if (m.sharpness < t.minSharpness + hyst('BLURRY', 5)) return 'BLURRY';
  if (m.detail !== null && m.detail < t.minDetailSharpness + hyst('BLURRY', 0.02)) return 'BLURRY';
  if (req.mrz && m.mrz && !looksLikeText(m.mrz)) return 'ALIGN_DOCUMENT';
  if (req.portrait && m.portrait === false) return 'NO_PORTRAIT';
  return 'GOOD';
}

export interface DocumentGuidance {
  hint: DocumentHint;
  rawHint: DocumentHint;
  /** 0..1 progress of the stable window. */
  progress: number;
  ready: boolean;
  /** Sharpest good frame so far in the stable window: keep a full-resolution copy. */
  keepFrame: boolean;
  /** The stable window completed: the kept frame is the photo. */
  shot: boolean;
  metrics: DocumentMetrics;
}

export class DocumentAnalyzer {
  private readonly t: DocumentThresholds;
  private previous: Uint8ClampedArray | null = null;
  private failing: Partial<Record<DocumentHint, boolean>> = {};
  private stableSince: number | null = null;
  private bestSharpness = -1;
  private shownHint: DocumentHint | null = null;
  private candidate: DocumentHint | null = null;
  private candidateSince = 0;
  private portraitSeenAt: number | null = null;
  private portraitCheckedAt: number | null = null;
  private done = false;

  constructor(private readonly kind: DocumentKind, private readonly req: DocumentRequirements,
              thresholds: Partial<DocumentThresholds> = {}) {
    this.t = { ...DEFAULT_DOCUMENT_THRESHOLDS, ...thresholds };
  }

  reset(): void {
    this.previous = null;
    this.failing = {};
    this.stableSince = null;
    this.bestSharpness = -1;
    this.shownHint = null;
    this.candidate = null;
    this.portraitSeenAt = null;
    this.portraitCheckedAt = null;
    this.done = false;
  }

  update(input: DocumentFrameInput): DocumentGuidance {
    const now = input.timestamp;
    const base = measureDocumentFrame(input.gray, input.width, input.height, input.guide, this.previous, this.req.mrz);
    if (!this.previous || this.previous.length !== input.gray.length) this.previous = new Uint8ClampedArray(input.gray.length);
    this.previous.set(input.gray);

    let portrait: boolean | null = null;
    if (this.req.portrait && input.portraits !== null) {
      if (input.portraits !== undefined) {
        this.portraitCheckedAt = now;
        const g = input.guide;
        const found = input.portraits.some((p) => {
          const cx = (p.bbox.x + p.bbox.width / 2) * input.width;
          const cy = (p.bbox.y + p.bbox.height / 2) * input.height;
          return cx >= g.x && cx <= g.x + g.width && cy >= g.y && cy <= g.y + g.height;
        });
        if (found) this.portraitSeenAt = now;
      }
      if (this.portraitCheckedAt === null) portrait = null; // detector has not run yet
      else portrait = this.portraitSeenAt !== null && now - this.portraitSeenAt <= this.t.portraitTtlMs;
    }
    const metrics: DocumentMetrics = { ...base, portrait, detail: null };

    let raw = documentHint(metrics, this.kind, this.req, this.t, this.failing);
    if (raw === 'GOOD' && input.detail) {
      metrics.detail = input.detail();
      raw = documentHint(metrics, this.kind, this.req, this.t, this.failing);
    }
    if (raw === 'GOOD' && input.deviceSteady === false) raw = 'HOLD_STILL';
    this.failing = raw === 'GOOD' ? {} : { [raw]: true };

    let keepFrame = false;
    let shot = false;
    if (this.done) {
      return { hint: 'GOOD', rawHint: raw, progress: 1, ready: true, keepFrame: false, shot: false, metrics };
    }
    if (raw === 'GOOD') {
      this.stableSince ??= now;
      // Prefer the full-resolution text sharpness: on the small analysis frame every steady frame looks alike.
      const score = metrics.detail ?? metrics.sharpness;
      if (score > this.bestSharpness) {
        this.bestSharpness = score;
        keepFrame = true;
      }
      if (now - this.stableSince >= this.t.stableMs) {
        shot = true;
        this.done = true;
      }
    } else {
      this.stableSince = null;
      this.bestSharpness = -1;
    }
    const progress = this.stableSince === null ? 0 : Math.min(1, (now - this.stableSince) / this.t.stableMs);
    return { hint: this.debounce(raw, now), rawHint: raw, progress, ready: raw === 'GOOD', keepFrame, shot, metrics };
  }

  private debounce(raw: DocumentHint, now: number): DocumentHint {
    if (this.shownHint === null || raw === this.shownHint) {
      this.shownHint = raw;
      this.candidate = raw;
      return raw;
    }
    if (raw !== this.candidate) {
      this.candidate = raw;
      this.candidateSince = now;
    }
    if (now - this.candidateSince >= this.t.hintDebounceMs) this.shownHint = raw;
    return this.shownHint;
  }
}

/**
 * Where the small print is, as a part of the guide (same pixels as `guide`): the text block right of the photo on
 * an ID card, the MRZ on a passport, the body of an A4 page. Its sharpness decides whether OCR can read it.
 */
export function documentDetailRegion(kind: DocumentKind, guide: Rect): Rect {
  const part = kind === 'PASSPORT' ? { x: 0.03, y: 1 - MRZ_BAND, w: 0.94, h: MRZ_BAND * 0.95 }
    : kind === 'A4' ? { x: 0.08, y: 0.1, w: 0.84, h: 0.8 }
      : { x: 0.33, y: 0.25, w: 0.62, h: 0.68 };
  return {
    x: guide.x + guide.width * part.x,
    y: guide.y + guide.height * part.y,
    width: guide.width * part.w,
    height: guide.height * part.h,
  };
}

/** Document kind for an API document type. */
export function documentKindOf(type: string): DocumentKind {
  if (type.startsWith('PASSPORT')) return 'PASSPORT';
  if (type.startsWith('TRADE_LICENCE')) return 'A4';
  return 'ID_CARD';
}

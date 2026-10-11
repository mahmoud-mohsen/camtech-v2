// Presentational camera stages (also used by the static preview with an illustration instead of video).
import type { CSSProperties, ReactElement, ReactNode } from 'react';
import { documentGuideRect, MRZ_BAND, type ChallengeAction, type DocumentKind, type Rect, type SelfiePhase } from '@camtech/capture-core';
import type { Size } from '../components/hooks';

export const CLOSER_SCALE = 1.22;

/** Oval size for the normal selfie, in stage pixels (the MOVE_CLOSER oval is this × CLOSER_SCALE). */
export function ovalSize(stage: Size): { width: number; height: number } {
  if (!stage.width || !stage.height) return { width: 0, height: 0 };
  let h = stage.height * 0.54;
  let w = h * 0.76;
  const maxW = stage.width * 0.66;
  if (w > maxW) {
    w = maxW;
    h = w / 0.76;
  }
  return { width: w, height: h };
}

export interface LivenessStageProps {
  stageRef: (el: HTMLDivElement | null) => void;
  stage: Size;
  videoRef?: (el: HTMLVideoElement | null) => void;
  mirrored: boolean;
  phase: SelfiePhase | 'CHALLENGE';
  /** The MOVE_CLOSER challenge is running: show the bigger oval. */
  closer?: boolean;
  progress: number;
  ready: boolean;
  hintText: string | null;
  loading: boolean;
  loadingText: string;
  flashKey: number;
  videoLabel: string;
  /** Rendered instead of the video (preview mode). */
  illustration?: ReactNode;
  children?: ReactNode;
}

export function LivenessStage(p: LivenessStageProps): ReactElement {
  const oval = ovalSize(p.stage);
  const scale = p.closer || p.phase === 'CLOSER' ? CLOSER_SCALE : 1;
  const ovalStyle: CSSProperties = {
    width: oval.width,
    height: oval.height,
    transform: `translate(-50%, -50%) scale(${scale})`,
  };
  const rx = oval.width / 2;
  const ry = oval.height / 2;
  return (
    <div className="ct-stage ct-stage--selfie" ref={p.stageRef}>
      {p.illustration ?? (
        <video ref={p.videoRef} className={`ct-video${p.mirrored ? ' ct-video--mirrored' : ''}`} autoPlay muted playsInline
               aria-label={p.videoLabel} />
      )}
      {oval.width > 0 && (
        <div className={`ct-oval${p.ready ? ' ct-oval--ready' : ''}`} style={ovalStyle} aria-hidden="true">
          <svg className="ct-oval__ring" viewBox={`0 0 ${oval.width + 12} ${oval.height + 12}`} width={oval.width + 12} height={oval.height + 12}>
            <ellipse cx={rx + 6} cy={ry + 6} rx={rx + 2} ry={ry + 2} className="ct-oval__track" pathLength={100} />
            {/* A path (not a rotated ellipse, which would turn sideways) so the arc starts at the top and runs clockwise. */}
            <path d={`M${rx + 6} 4 A${rx + 2} ${ry + 2} 0 1 1 ${rx + 6} ${2 * ry + 8} A${rx + 2} ${ry + 2} 0 1 1 ${rx + 6} 4`}
                  className="ct-oval__progress" pathLength={100}
                  strokeDasharray="100" strokeDashoffset={100 - Math.max(0, Math.min(1, p.progress)) * 100} />
          </svg>
          {p.ready && <span className="ct-oval__pulse" />}
        </div>
      )}
      {p.hintText && <div key={p.hintText} className={`ct-hint${p.ready ? ' ct-hint--good' : ''}`} aria-hidden="true">{p.hintText}</div>}
      {p.loading && (
        <div className="ct-stage__loading">
          <span className="ct-spinner ct-spinner--lg" aria-hidden="true" />
          <span>{p.loadingText}</span>
        </div>
      )}
      {p.flashKey > 0 && <div key={p.flashKey} className="ct-flash" aria-hidden="true" />}
      {p.children}
    </div>
  );
}

export interface DocumentStageProps {
  stageRef: (el: HTMLDivElement | null) => void;
  stage: Size;
  kind: DocumentKind;
  videoRef?: (el: HTMLVideoElement | null) => void;
  ready: boolean;
  progress: number;
  hintText: string | null;
  flashKey: number;
  videoLabel: string;
  illustration?: ReactNode;
  children?: ReactNode;
}

/** Room kept around the frame: its corner marks stay inside the view, clear of the heading and the controls. */
const GUIDE_SIDE_MARGIN = 24;
const GUIDE_OVERLAYS = 300;

export function guideFor(kind: DocumentKind, stage: Size): Rect | null {
  if (!stage.width || !stage.height) return null;
  const maxWidth = Math.min(0.9, (stage.width - 2 * GUIDE_SIDE_MARGIN) / stage.width);
  const maxHeight = Math.min(kind === 'A4' ? 0.8 : 0.72, Math.max(0.3, (stage.height - GUIDE_OVERLAYS) / stage.height));
  return documentGuideRect(kind, stage.width, stage.height, { maxWidth, maxHeight });
}

export function DocumentStage(p: DocumentStageProps): ReactElement {
  const g = guideFor(p.kind, p.stage);
  return (
    <div className={`ct-stage ct-stage--document ct-stage--${p.kind.toLowerCase()}`} ref={p.stageRef}>
      {p.illustration ?? <video ref={p.videoRef} className="ct-video" autoPlay muted playsInline aria-label={p.videoLabel} />}
      {g && (
        <div className={`ct-guide${p.ready ? ' ct-guide--ready' : ''}`} aria-hidden="true"
             style={{ left: g.x, top: g.y, width: g.width, height: g.height, borderRadius: p.kind === 'A4' ? 6 : Math.min(g.width, g.height) * 0.06 }}>
          {!p.ready && <span className="ct-guide__scan"><span className="ct-guide__scanline" /></span>}
          <span className="ct-guide__corner ct-guide__corner--tl" />
          <span className="ct-guide__corner ct-guide__corner--tr" />
          <span className="ct-guide__corner ct-guide__corner--bl" />
          <span className="ct-guide__corner ct-guide__corner--br" />
          {p.kind === 'PASSPORT' && <span className="ct-guide__mrz" style={{ height: `${MRZ_BAND * 100}%` }} />}
          <span className="ct-guide__progress" style={{ transform: `scaleX(${p.progress})` }} />
        </div>
      )}
      {p.hintText && <div key={p.hintText} className={`ct-hint${p.ready ? ' ct-hint--good' : ''}`} aria-hidden="true">{p.hintText}</div>}
      {p.flashKey > 0 && <div key={p.flashKey} className="ct-flash" aria-hidden="true" />}
      {p.children}
    </div>
  );
}

/** Stylised face used by the static preview. */
export function FaceIllustration(): ReactElement {
  return (
    <svg className="ct-illustration" viewBox="0 0 300 400" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <linearGradient id="ct-bg-face" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#d9dee8" />
          <stop offset="1" stopColor="#a9b2c3" />
        </linearGradient>
      </defs>
      <rect width="300" height="400" fill="url(#ct-bg-face)" />
      <ellipse cx="150" cy="390" rx="120" ry="80" fill="#34507a" />
      <rect x="128" y="250" width="44" height="50" fill="#c99a7c" />
      <ellipse cx="150" cy="180" rx="72" ry="92" fill="#2b2118" />
      <ellipse cx="150" cy="200" rx="62" ry="82" fill="#e0b293" />
      <circle cx="126" cy="190" r="6" fill="#3b2a1e" />
      <circle cx="174" cy="190" r="6" fill="#3b2a1e" />
      <path d="M128 232 q22 16 44 0" stroke="#9c4f4a" strokeWidth="5" fill="none" strokeLinecap="round" />
    </svg>
  );
}

export function CardIllustration(): ReactElement {
  return (
    <svg className="ct-illustration" viewBox="0 0 400 300" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <rect width="400" height="300" fill="#2d3138" />
      <rect x="40" y="62" width="320" height="200" rx="12" fill="#e8f0ee" />
      <rect x="40" y="72" width="320" height="24" fill="#7fae9d" />
      <rect x="58" y="110" width="80" height="120" fill="#cfd6dd" />
      <ellipse cx="98" cy="160" rx="24" ry="30" fill="#d9a98a" />
      {[0, 1, 2, 3, 4].map((i) => <rect key={i} x="156" y={116 + i * 22} width={150 - (i % 2) * 40} height="9" fill="#2a3342" />)}
    </svg>
  );
}

export interface ChallengeOverlayProps {
  actions: readonly ChallengeAction[];
  index: number;
  /** Current instruction (TURN_LEFT, TURN_RIGHT, LOOK_UP, LOOK_DOWN, BLINK, SMILE, LOOK_STRAIGHT, NO_FACE…). */
  hint: string;
  text: string;
  sub: string | null;
  /** The preview is mirrored (front camera): the user's own left is on the screen's left. */
  mirrored: boolean;
  completedCount: number;
  stepLabel: (n: number) => string;
}

/**
 * Instruction overlay for one challenge action. Arrows are physical (always laid out left-to-right, also in Arabic):
 * they point the way the user sees their head move in the preview. Up / down arrows do not depend on mirroring.
 */
export function ChallengeOverlay(p: ChallengeOverlayProps): ReactElement {
  const turn = p.hint === 'TURN_LEFT' || p.hint === 'TURN_RIGHT';
  const look = p.hint === 'LOOK_UP' || p.hint === 'LOOK_DOWN';
  const icon = turn || look || p.hint === 'BLINK' || p.hint === 'SMILE' || p.hint === 'MOVE_CLOSER';
  // Own left in a mirrored preview moves towards the screen's left; in an unmirrored one, towards the right.
  const screenLeft = (p.hint === 'TURN_LEFT') === p.mirrored;
  return (
    <div className="ct-challenge" aria-hidden="true">
      <ol className="ct-challenge__dots" dir="ltr">
        {p.actions.map((_a, i) => (
          <li key={i} className={`ct-challenge__dot${i < p.index ? ' ct-challenge__dot--done' : i === p.index ? ' ct-challenge__dot--now' : ''}`}
              title={p.stepLabel(i + 1)} />
        ))}
      </ol>
      <div className="ct-challenge__card">
        <div className="ct-challenge__icon" dir="ltr">
          {(turn || look) && (
            <svg key={`${p.hint}-${p.index}`} viewBox="0 0 48 48" width="56" height="56"
                 className={`ct-challenge__arrow ct-challenge__arrow--${turn ? (screenLeft ? 'left' : 'right') : p.hint === 'LOOK_UP' ? 'up' : 'down'}`}>
              {/* Three chevrons light up in sequence, leading the eye the way the head should move. */}
              {[34, 24, 14].map((x, i) => (
                <path key={x} className="ct-challenge__chevron" style={{ animationDelay: `${i * 0.14}s` }} d={`M${x + 5} 12 L${x - 7} 24 L${x + 5} 36`}
                      fill="none" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
              ))}
            </svg>
          )}
          {p.hint === 'SMILE' && (
            <svg key={`smile-${p.index}`} className="ct-challenge__smile" viewBox="0 0 48 48" width="56" height="56">
              <circle cx="24" cy="24" r="20" fill="none" stroke="currentColor" strokeWidth="3.5" />
              <circle cx="17" cy="19" r="2.6" fill="currentColor" />
              <circle cx="31" cy="19" r="2.6" fill="currentColor" />
              <path className="ct-challenge__mouth" d="M14 28 Q24 38 34 28" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" />
            </svg>
          )}
          {p.hint === 'MOVE_CLOSER' && (
            <svg key={`closer-${p.index}`} className="ct-challenge__closer" viewBox="0 0 48 48" width="56" height="56">
              <ellipse cx="24" cy="24" rx="11" ry="14" fill="none" stroke="currentColor" strokeWidth="3.5" />
              <path className="ct-challenge__frame" d="M4 12 V4 H12 M36 4 H44 V12 M44 36 V44 H36 M12 44 H4 V36" fill="none" stroke="currentColor" strokeWidth="3.5"
                    strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
          {p.hint === 'BLINK' && (
            <svg key={`blink-${p.index}`} className="ct-challenge__eye" viewBox="0 0 48 48" width="56" height="56">
              <path d="M4 24 C12 12 36 12 44 24 C36 36 12 36 4 24 Z" fill="none" stroke="currentColor" strokeWidth="3.5" />
              <circle className="ct-challenge__pupil" cx="24" cy="24" r="6" fill="currentColor" />
            </svg>
          )}
          {!icon && p.completedCount > 0 && (
            <svg key={`done-${p.completedCount}`} className="ct-challenge__check" viewBox="0 0 48 48" width="56" height="56">
              <circle className="ct-challenge__check-ring" cx="24" cy="24" r="20" pathLength={100} />
              <path className="ct-challenge__check-tick" d="M15 25 L21.5 31.5 L33 18" pathLength={100} />
            </svg>
          )}
        </div>
        <p key={p.text} className="ct-challenge__text">{p.text}</p>
        {p.sub && <p key={p.sub} className="ct-challenge__sub">{p.sub}</p>}
      </div>
    </div>
  );
}

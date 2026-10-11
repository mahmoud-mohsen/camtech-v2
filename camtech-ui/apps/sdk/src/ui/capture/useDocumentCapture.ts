// Live document guidance: frames → edge alignment, glare, blur, stillness (+ portrait / MRZ) → auto-capture,
// cropped to the guide frame (+4% margin) from the full-resolution video.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DetailProbe, DocumentAnalyzer, documentDetailRegion, encodeDocument, expandRect, FrameHolder, FrameLoop, MotionMonitor, scaleRect, viewRectToVideoRect,
  type DocumentHint, type DocumentKind, type PortraitDetector, type PortraitObservation, type Rect,
} from '@camtech/capture-core';
import type { VisionUrls } from '../../config/options';
import type { SimulatedCamera } from '../../sim/simulated-camera';
import type { Size } from '../components/hooks';
import { loadedSim } from './sim';
import { getPortraitDetector } from './vision';

export interface DocumentCapture {
  hint: DocumentHint | null;
  progress: number;
  ready: boolean;
  manual: boolean;
  busy: boolean;
  shots: number;
  shoot: () => void;
}

export interface DocumentCaptureOptions {
  video: HTMLVideoElement | null;
  live: boolean;
  stage: Size;
  /** Guide frame in stage (view) pixels. */
  guide: Rect | null;
  kind: DocumentKind;
  requirePortrait: boolean;
  requireMrz: boolean;
  sim: SimulatedCamera | null;
  vision: VisionUrls;
  /** Changes when the same screen captures another side (resets the analyzer). */
  captureKey: string;
  onCaptured: (image: Blob) => void;
}

const MANUAL_AFTER_MS = 8000;

export function useDocumentCapture(opts: DocumentCaptureOptions): DocumentCapture {
  const { video, live, kind, requirePortrait, requireMrz, sim, vision, captureKey } = opts;
  const [hint, setHint] = useState<DocumentHint | null>(null);
  const [progress, setProgress] = useState(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shots, setShots] = useState(0);
  const [manual, setManual] = useState(false);
  const latest = useRef(opts);
  latest.current = opts;
  const shootRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    if (!video || !live) return;
    let disposed = false;
    let encoding = false;
    let frameNo = 0;
    let detector: PortraitDetector | null = null;
    let detectorFailed = !requirePortrait;
    const analyzer = new DocumentAnalyzer(kind, { portrait: requirePortrait, mrz: requireMrz });
    const holder = new FrameHolder();
    const probe = new DetailProbe();
    const motion = new MotionMonitor();
    motion.start();
    // A simulated camera only exists once the sim module is loaded (useCamera).
    const kit = sim ? loadedSim() : null;
    const scripted = kit ? new kit.ScriptedDocument() : null;
    setHint(null);
    setProgress(0);
    setReady(false);

    if (requirePortrait && !scripted) {
      getPortraitDetector(vision).then((d) => {
        if (!disposed) detector = d;
      }, () => {
        detectorFailed = true;
      });
    }

    /** Guide in video pixels, for the crop. */
    const videoGuide = (vw: number, vh: number): Rect | null => {
      const { guide, stage } = latest.current;
      if (!guide || !stage.width || !stage.height) return null;
      return viewRectToVideoRect(guide, stage.width, stage.height, vw, vh, false);
    };

    const capture = async (): Promise<void> => {
      if (encoding) return;
      encoding = true;
      setBusy(true);
      try {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        const g = videoGuide(vw, vh);
        const crop = g ? expandRect(g, 0.04, vw, vh) : null;
        const { blob } = await encodeDocument(holder.frame ?? video, crop);
        if (disposed) return;
        try {
          navigator.vibrate?.(60);
        } catch {
          /* ignore */
        }
        setShots((n) => n + 1);
        loop.stop();
        latest.current.onCaptured(blob);
      } finally {
        encoding = false;
        if (!disposed) setBusy(false);
      }
    };

    let last = { hint: null as DocumentHint | null, progress: -1, ready: false };
    const publish = (h: DocumentHint, p: number, r: boolean): void => {
      const pr = Math.round(p * 20) / 20;
      if (last.hint === h && last.progress === pr && last.ready === r) return;
      last = { hint: h, progress: pr, ready: r };
      setHint(h);
      setProgress(pr);
      setReady(r);
    };

    const loop = new FrameLoop({
      video,
      fps: 12,
      analysisWidth: 360,
      onFrame: (f) => {
        if (encoding || disposed) return;
        frameNo++;
        if (scripted) {
          const s = scripted.update(f.timestamp);
          if (s.keepFrame) holder.grab(video);
          publish(s.hint, s.progress, s.ready);
          if (s.shot) void capture();
          return;
        }
        const g = videoGuide(f.videoWidth, f.videoHeight);
        if (!g) return;
        let portraits: PortraitObservation[] | null | undefined;
        if (detectorFailed) portraits = null;
        else if (detector && frameNo % 3 === 0) portraits = detector.detect(video, f.videoWidth, f.videoHeight, f.timestamp);
        const r = analyzer.update({
          timestamp: f.timestamp,
          gray: f.gray,
          width: f.width,
          height: f.height,
          guide: scaleRect(g, f.scale),
          portraits,
          deviceSteady: motion.available ? motion.isSteady(20, 1.0) : undefined,
          // Text sharpness on the full-resolution video: blur that the 360 px analysis frame hides.
          detail: () => probe.measure(video, documentDetailRegion(kind, g)),
        });
        if (r.keepFrame) holder.grab(video);
        publish(r.hint, r.progress, r.ready);
        if (r.shot) void capture();
      },
    });
    loop.start();

    shootRef.current = () => {
      if (encoding || disposed) return;
      holder.grab(video);
      void capture();
    };

    return () => {
      disposed = true;
      loop.stop();
      motion.stop();
      holder.release();
      probe.release();
      shootRef.current = () => undefined;
    };
  }, [video, live, kind, requirePortrait, requireMrz, sim, vision, captureKey]);

  useEffect(() => {
    if (!live) return;
    setManual(false);
    const t = setTimeout(() => setManual(true), MANUAL_AFTER_MS);
    return () => clearTimeout(t);
  }, [live, captureKey]);

  const shoot = useCallback(() => shootRef.current(), []);
  return { hint, progress, ready, manual, busy, shots, shoot };
}

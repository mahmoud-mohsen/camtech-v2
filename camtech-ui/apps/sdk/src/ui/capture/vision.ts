// One face tracker and one portrait detector per page: loading MediaPipe is the slow part, so the instances are
// shared between screens and flows (their VIDEO-mode timestamps stay monotonic inside capture-core).
import { FaceTracker, PortraitDetector, type VisionOptions } from '@camtech/capture-core';
import type { VisionUrls } from '../../config/options';

let tracker: Promise<FaceTracker> | null = null;
let detector: Promise<PortraitDetector> | null = null;

const TIMEOUT_MS = 15000;

function options(urls: VisionUrls): VisionOptions {
  return { ...urls, timeoutMs: TIMEOUT_MS };
}

export function getFaceTracker(urls: VisionUrls): Promise<FaceTracker> {
  if (!tracker) {
    tracker = FaceTracker.create(options(urls));
    tracker.catch(() => { tracker = null; });
  }
  return tracker;
}

export function getPortraitDetector(urls: VisionUrls): Promise<PortraitDetector> {
  if (!detector) {
    detector = PortraitDetector.create(options(urls));
    detector.catch(() => { detector = null; });
  }
  return detector;
}

/** Starts downloading the face model early (e.g. on the camera primer screen). */
export function preloadFaceTracker(urls: VisionUrls): void {
  void getFaceTracker(urls).catch(() => undefined);
}

/** Frees the models (on SDK destroy). */
export function releaseVision(): void {
  void tracker?.then((t) => t.close(), () => undefined);
  void detector?.then((d) => d.close(), () => undefined);
  tracker = null;
  detector = null;
}

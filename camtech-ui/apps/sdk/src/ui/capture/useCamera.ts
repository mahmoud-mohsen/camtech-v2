import { useCallback, useEffect, useState } from 'react';
import { CameraController, CameraError, type CameraFacing, type CameraState } from '@camtech/capture-core';
import type { SimScene, SimulatedCamera } from '../../sim/simulated-camera';
import { useSdk } from '../context';
import { loadSim } from './sim';

export interface UseCameraOptions {
  facing: CameraFacing;
  minShortSide: number;
  /** Largest long side to ask for (CameraStartOptions.maxLongSide). */
  maxLongSide?: number;
  /** What the simulated camera draws. */
  scene: SimScene;
  enabled?: boolean;
}

export interface UseCamera {
  videoRef: (el: HTMLVideoElement | null) => void;
  video: HTMLVideoElement | null;
  state: CameraState;
  error: CameraError | null;
  restart: () => void;
  switchCamera: () => void;
  setTorch: (on: boolean) => void;
  /** Set when the simulated camera is in use. */
  sim: SimulatedCamera | null;
}

const FALLBACK_CODES = new Set(['NOT_FOUND', 'UNSUPPORTED', 'INSECURE_CONTEXT', 'IN_USE']);

/** Opens the camera for a capture screen and releases it on unmount. */
export function useCamera({ facing, minShortSide, maxLongSide, scene, enabled = true }: UseCameraOptions): UseCamera {
  const { simulate } = useSdk();
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [useSim, setUseSim] = useState(simulate === 'always');
  const [attempt, setAttempt] = useState(0);
  const [simCamera, setSimCamera] = useState<SimulatedCamera | null>(null);
  const [controller, setController] = useState<CameraController | null>(null);
  const [state, setState] = useState<CameraState | null>(null);
  // Kept until restart(): the error screen unmounts the <video>, whose cleanup stops the controller (status
  // 'stopped'); without this the error would vanish, the stage remount and the camera restart in a tight loop.
  const [failure, setFailure] = useState<CameraError | null>(null);

  // A controller per (real | simulated) source. The simulated camera is loaded on demand (dev / mock builds only).
  useEffect(() => {
    setFailure(null);
    setState(null);
    let disposed = false;
    let sim: SimulatedCamera | null = null;
    let c: CameraController | null = null;
    let unsub = (): void => undefined;
    const start = (simulated: SimulatedCamera | null): void => {
      sim = simulated;
      if (sim) setSimCamera(sim);
      const ctrl = new CameraController(sim ? { streamProvider: sim.provider } : {});
      c = ctrl;
      setController(ctrl);
      unsub = ctrl.subscribe((s) => {
        setState(s);
        if (s.status === 'error' && s.error) setFailure(s.error);
      });
    };
    if (useSim) {
      loadSim().then(
        (kit) => { if (!disposed) start(kit.createSimulatedCamera(scene)); },
        () => { if (!disposed) start(null); },
      );
    } else {
      start(null);
    }
    return () => {
      disposed = true;
      unsub();
      const ctrl = c;
      ctrl?.destroy();
      if (ctrl) setController((cur) => (cur === ctrl ? null : cur));
      const s = sim;
      s?.stop();
      if (s) setSimCamera((cur) => (cur === s ? null : cur));
    };
  }, [useSim, scene]);

  useEffect(() => {
    if (!controller || !video || !enabled) return;
    controller.attach(video);
    let cancelled = false;
    controller.start({ facing, minShortSide, maxLongSide }).catch((e: unknown) => {
      if (cancelled) return;
      if (simulate === 'fallback' && e instanceof CameraError && FALLBACK_CODES.has(e.code)) setUseSim(true);
    });
    return () => {
      cancelled = true;
      controller.stop();
    };
  }, [controller, video, enabled, facing, minShortSide, maxLongSide, attempt, simulate]);

  const restart = useCallback(() => {
    setFailure(null);
    setAttempt((n) => n + 1);
  }, []);
  const switchCamera = useCallback(() => { void controller?.switchCamera().catch(() => undefined); }, [controller]);
  const setTorch = useCallback((on: boolean) => { void controller?.setTorch(on); }, [controller]);

  const current = state ?? controller?.state ?? {
    status: 'idle', facing, mirrored: facing === 'user', width: 0, height: 0, deviceId: null, label: '', canSwitch: false,
    torchSupported: false, torchOn: false, lowResolution: false, error: null,
  } satisfies CameraState;
  // In mock builds a missing camera switches to the simulated one: do not flash the error meanwhile.
  const pendingFallback = simulate === 'fallback' && !useSim && failure !== null && FALLBACK_CODES.has(failure.code);

  return {
    videoRef: setVideo,
    video,
    state: current,
    error: pendingFallback ? null : failure,
    restart,
    switchCamera,
    setTorch,
    sim: useSim ? simCamera : null,
  };
}

// Camera access with sensible defaults for identity capture: high resolution, the main rear lens on multi-lens
// phones, torch and continuous focus when available, and clean pause/resume when the page is hidden.

export type CameraFacing = 'user' | 'environment';

export type CameraErrorCode =
  | 'PERMISSION_DENIED'
  | 'NOT_FOUND'
  | 'IN_USE'
  | 'INSECURE_CONTEXT'
  | 'UNSUPPORTED'
  | 'OVERCONSTRAINED'
  | 'UNKNOWN';

export class CameraError extends Error {
  readonly code: CameraErrorCode;

  constructor(code: CameraErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CameraError';
    this.code = code;
  }
}

/** Maps a getUserMedia rejection to a typed error. */
export function toCameraError(err: unknown): CameraError {
  if (err instanceof CameraError) return err;
  const name = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name: unknown }).name) : '';
  const message = err instanceof Error ? err.message : undefined;
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
    case 'SecurityError':
      return new CameraError('PERMISSION_DENIED', message);
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('NOT_FOUND', message);
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return new CameraError('IN_USE', message);
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return new CameraError('OVERCONSTRAINED', message);
    case 'TypeError':
      return new CameraError('UNSUPPORTED', message);
    default:
      return new CameraError('UNKNOWN', message);
  }
}

export type CameraPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** Reads the camera permission without prompting, when the browser supports it (not Safari < 16, not Firefox). */
export async function probeCameraPermission(): Promise<CameraPermission> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown';
  try {
    const status = await navigator.permissions.query({ name: 'camera' as PermissionName });
    return status.state;
  } catch {
    return 'unknown';
  }
}

/** Throws the right CameraError when the environment cannot use a camera at all. */
export function assertCameraSupport(): void {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') throw new CameraError('UNSUPPORTED');
  if (window.isSecureContext === false) throw new CameraError('INSECURE_CONTEXT');
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new CameraError(window.isSecureContext ? 'UNSUPPORTED' : 'INSECURE_CONTEXT');
  }
}

const AUX_LENS = /ultra|0[.,]5|wide[\s-]?angle|tele|macro|depth|infrared|\bir\b|desk view/i;
const BACK = /back|rear|environment|world|arrière|trasera|خلفي/i;
const FRONT = /front|user|facetime|selfie|أمامي/i;

/**
 * Picks the main rear camera among several video inputs (multi-lens phones expose wide, ultra-wide and
 * telephoto separately; the ultra-wide is a poor choice for documents). Labels are empty before permission.
 * Returns undefined when nothing looks like a rear camera (let the browser choose with facingMode).
 */
export function pickMainRearCamera(devices: readonly Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'>[]):
  Pick<MediaDeviceInfo, 'deviceId' | 'kind' | 'label'> | undefined {
  const video = devices.filter((d) => d.kind === 'videoinput' && d.deviceId);
  const rear = video.filter((d) => d.label && BACK.test(d.label) && !FRONT.test(d.label));
  if (rear.length === 0) return undefined;
  const main = rear.filter((d) => !AUX_LENS.test(d.label));
  const pool = main.length ? main : rear;
  // Android names them "camera2 0, facing back", "camera2 2, facing back": the lowest index is the main lens.
  const indexOf = (label: string): number => {
    const m = /camera2?\s*(\d+)/i.exec(label) ?? /(\d+)/.exec(label);
    return m ? Number(m[1]) : Number.MAX_SAFE_INTEGER;
  };
  // iOS: "Back Camera" is the main lens; "Back Dual Wide Camera" etc. are virtual multi-lens devices.
  return [...pool].sort((a, b) => indexOf(a.label) - indexOf(b.label) || a.label.length - b.label.length)[0];
}

export interface CameraStartOptions {
  facing: CameraFacing;
  /** Minimum acceptable short side of the stream, in pixels. Default 720. */
  minShortSide?: number;
  /** A specific device (takes precedence over `facing`). */
  deviceId?: string;
  /** Largest long side to ask for. Default 1920; 1280 keeps live face tracking fast on phones. */
  maxLongSide?: number;
}

export type CameraStatus = 'idle' | 'starting' | 'live' | 'paused' | 'stopped' | 'error';

export interface CameraState {
  status: CameraStatus;
  facing: CameraFacing;
  /** Preview should be mirrored (front camera). Uploaded images are never mirrored. */
  mirrored: boolean;
  width: number;
  height: number;
  deviceId: string | null;
  label: string;
  /** More than one camera is available. */
  canSwitch: boolean;
  torchSupported: boolean;
  torchOn: boolean;
  /** Resolution is below `minShortSide` (still usable, but quality may suffer). */
  lowResolution: boolean;
  error: CameraError | null;
}

/** Replaces getUserMedia, e.g. with a canvas stream for a simulated camera. */
export type StreamProvider = (constraints: MediaStreamConstraints) => Promise<MediaStream>;

export interface CameraControllerOptions {
  streamProvider?: StreamProvider;
  /** Pause the stream while the page is hidden (default true). */
  pauseWhenHidden?: boolean;
}

interface TorchCapabilities extends MediaTrackCapabilities {
  torch?: boolean;
  focusMode?: string[];
}

type Listener = (state: CameraState) => void;

const INITIAL: CameraState = {
  status: 'idle', facing: 'user', mirrored: true, width: 0, height: 0, deviceId: null, label: '', canSwitch: false,
  torchSupported: false, torchOn: false, lowResolution: false, error: null,
};

export class CameraController {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private current: CameraState = INITIAL;
  private readonly listeners = new Set<Listener>();
  private lastOptions: CameraStartOptions | null = null;
  private startToken = 0;
  private readonly provider: StreamProvider | undefined;
  private readonly pauseWhenHidden: boolean;
  private detach: (() => void) | null = null;

  constructor(opts: CameraControllerOptions = {}) {
    this.provider = opts.streamProvider;
    this.pauseWhenHidden = opts.pauseWhenHidden ?? true;
  }

  get state(): CameraState {
    return this.current;
  }

  get mediaStream(): MediaStream | null {
    return this.stream;
  }

  get videoElement(): HTMLVideoElement | null {
    return this.video;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => this.listeners.delete(listener);
  }

  /** Binds the preview element. The element should be `muted playsinline autoplay`. */
  attach(video: HTMLVideoElement): void {
    this.video = video;
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    if (this.stream && video.srcObject !== this.stream) {
      video.srcObject = this.stream;
      void video.play().catch(() => undefined);
    }
  }

  async start(opts: CameraStartOptions): Promise<void> {
    const token = ++this.startToken;
    this.lastOptions = opts;
    this.releaseStream();
    this.set({ status: 'starting', facing: opts.facing, mirrored: opts.facing === 'user', error: null });
    log(token, 'start', opts.facing, opts.deviceId ? 'device ' + opts.deviceId.slice(0, 8) : '');
    try {
      if (!this.provider) assertCameraSupport();
      const stream = await this.open(opts);
      if (token !== this.startToken) {
        stopStream(stream);
        return;
      }
      this.stream = stream;
      await this.afterOpen(opts, token);
      this.installListeners();
    } catch (e) {
      if (token !== this.startToken) return;
      const error = toCameraError(e);
      log(token, 'failed', error.code, error.message);
      this.set({ status: 'error', error });
      throw error;
    }
  }

  /** Cycles to the other facing (or the next device when both are the same facing). */
  async switchCamera(): Promise<void> {
    const facing: CameraFacing = this.current.facing === 'user' ? 'environment' : 'user';
    await this.start({ ...(this.lastOptions ?? {}), facing, deviceId: undefined });
  }

  async setTorch(on: boolean): Promise<boolean> {
    const track = this.track();
    if (!track || !this.current.torchSupported) return false;
    try {
      await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] });
      this.set({ torchOn: on });
      return true;
    } catch {
      return false;
    }
  }

  /** Temporarily stops the stream (e.g. page hidden). `resume()` reopens the same camera. */
  pause(): void {
    if (this.current.status !== 'live') return;
    this.releaseStream();
    this.set({ status: 'paused', torchOn: false });
  }

  async resume(): Promise<void> {
    if (this.current.status !== 'paused' || !this.lastOptions) return;
    await this.start({ ...this.lastOptions, deviceId: this.current.deviceId ?? this.lastOptions.deviceId });
  }

  /** Releases the camera (the indicator light goes off). */
  stop(): void {
    this.startToken++;
    this.releaseStream();
    this.removeListeners();
    this.set({ status: 'stopped', torchOn: false });
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
    this.video = null;
  }

  private track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  private getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream> {
    if (this.provider) return this.provider(constraints);
    return navigator.mediaDevices.getUserMedia(constraints);
  }

  private async open(opts: CameraStartOptions): Promise<MediaStream> {
    const base: MediaTrackConstraints = opts.deviceId
      ? { deviceId: { exact: opts.deviceId } }
      : { facingMode: { ideal: opts.facing } };
    const attempts: MediaTrackConstraints[] = [
      ...((opts.maxLongSide ?? 1920) > 1280 ? [{ ...base, width: { ideal: 1920 }, height: { ideal: 1080 } }] : []),
      { ...base, width: { ideal: 1280 }, height: { ideal: 720 } },
      base,
    ];
    let lastError: unknown = null;
    for (const video of attempts) {
      const t = now();
      try {
        const stream = await this.getUserMedia({ audio: false, video });
        log(null, 'getUserMedia ok', JSON.stringify(video), 'in', now() - t, 'ms:', stream.getVideoTracks()[0]?.label);
        return stream;
      } catch (e) {
        log(null, 'getUserMedia failed', JSON.stringify(video), 'in', now() - t, 'ms:', (e as Error)?.name, (e as Error)?.message);
        lastError = e;
        const code = toCameraError(e).code;
        // Only constraint problems are worth retrying with looser constraints.
        if (code !== 'OVERCONSTRAINED' && code !== 'UNKNOWN') throw e;
      }
    }
    // Last resort: any camera at all.
    try {
      return await this.getUserMedia({ audio: false, video: true });
    } catch {
      throw lastError;
    }
  }

  private async afterOpen(opts: CameraStartOptions, token: number): Promise<void> {
    let track = this.track();
    if (!track) throw new CameraError('NOT_FOUND');

    // Labels only exist after permission: now we can pick the main rear lens and reopen if needed.
    let devices: MediaDeviceInfo[] = [];
    if (!this.provider && navigator.mediaDevices?.enumerateDevices) {
      try {
        devices = await navigator.mediaDevices.enumerateDevices();
        log(token, 'cameras', devices.filter((d) => d.kind === 'videoinput').map((d) => d.label || '(no label)').join(' | '));
      } catch {
        devices = [];
      }
    }
    if (token !== this.startToken) return;
    if (opts.facing === 'environment' && !opts.deviceId && devices.length > 1) {
      const main = pickMainRearCamera(devices);
      // No rear camera (laptop): keep the camera that just worked, e.g. for the selfie, rather than the browser's
      // guess, which may be a virtual webcam that sends no picture.
      const known = lastWorkingDeviceId && devices.some((d) => d.deviceId === lastWorkingDeviceId) ? lastWorkingDeviceId : undefined;
      const wanted = main?.deviceId ?? known;
      const currentId = track.getSettings().deviceId;
      if (wanted && currentId && wanted !== currentId) {
        log(token, 'switching to', devices.find((d) => d.deviceId === wanted)?.label ?? wanted);
        if (!(await this.reopen(opts, wanted, token))) return;
      }
    }

    if (this.video) {
      this.video.srcObject = this.stream;
      // play() can stay pending forever on a camera that sends nothing: do not wait on it for long.
      const t = now();
      const played = await Promise.race([
        this.video.play().then(() => 'played', (e: unknown) => 'play failed: ' + String((e as Error)?.name)),
        delay(PLAY_TIMEOUT_MS).then(() => 'play still pending'),
      ]);
      log(token, played, 'after', now() - t, 'ms, frame', this.video.videoWidth + 'x' + this.video.videoHeight);
      if (token !== this.startToken) return;
    }

    track = this.track();
    if (!track) throw new CameraError('NOT_FOUND');
    const settings = track.getSettings();
    const caps: TorchCapabilities = typeof track.getCapabilities === 'function' ? track.getCapabilities() : {};
    if (caps.focusMode?.includes('continuous')) {
      try {
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] });
      } catch {
        /* optional */
      }
    }
    const facingSetting = settings.facingMode;
    const facing: CameraFacing = facingSetting === 'environment' || facingSetting === 'user' ? facingSetting : opts.facing;
    const width = settings.width ?? 0;
    const height = settings.height ?? 0;
    const videoInputs = devices.filter((d) => d.kind === 'videoinput').length;
    const realW = this.video?.videoWidth || width;
    const realH = this.video?.videoHeight || height;
    if (settings.deviceId && !this.provider) lastWorkingDeviceId = settings.deviceId;
    this.set({
      status: 'live',
      facing,
      mirrored: facing === 'user',
      width: realW,
      height: realH,
      deviceId: settings.deviceId ?? null,
      label: track.label,
      canSwitch: videoInputs > 1,
      torchSupported: caps.torch === true,
      torchOn: false,
      lowResolution: Math.min(realW, realH) > 0 && Math.min(realW, realH) < (opts.minShortSide ?? 720),
      error: null,
    });
    track.addEventListener('ended', this.onTrackEnded);
    log(token, 'live', track.label, realW + 'x' + realH);
    this.watchFirstFrame(token);
  }

  /**
   * A camera can open and still never send a picture (a virtual webcam, a camera held by another app). Some cameras
   * (e.g. redirected by Citrix) take several seconds for the first frame, so this only gives up after a long wait,
   * and in the background: the camera is already live, nothing waits on it. The user then gets the camera error
   * screen (retry, upload) instead of a black preview.
   */
  private watchFirstFrame(token: number): void {
    const video = this.video;
    if (!video || this.provider) return;
    const t = now();
    void waitForFrames(video, FIRST_FRAME_TIMEOUT_MS).then((showing) => {
      if (showing) log(token, 'first frame', now() - t, 'ms after live,', video.videoWidth + 'x' + video.videoHeight);
      if (showing || token !== this.startToken || this.current.status !== 'live') return;
      log(token, 'no picture after', FIRST_FRAME_TIMEOUT_MS, 'ms: giving up');
      this.releaseStream();
      this.set({ status: 'error', error: new CameraError('IN_USE', 'The camera sends no picture') });
    });
  }

  /**
   * Replaces the open stream with `deviceId` (released first: many devices cannot open two cameras at once),
   * or with the browser's choice when that device fails to open. False when a newer start() superseded this one.
   */
  private async reopen(opts: CameraStartOptions, deviceId: string, token: number): Promise<boolean> {
    stopStream(this.stream);
    this.stream = null;
    let next: MediaStream;
    try {
      next = await this.open({ ...opts, deviceId });
    } catch {
      next = await this.open(opts);
    }
    if (token !== this.startToken) {
      stopStream(next);
      return false;
    }
    this.stream = next;
    return true;
  }

  private readonly onTrackEnded = (): void => {
    if (this.current.status === 'live') {
      // Another app took the camera, or it was unplugged.
      this.releaseStream();
      this.set({ status: 'error', error: new CameraError('IN_USE', 'The camera stopped') });
    }
  };

  private readonly onVisibility = (): void => {
    if (!this.pauseWhenHidden) return;
    log(this.startToken, 'page', document.visibilityState);
    if (document.visibilityState === 'hidden') this.pause();
    else void this.resume().catch(() => undefined);
  };

  private readonly onDeviceChange = (): void => {
    // The active camera was unplugged: restart with the same options so the browser picks another.
    const track = this.track();
    if (this.current.status === 'live' && (!track || track.readyState === 'ended') && this.lastOptions) {
      void this.start({ ...this.lastOptions, deviceId: undefined }).catch(() => undefined);
    } else if (navigator.mediaDevices?.enumerateDevices) {
      void navigator.mediaDevices.enumerateDevices().then((list) => {
        this.set({ canSwitch: list.filter((d) => d.kind === 'videoinput').length > 1 });
      }).catch(() => undefined);
    }
  };

  private readonly onResize = (): void => {
    // Orientation changes swap the stream's width and height on mobile.
    if (!this.video) return;
    const w = this.video.videoWidth;
    const h = this.video.videoHeight;
    if (w && h && (w !== this.current.width || h !== this.current.height)) this.set({ width: w, height: h });
  };

  private installListeners(): void {
    if (this.detach) return;
    const video = this.video;
    document.addEventListener('visibilitychange', this.onVisibility);
    navigator.mediaDevices?.addEventListener?.('devicechange', this.onDeviceChange);
    window.addEventListener('orientationchange', this.onResize);
    video?.addEventListener('resize', this.onResize);
    this.detach = () => {
      document.removeEventListener('visibilitychange', this.onVisibility);
      navigator.mediaDevices?.removeEventListener?.('devicechange', this.onDeviceChange);
      window.removeEventListener('orientationchange', this.onResize);
      video?.removeEventListener('resize', this.onResize);
    };
  }

  private removeListeners(): void {
    this.detach?.();
    this.detach = null;
  }

  private releaseStream(): void {
    const track = this.track();
    track?.removeEventListener('ended', this.onTrackEnded);
    stopStream(this.stream);
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  private set(patch: Partial<CameraState>): void {
    this.current = { ...this.current, ...patch };
    for (const l of this.listeners) l(this.current);
  }
}

/** How long a live camera may take to show its first frame before it counts as broken. */
const FIRST_FRAME_TIMEOUT_MS = 20000;

/** Longest wait for video.play() when the camera starts. */
const PLAY_TIMEOUT_MS = 4000;

const now = (): number => Math.round(typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Start-up trace for support (Chrome shows console.debug only at the Verbose level). */
function log(token: number | null, ...parts: unknown[]): void {
  if (typeof console !== 'undefined') console.debug('[camtech camera]', now() + 'ms', token === null ? '' : '#' + token, ...parts);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The last camera that showed a picture on this page (the selfie camera, on a laptop). */
let lastWorkingDeviceId: string | null = null;

/** Plays the preview and resolves true once a frame is decoded, false after `timeoutMs` without one. */
function waitForFrames(video: HTMLVideoElement, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let done = false;
    const hasFrame = (): boolean => video.readyState >= 2 && video.videoWidth > 0;
    const finish = (ok: boolean): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      video.removeEventListener('loadeddata', check);
      video.removeEventListener('playing', check);
      resolve(ok);
    };
    const check = (): void => {
      if (hasFrame()) finish(true);
    };
    const timer = setTimeout(() => finish(hasFrame()), timeoutMs);
    video.addEventListener('loadeddata', check);
    video.addEventListener('playing', check);
    // play() can stay pending forever on a camera that sends nothing: never await it on its own.
    void video.play().then(check, () => undefined);
    check();
  });
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((t) => t.stop());
}

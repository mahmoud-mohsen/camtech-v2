// Optional device-motion input: how much the phone is moving, to strengthen the "hold still" check.

interface IOSDeviceMotionEvent {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

export type MotionPermission = 'granted' | 'denied' | 'unsupported';

/** True when the browser requires an explicit permission prompt (iOS 13+). Must be called from a user gesture. */
export function motionNeedsPermission(): boolean {
  if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') return false;
  return typeof (DeviceMotionEvent as unknown as IOSDeviceMotionEvent).requestPermission === 'function';
}

/** Asks for motion access on iOS (call inside a click handler). Other browsers grant it implicitly. */
export async function requestMotionPermission(): Promise<MotionPermission> {
  if (typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') return 'unsupported';
  const ctor = DeviceMotionEvent as unknown as IOSDeviceMotionEvent;
  if (typeof ctor.requestPermission !== 'function') return 'granted';
  try {
    return await ctor.requestPermission();
  } catch {
    return 'denied';
  }
}

/** Keeps a short moving average of the rotation rate (deg/s) and acceleration change. */
export class MotionMonitor {
  private samples: { t: number; rotation: number; accel: number }[] = [];
  private listening = false;
  private lastAccel: { x: number; y: number; z: number } | null = null;
  private received = false;

  constructor(private readonly windowMs = 500) {}

  /** Whether any motion event arrived (desktop browsers never send any). */
  get available(): boolean {
    return this.received;
  }

  start(): void {
    if (this.listening || typeof window === 'undefined' || typeof DeviceMotionEvent === 'undefined') return;
    window.addEventListener('devicemotion', this.onMotion);
    this.listening = true;
  }

  stop(): void {
    if (!this.listening) return;
    window.removeEventListener('devicemotion', this.onMotion);
    this.listening = false;
    this.samples = [];
    this.lastAccel = null;
  }

  /** Mean rotation rate in deg/s over the window (0 when unavailable). */
  get rotationRate(): number {
    this.prune(performance.now());
    if (!this.samples.length) return 0;
    return this.samples.reduce((s, x) => s + x.rotation, 0) / this.samples.length;
  }

  /** Mean change of acceleration (m/s²) between events over the window. */
  get shake(): number {
    this.prune(performance.now());
    if (!this.samples.length) return 0;
    return this.samples.reduce((s, x) => s + x.accel, 0) / this.samples.length;
  }

  /** True when the device is steady enough for a sharp photo. Unknown motion counts as steady. */
  isSteady(maxRotation = 25, maxShake = 1.2): boolean {
    if (!this.received) return true;
    return this.rotationRate <= maxRotation && this.shake <= maxShake;
  }

  private prune(now: number): void {
    const cutoff = now - this.windowMs;
    while (this.samples.length && this.samples[0].t < cutoff) this.samples.shift();
  }

  private readonly onMotion = (e: DeviceMotionEvent): void => {
    const r = e.rotationRate;
    const a = e.accelerationIncludingGravity ?? e.acceleration;
    if (!r && !a) return;
    this.received = true;
    const rotation = r ? Math.hypot(r.alpha ?? 0, r.beta ?? 0, r.gamma ?? 0) : 0;
    let accel = 0;
    if (a) {
      const cur = { x: a.x ?? 0, y: a.y ?? 0, z: a.z ?? 0 };
      if (this.lastAccel) accel = Math.hypot(cur.x - this.lastAccel.x, cur.y - this.lastAccel.y, cur.z - this.lastAccel.z);
      this.lastAccel = cur;
    }
    const t = performance.now();
    this.samples.push({ t, rotation, accel });
    this.prune(t);
  };
}

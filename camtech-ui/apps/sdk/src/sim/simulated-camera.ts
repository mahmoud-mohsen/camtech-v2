// A camera made of a canvas (captureStream): draws a stylised face or document so the whole UI can be used in a
// browser without a webcam (development and mock builds only).
import type { StreamProvider } from '@camtech/capture-core';

export type SimScene = 'face' | 'ID_CARD' | 'PASSPORT' | 'A4';

/** Head pose for challenges. */
export interface SimPose {
  /** Degrees, + = the person's own left. */
  turn: number;
  /** Degrees, + = looking up. */
  pitch: number;
  eyesClosed: boolean;
  /** 0 relaxed .. 1 broad smile. */
  smile: number;
}

export const NEUTRAL_POSE: SimPose = { turn: 0, pitch: 0, eyesClosed: false, smile: 0 };

export interface SimulatedCamera {
  provider: StreamProvider;
  /** Face size multiplier (1 = normal selfie distance). Animated smoothly. */
  setFaceScale: (scale: number) => void;
  /** Which side of the Emirates ID is shown. Changing it turns the card over. */
  setSide: (side: 'front' | 'back') => void;
  /** Head pose for challenges (turn, look up / down, eyes closed, smile). Animated smoothly. */
  setPose: (pose: SimPose) => void;
  stop: () => void;
}

const FPS = 30;
const TAU = Math.PI * 2;
const rad = (deg: number): number => (deg * Math.PI) / 180;
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Critically damped spring: eases in and out, never overshoots, independent of the frame rate. */
class Spring {
  private v = 0;

  constructor(public x: number, private readonly omega: number) {}

  step(target: number, dt: number): number {
    const w = this.omega;
    const d = this.x - target;
    const e = Math.exp(-w * dt);
    const k = (this.v + w * d) * dt;
    this.x = target + (d + k) * e;
    this.v = (this.v - w * k) * e;
    return this.x;
  }
}

type Ctx = CanvasRenderingContext2D;

function makeCanvas(w: number, h: number): [HTMLCanvasElement, Ctx | null] {
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(w));
  cv.height = Math.max(1, Math.round(h));
  return [cv, cv.getContext('2d')];
}

function roundRect(c: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function textLines(c: Ctx, x: number, y: number, w: number, lines: number, gap: number, color = '#2a3342'): void {
  c.fillStyle = color;
  for (let i = 0; i < lines; i++) {
    const lw = w * (0.55 + ((i * 37) % 40) / 100);
    roundRect(c, x, y + i * gap, lw, gap * 0.38, gap * 0.08);
    c.fill();
  }
}

function drawPortrait(c: Ctx, x: number, y: number, w: number, h: number): void {
  const bg = c.createLinearGradient(0, y, 0, y + h);
  bg.addColorStop(0, '#d7dee5');
  bg.addColorStop(1, '#bcc6d0');
  c.fillStyle = bg;
  roundRect(c, x, y, w, h, w * 0.04);
  c.fill();
  c.save();
  roundRect(c, x, y, w, h, w * 0.04);
  c.clip();
  c.fillStyle = '#4a5d7a';
  c.beginPath();
  c.ellipse(x + w / 2, y + h * 1.02, w * 0.48, h * 0.3, 0, Math.PI, 0);
  c.fill();
  c.fillStyle = '#c99a7c';
  c.fillRect(x + w * 0.42, y + h * 0.6, w * 0.16, h * 0.14);
  c.fillStyle = '#2b2118';
  c.beginPath();
  c.ellipse(x + w / 2, y + h * 0.38, w * 0.31, h * 0.29, 0, 0, TAU);
  c.fill();
  const skin = c.createRadialGradient(x + w * 0.44, y + h * 0.38, w * 0.02, x + w / 2, y + h * 0.44, w * 0.32);
  skin.addColorStop(0, '#e8bb9c');
  skin.addColorStop(1, '#c48d6e');
  c.fillStyle = skin;
  c.beginPath();
  c.ellipse(x + w / 2, y + h * 0.45, w * 0.26, h * 0.25, 0, 0, TAU);
  c.fill();
  c.fillStyle = '#3a2b20';
  c.beginPath();
  c.arc(x + w * 0.41, y + h * 0.43, w * 0.025, 0, TAU);
  c.arc(x + w * 0.59, y + h * 0.43, w * 0.025, 0, TAU);
  c.fill();
  c.restore();
}

function mrz(c: Ctx, x: number, y: number, w: number, lines: number, gap: number): void {
  c.fillStyle = '#1b1f27';
  c.font = `${Math.round(gap * 0.7)}px monospace`;
  const sample = ['P<EGYHASSAN<<AHMED<MOHAMED<<<<<<<<<<<<<<<<<<<', 'A12345678<EGY9001155M2712312<<<<<<<<<<<<<<04', 'IDARE1234567890784199012345676<<<<<<<<<<<<<'];
  for (let i = 0; i < lines; i++) c.fillText(sample[i % sample.length], x, y + i * gap + gap * 0.7, w);
}

/** Fine wavy security lines, as printed on ID cards and passport pages. */
function guilloche(c: Ctx, w: number, h: number, color: string): void {
  c.strokeStyle = color;
  c.lineWidth = Math.max(1, h * 0.0025);
  for (let k = 0; k < 22; k++) {
    const y0 = h * (0.12 + k * 0.04);
    c.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = y0 + Math.sin((x / w) * Math.PI * 4 + k * 0.55) * h * 0.022 + Math.sin((x / w) * Math.PI * 9 + k) * h * 0.006;
      if (x === 0) c.moveTo(x, y);
      else c.lineTo(x, y);
    }
    c.stroke();
  }
}

export function createSimulatedCamera(scene: SimScene): SimulatedCamera {
  const portrait = scene === 'face';
  const W = portrait ? 720 : 1600;
  const H = portrait ? 960 : 1200;
  const [canvas, ctx] = makeCanvas(W, H);
  let targetScale = 1;
  let side: 'front' | 'back' = 'front';
  let pose: SimPose = NEUTRAL_POSE;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stream: MediaStream | null = null;
  const started = performance.now();
  let lastFrame = -1;

  // ---------- static layers (drawn once) ----------
  const backdrop = (() => {
    const [cv, c] = makeCanvas(W, H);
    if (!c) return cv;
    if (portrait) {
      const g = c.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, '#dfe4ec');
      g.addColorStop(1, '#a6aebe');
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
      // Window light from the upper right and a soft, out-of-focus room.
      const light = c.createRadialGradient(W * 0.86, H * 0.1, 0, W * 0.86, H * 0.1, W * 0.8);
      light.addColorStop(0, 'rgba(255,249,238,.65)');
      light.addColorStop(1, 'rgba(255,249,238,0)');
      c.fillStyle = light;
      c.fillRect(0, 0, W, H);
      c.filter = 'blur(18px)';
      c.fillStyle = 'rgba(70,80,100,.12)';
      c.fillRect(W * 0.06, -20, W * 0.07, H + 40);
      c.fillStyle = 'rgba(255,255,255,.22)';
      for (const [x, y, r] of [[0.16, 0.2, 0.05], [0.24, 0.32, 0.03], [0.78, 0.42, 0.04], [0.9, 0.58, 0.06]]) {
        c.beginPath();
        c.arc(W * x, H * y, W * r, 0, TAU);
        c.fill();
      }
      c.filter = 'none';
    } else {
      c.fillStyle = '#2b2f36';
      c.fillRect(0, 0, W, H);
      c.fillStyle = 'rgba(255,255,255,0.025)';
      for (let i = 0; i < 60; i++) c.fillRect(0, (i * 37) % H, W, 1 + (i % 3));
      const pool = c.createRadialGradient(W * 0.45, H * 0.4, 0, W * 0.45, H * 0.4, W * 0.7);
      pool.addColorStop(0, 'rgba(255,236,205,.10)');
      pool.addColorStop(1, 'rgba(255,236,205,0)');
      c.fillStyle = pool;
      c.fillRect(0, 0, W, H);
    }
    return cv;
  })();

  const vignette = (() => {
    const [cv, c] = makeCanvas(W, H);
    if (!c) return cv;
    const v = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    v.addColorStop(0, 'rgba(10,14,22,0)');
    v.addColorStop(1, 'rgba(10,14,22,.38)');
    c.fillStyle = v;
    c.fillRect(0, 0, W, H);
    return cv;
  })();

  // ---------- face ----------
  const head = {
    turn: new Spring(0, 9),
    pitch: new Spring(0, 9),
    smile: new Spring(0, 8),
    eye: new Spring(1, 32),
    scale: new Spring(1, 6),
  };
  let blinkUntil = 0;
  let nextBlink = 1600;

  function drawFace(c: Ctx, t: number, dt: number): void {
    c.drawImage(backdrop, 0, 0);

    // Spontaneous blinks at irregular intervals while the person is at rest.
    const atRest = pose.turn === 0 && pose.pitch === 0 && pose.smile < 0.1 && !pose.eyesClosed;
    if (t >= nextBlink) {
      if (atRest) blinkUntil = t + 130;
      nextBlink = t + 2300 + Math.random() * 2800;
    }
    const eyeOpen = clamp(head.eye.step(pose.eyesClosed || t < blinkUntil ? 0 : 1, dt), 0, 1);
    // Springs carry the head between poses; tiny idle drift keeps it alive.
    const turnDeg = head.turn.step(pose.turn, dt) + 1.3 * Math.sin(t / 1700) + 0.5 * Math.sin(t / 640 + 1);
    const pitchDeg = head.pitch.step(pose.pitch, dt) + 0.9 * Math.sin(t / 2300 + 2) + 0.4 * Math.sin(t / 810);
    const smile = clamp(head.smile.step(pose.smile, dt), 0, 1);
    const scale = head.scale.step(targetScale, dt);
    const yaw = rad(turnDeg);
    const pit = rad(pitchDeg) * 0.5;
    const roll = rad(0.8 * Math.sin(t / 2100) - turnDeg * 0.05);

    const cx = W / 2 + Math.sin(t / 1300) * 3;
    const cy = H / 2 + Math.sin(t / 900) * 4;
    const ry = H * 0.18 * scale;
    const rx = ry * 0.74;
    const breathe = Math.sin(t / 1650) * 3;

    // Soft shadow on the wall behind.
    const wall = c.createRadialGradient(cx + rx * 0.35, cy + ry * 0.2, rx * 0.4, cx + rx * 0.35, cy + ry * 0.2, rx * 2.2);
    wall.addColorStop(0, 'rgba(30,35,50,.18)');
    wall.addColorStop(1, 'rgba(30,35,50,0)');
    c.fillStyle = wall;
    c.fillRect(0, 0, W, H);

    // Shoulders and neck stay put while the head moves.
    const by = cy + ry * 2.1 + breathe;
    const shirt = c.createLinearGradient(cx - rx * 2.5, by - ry, cx + rx * 2.5, H);
    shirt.addColorStop(0, '#46679a');
    shirt.addColorStop(1, '#1f3456');
    c.fillStyle = shirt;
    c.beginPath();
    c.ellipse(cx, by, rx * 2.5, ry * 1.1, 0, Math.PI, 0);
    c.lineTo(cx + rx * 2.5, H + 2);
    c.lineTo(cx - rx * 2.5, H + 2);
    c.closePath();
    c.fill();
    const neck = c.createLinearGradient(0, cy + ry * 0.5, 0, cy + ry * 1.5);
    neck.addColorStop(0, '#9c6d52');
    neck.addColorStop(0.45, '#c3937a');
    neck.addColorStop(1, '#cf9f82');
    c.fillStyle = neck;
    c.beginPath();
    c.moveTo(cx - rx * 0.42, cy + ry * 0.4);
    c.lineTo(cx + rx * 0.42, cy + ry * 0.4);
    c.lineTo(cx + rx * 0.5, by - ry * 1.02);
    c.lineTo(cx, by - ry * 0.55);
    c.lineTo(cx - rx * 0.5, by - ry * 1.02);
    c.closePath();
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,.18)';
    c.lineWidth = ry * 0.035;
    c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(cx - rx * 0.55, by - ry * 1.0);
    c.lineTo(cx, by - ry * 0.5);
    c.lineTo(cx + rx * 0.55, by - ry * 1.0);
    c.stroke();

    // The head: features sit on an ellipsoid, so turning and nodding foreshorten them naturally.
    c.save();
    const px = cx;
    const py = cy + ry * 0.85;
    c.translate(px, py);
    c.rotate(roll);
    c.translate(-px, -py);
    const P = (a: number, b: number, d = 1) => {
      const la = a + yaw;
      const lb = b - pit;
      return { x: cx + rx * d * Math.sin(la) * Math.cos(lb), y: cy + ry * d * Math.sin(lb), vis: Math.cos(la) * Math.cos(lb) };
    };

    // Hair behind the head shows more on the side the face turns away from.
    const hairX = cx - rx * 0.16 * Math.sin(yaw);
    const hairFill = (): CanvasGradient => {
      const g = c.createRadialGradient(hairX - rx * 0.35, cy - ry * 0.8, rx * 0.05, hairX, cy - ry * 0.3, rx * 1.5);
      g.addColorStop(0, '#5a4430');
      g.addColorStop(1, '#1e160e');
      return g;
    };
    c.fillStyle = hairFill();
    c.beginPath();
    c.ellipse(hairX, cy - ry * 0.24, rx * 1.12, ry * 1.04, 0, 0, TAU);
    c.fill();

    const ear = (s: number): void => {
      const p = P(s * 1.5, 0.04, 1.03);
      if (p.vis < -0.3) return;
      const ew = rx * 0.15 * (0.55 + 0.45 * Math.max(0, p.vis));
      const eh = ry * 0.24;
      c.fillStyle = '#cf9c7d';
      c.beginPath();
      c.ellipse(p.x, p.y, ew, eh, 0, 0, TAU);
      c.fill();
      c.fillStyle = 'rgba(140,80,60,.45)';
      c.beginPath();
      c.ellipse(p.x + s * ew * 0.12, p.y, ew * 0.5, eh * 0.62, 0, 0, TAU);
      c.fill();
    };
    const nearEar = (s: number) => P(s * 1.5, 0.04).vis > 0.25;
    for (const s of [-1, 1]) if (!nearEar(s)) ear(s);

    // Head silhouette: rounded cranium, narrower jaw that follows the chin.
    const chinX = cx + rx * 0.2 * Math.sin(yaw);
    // Looking up brings the chin forward and up, shortening the face.
    const chinY = cy + (ry * Math.sin(1.4 - Math.max(0, pit))) / Math.sin(1.4);
    const headPath = (): void => {
      c.beginPath();
      c.moveTo(cx, cy - ry);
      c.bezierCurveTo(cx + rx * 0.58, cy - ry, cx + rx, cy - ry * 0.6, cx + rx, cy - ry * 0.05);
      c.bezierCurveTo(cx + rx, cy + ry * 0.42, chinX + rx * 0.46, chinY, chinX, chinY);
      c.bezierCurveTo(chinX - rx * 0.46, chinY, cx - rx, cy + ry * 0.42, cx - rx, cy - ry * 0.05);
      c.bezierCurveTo(cx - rx, cy - ry * 0.6, cx - rx * 0.58, cy - ry, cx, cy - ry);
      c.closePath();
    };
    c.save();
    headPath();
    c.clip();
    // Key light from the upper left; the brightest area follows the face as it turns.
    const hl = P(-0.3, -0.2);
    const skin = c.createRadialGradient(hl.x, hl.y, rx * 0.1, hl.x, hl.y, rx * 1.75);
    skin.addColorStop(0, '#f0c8a9');
    skin.addColorStop(0.55, '#dcab8b');
    skin.addColorStop(1, '#a06d55');
    c.fillStyle = skin;
    c.fillRect(cx - rx * 2, cy - ry * 2, rx * 4, ry * 4);

    const soft = (x: number, y: number, r: number, color: string, alpha: number, sy = 1): void => {
      if (alpha <= 0.005) return;
      const g = c.createRadialGradient(x, y / sy, 0, x, y / sy, r);
      g.addColorStop(0, color.replace('A', String(alpha)));
      g.addColorStop(1, color.replace('A', '0'));
      c.save();
      c.scale(1, sy);
      c.fillStyle = g;
      c.fillRect(x - r, y / sy - r, r * 2, r * 2);
      c.restore();
    };
    // Eye sockets, cheeks (rounder and rosier with a smile), shade under the nose and lip.
    for (const s of [-1, 1]) {
      const sock = P(s * 0.42, -0.2);
      if (sock.vis > 0) soft(sock.x, sock.y, rx * 0.3, 'rgba(110,60,45,A)', 0.2 * sock.vis, 0.7);
      const cheek = P(s * 0.5, 0.14 - 0.06 * smile);
      if (cheek.vis > 0) soft(cheek.x, cheek.y, rx * 0.36, 'rgba(222,118,108,A)', (0.1 + 0.2 * smile) * cheek.vis, 0.8);
    }

    // Eyes.
    for (const s of [-1, 1]) {
      const p = P(s * 0.42, -0.17);
      if (p.vis < 0.12) continue;
      const k = Math.min(1, p.vis * 1.1);
      const ew = rx * 0.3 * k;
      const open = eyeOpen * (1 - 0.3 * smile);
      const eh = ry * 0.07 * open;
      const L = p.x - ew / 2;
      const R = p.x + ew / 2;
      const y = p.y;
      if (eh > 0.8) {
        c.save();
        c.beginPath();
        c.moveTo(L, y);
        c.quadraticCurveTo(p.x, y - eh * 2, R, y);
        c.quadraticCurveTo(p.x, y + eh * 1.5, L, y);
        c.closePath();
        c.fillStyle = '#f3eee9';
        c.fill();
        c.clip();
        // The eyes keep looking at the camera while the head moves.
        const ir = ry * 0.052;
        const ix = p.x - ew * 0.2 * Math.sin(yaw);
        const iy = y - eh * 0.15 + ry * 0.03 * Math.sin(pit);
        const iris = c.createRadialGradient(ix, iy, ir * 0.2, ix, iy, ir);
        iris.addColorStop(0, '#8a5d3c');
        iris.addColorStop(1, '#3a2415');
        c.fillStyle = iris;
        c.beginPath();
        c.ellipse(ix, iy, ir * k, ir, 0, 0, TAU);
        c.fill();
        c.fillStyle = '#100a06';
        c.beginPath();
        c.ellipse(ix, iy, ir * 0.45 * k, ir * 0.45, 0, 0, TAU);
        c.fill();
        c.fillStyle = 'rgba(255,255,255,.92)';
        c.beginPath();
        c.arc(ix - ir * 0.32, iy - ir * 0.34, ir * 0.17, 0, TAU);
        c.fill();
        c.fillStyle = 'rgba(70,40,25,.22)';
        c.fillRect(L, y - eh * 2, ew, eh * 0.75);
        c.restore();
      }
      c.lineCap = 'round';
      c.strokeStyle = '#2c1d14';
      c.lineWidth = Math.max(2, ry * 0.018);
      c.beginPath();
      c.moveTo(L - ew * 0.05, y + ry * 0.004);
      c.quadraticCurveTo(p.x, y - eh * 2 + ry * 0.03 * (1 - open), R + ew * 0.05, y);
      c.stroke();
      c.strokeStyle = 'rgba(120,72,52,.4)';
      c.lineWidth = Math.max(1, ry * 0.008);
      c.beginPath();
      c.moveTo(L + ew * 0.12, y - eh * 1.3 - ry * 0.03);
      c.quadraticCurveTo(p.x, y - eh * 2 - ry * 0.055, R - ew * 0.04, y - ry * 0.035);
      c.stroke();
    }

    // Brows.
    c.strokeStyle = '#38261a';
    for (const s of [-1, 1]) {
      const m = P(s * 0.42, -0.4 - 0.02 * smile);
      if (m.vis < 0.1) continue;
      const a = P(s * 0.18, -0.34);
      const o = P(s * 0.66, -0.35);
      c.lineWidth = ry * 0.032 * (0.5 + 0.5 * m.vis);
      c.beginPath();
      c.moveTo(a.x, a.y);
      c.quadraticCurveTo(2 * m.x - (a.x + o.x) / 2, 2 * m.y - (a.y + o.y) / 2, o.x, o.y);
      c.stroke();
    }

    // Nose: the tip sits in front of the face, so it swings further than the base.
    const root = P(0, -0.12);
    const tip = P(0, 0.17, 1.17);
    const base = P(0, 0.2);
    soft(tip.x + rx * 0.05, base.y + ry * 0.05, rx * 0.16, 'rgba(110,58,40,A)', 0.3, 0.45);
    c.strokeStyle = 'rgba(150,90,64,.5)';
    c.lineWidth = Math.max(1.5, ry * 0.012);
    c.beginPath();
    c.moveTo(root.x + rx * 0.05, root.y);
    c.quadraticCurveTo(root.x + rx * 0.07 + (tip.x - root.x) * 0.3, (root.y + tip.y) / 2, tip.x + rx * 0.07, tip.y - ry * 0.01);
    c.stroke();
    c.fillStyle = 'rgba(85,42,32,.55)';
    for (const s of [-1, 1]) {
      const n = P(s * 0.075, 0.205, 1.08);
      if (n.vis < 0.15) continue;
      c.beginPath();
      c.ellipse(n.x, n.y, rx * 0.045 * n.vis, ry * 0.017, s * 0.3, 0, TAU);
      c.fill();
    }
    soft(tip.x - rx * 0.03, tip.y - ry * 0.035, rx * 0.06, 'rgba(255,236,222,A)', 0.45);

    // Mouth: the corners rise and widen with a smile, which parts the lips over the teeth.
    const cornerB = 0.36 - 0.06 * smile;
    const lc = P(-0.33 - 0.08 * smile, cornerB, 1.02);
    const rc = P(0.33 + 0.08 * smile, cornerB, 1.02);
    const mc = P(0, 0.37, 1.06);
    const gap = ry * 0.07 * smile;
    c.fillStyle = '#b05d57';
    c.beginPath();
    c.moveTo(lc.x, lc.y);
    c.bezierCurveTo((lc.x + mc.x) / 2, mc.y - ry * 0.055, (mc.x + rc.x) / 2, mc.y - ry * 0.055, rc.x, rc.y);
    c.quadraticCurveTo(mc.x, mc.y + ry * 0.075 + gap * 1.5, lc.x, lc.y);
    c.fill();
    if (gap > 1) {
      c.save();
      c.beginPath();
      c.moveTo(lc.x, lc.y);
      c.quadraticCurveTo(mc.x, mc.y + ry * 0.004, rc.x, rc.y);
      c.quadraticCurveTo(mc.x, mc.y + gap * 1.6, lc.x, lc.y);
      c.fillStyle = '#4a1a1c';
      c.fill();
      c.clip();
      c.fillStyle = '#f4efe7';
      c.fillRect(Math.min(lc.x, rc.x), mc.y - ry * 0.03, Math.abs(rc.x - lc.x), gap * 0.75 + ry * 0.03);
      c.restore();
    }
    c.strokeStyle = '#6a2c29';
    c.lineWidth = Math.max(1.5, ry * 0.012);
    c.beginPath();
    c.moveTo(lc.x, lc.y);
    c.quadraticCurveTo(mc.x, mc.y + (gap > 1 ? ry * 0.004 : ry * 0.018), rc.x, rc.y);
    c.stroke();
    soft(mc.x, mc.y + ry * 0.045 + gap, rx * 0.1, 'rgba(255,220,210,A)', 0.25, 0.4);
    if (smile > 0.05) {
      c.strokeStyle = `rgba(130,70,50,${0.3 * smile})`;
      c.lineWidth = ry * 0.01;
      for (const s of [-1, 1]) {
        const a = P(s * 0.2, 0.12);
        const b = P(s * 0.4, 0.38);
        if (a.vis < 0.1) continue;
        c.beginPath();
        c.moveTo(a.x, a.y);
        c.quadraticCurveTo(a.x + s * rx * 0.1, (a.y + b.y) / 2, b.x, b.y);
        c.stroke();
      }
    }

    // Fringe: the hairline moves with the head.
    const line = P(0, -0.72);
    c.fillStyle = hairFill();
    c.beginPath();
    c.ellipse(cx - rx * 0.22 * Math.sin(yaw), line.y - ry * 0.42, rx * 1.35, ry * 0.5, -0.12, 0, TAU);
    c.fill();
    c.restore(); // head clip

    for (const s of [-1, 1]) if (nearEar(s)) ear(s);
    c.restore(); // roll
  }

  // ---------- document ----------
  const aspect = scene === 'A4' ? 0.707 : scene === 'PASSPORT' ? 1.42 : 1.586;
  let docW = W * 0.86;
  let docH = docW / aspect;
  if (docH > H * 0.86) {
    docH = H * 0.86;
    docW = docH * aspect;
  }
  const faces: Partial<Record<'front' | 'back', HTMLCanvasElement>> = {};
  const [layer, lctx] = portrait ? [null, null] : makeCanvas(W, H);
  const card = {
    rot: new Spring(0, 6.5),
    scale: new Spring(1, 6),
    x: new Spring(0, 5.5),
    y: new Spring(0, 5.5),
    alpha: new Spring(1, 7),
  };
  let docStarted = false;
  let flipAt = 0;

  function cardFace(which: 'front' | 'back'): HTMLCanvasElement {
    const cached = faces[which];
    if (cached) return cached;
    const w = docW;
    const h = docH;
    const [cv, c] = makeCanvas(w, h);
    faces[which] = cv;
    if (!c) return cv;
    roundRect(c, 0, 0, w, h, scene === 'A4' ? 4 : h * 0.05);
    c.clip();
    if (scene === 'A4') {
      c.fillStyle = '#fbfbf8';
      c.fillRect(0, 0, w, h);
      c.fillStyle = '#1554f0';
      c.fillRect(w * 0.08, h * 0.05, w * 0.84, h * 0.05);
      textLines(c, w * 0.08, h * 0.15, w * 0.84, 22, h * 0.035);
      return cv;
    }
    if (scene === 'PASSPORT') {
      const g = c.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#f4efe3');
      g.addColorStop(1, '#e6dcc8');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      guilloche(c, w, h, 'rgba(150,118,78,.13)');
      drawPortrait(c, w * 0.05, h * 0.12, w * 0.26, h * 0.5);
      textLines(c, w * 0.36, h * 0.12, w * 0.55, 6, h * 0.085);
      c.fillStyle = 'rgba(255,255,255,.5)';
      c.fillRect(0, h * 0.77, w, h * 0.23);
      mrz(c, w * 0.04, h * 0.81, w * 0.92, 2, h * 0.08);
      return cv;
    }
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#eef5f2');
    g.addColorStop(1, '#d9e7e2');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    guilloche(c, w, h, 'rgba(80,140,118,.14)');
    const band = c.createLinearGradient(0, 0, w, 0);
    band.addColorStop(0, '#6a9e8b');
    band.addColorStop(1, '#93c0ae');
    c.fillStyle = band;
    c.fillRect(0, h * 0.04, w, h * 0.12);
    c.fillStyle = 'rgba(255,255,255,.85)';
    roundRect(c, w * 0.05, h * 0.075, w * 0.3, h * 0.03, h * 0.01);
    c.fill();
    roundRect(c, w * 0.62, h * 0.075, w * 0.33, h * 0.03, h * 0.01);
    c.fill();
    if (which === 'front') {
      c.strokeStyle = 'rgba(80,140,118,.2)';
      c.lineWidth = h * 0.006;
      for (const r of [0.26, 0.2, 0.14]) {
        c.beginPath();
        c.arc(w * 0.72, h * 0.6, h * r, 0, TAU);
        c.stroke();
      }
      drawPortrait(c, w * 0.05, h * 0.24, w * 0.24, h * 0.6);
      textLines(c, w * 0.35, h * 0.28, w * 0.55, 6, h * 0.1);
      c.globalAlpha = 0.2;
      drawPortrait(c, w * 0.84, h * 0.62, w * 0.1, h * 0.26);
      c.globalAlpha = 1;
    } else {
      const chip = c.createLinearGradient(w * 0.06, h * 0.24, w * 0.19, h * 0.41);
      chip.addColorStop(0, '#f1d58a');
      chip.addColorStop(0.5, '#c9a24c');
      chip.addColorStop(1, '#e8c874');
      c.fillStyle = chip;
      roundRect(c, w * 0.06, h * 0.24, w * 0.13, h * 0.17, h * 0.025);
      c.fill();
      c.strokeStyle = 'rgba(110,80,25,.55)';
      c.lineWidth = h * 0.004;
      c.beginPath();
      c.moveTo(w * 0.06, h * 0.325);
      c.lineTo(w * 0.19, h * 0.325);
      c.moveTo(w * 0.125, h * 0.24);
      c.lineTo(w * 0.125, h * 0.41);
      c.moveTo(w * 0.09, h * 0.24);
      c.lineTo(w * 0.09, h * 0.41);
      c.moveTo(w * 0.16, h * 0.24);
      c.lineTo(w * 0.16, h * 0.41);
      c.stroke();
      textLines(c, w * 0.25, h * 0.25, w * 0.5, 4, h * 0.09);
      c.fillStyle = 'rgba(255,255,255,.55)';
      c.fillRect(0, h * 0.64, w, h * 0.36);
      mrz(c, w * 0.05, h * 0.68, w * 0.9, 3, h * 0.09);
    }
    return cv;
  }

  function drawDocument(c: Ctx, t: number, dt: number): void {
    c.drawImage(backdrop, 0, 0);
    if (!layer || !lctx) return;
    if (!docStarted) {
      docStarted = true;
      if (side === 'back') {
        // The back is captured right after the front: show the front briefly, then turn the card over.
        flipAt = t + 450;
      } else {
        // The card glides in and settles.
        card.rot.x = -0.6;
        card.scale.x = 0.82;
        card.x.x = docW * 0.14;
        card.y.x = docH * 0.12;
        card.alpha.x = 0;
      }
    }
    const rot = card.rot.step((side === 'back' && t >= flipAt ? Math.PI : 0) + 0.035 * Math.sin(t / 1500), dt);
    // Lifted towards the camera mid-flip.
    const lift = Math.max(0, Math.sin(clamp(rot, 0, Math.PI)));
    const s = card.scale.step(1, dt) * (1 + 0.08 * lift);
    const ox = card.x.step(Math.sin(t / 1100) * 3, dt);
    const oy = card.y.step(Math.sin(t / 1700) * 2, dt) - lift * docH * 0.05;
    const alpha = clamp(card.alpha.step(1, dt), 0, 1);
    const showBack = Math.cos(rot) < 0;
    const a = showBack ? rot - Math.PI : rot;
    const tex = cardFace(showBack && scene === 'ID_CARD' ? 'back' : 'front');

    const w = docW * s;
    const h = docH * s;
    const ccx = W / 2 + ox;
    const ccy = H / 2 + oy;
    const focal = w * 2.2;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const proj = (u: number) => {
      const lx = (u - 0.5) * w;
      const k = focal / (focal + lx * sa);
      return { x: ccx + lx * ca * k, k };
    };
    const p0 = proj(0);
    const p1 = proj(1);

    // Shadow on the table (drawn off-canvas so only the shadow lands).
    const off = W * 4;
    c.save();
    c.shadowColor = `rgba(0,0,0,${(0.55 - 0.2 * lift) * alpha})`;
    c.shadowBlur = 26 + 60 * lift;
    c.shadowOffsetX = off + 8 + 24 * lift;
    c.shadowOffsetY = 18 + 70 * lift;
    c.fillStyle = '#000';
    c.beginPath();
    c.moveTo(p0.x - off, ccy - (h * p0.k) / 2);
    c.lineTo(p1.x - off, ccy - (h * p1.k) / 2);
    c.lineTo(p1.x - off, ccy + (h * p1.k) / 2);
    c.lineTo(p0.x - off, ccy + (h * p0.k) / 2);
    c.closePath();
    c.fill();
    c.restore();

    // The card in perspective, rotating about its vertical axis: drawn as thin vertical slices.
    const l = lctx;
    l.globalCompositeOperation = 'source-over';
    l.clearRect(0, 0, W, H);
    const thick = docW * 0.012 * Math.abs(sa);
    if (thick > 0.5) {
      const near = sa > 0 ? p0 : p1;
      const ex = sa > 0 ? near.x - thick * near.k : near.x;
      l.fillStyle = '#aab8b3';
      roundRect(l, ex, ccy - (h * near.k) / 2 + 3, thick * near.k, h * near.k - 6, Math.min(4, thick * near.k / 2));
      l.fill();
    }
    const N = 120;
    const sw = tex.width / N;
    let prev = p0;
    for (let i = 0; i < N; i++) {
      const next = proj((i + 1) / N);
      const sh = (h * (prev.k + next.k)) / 2;
      l.drawImage(tex, i * sw, 0, sw, tex.height, prev.x, ccy - sh / 2, Math.max(0.5, next.x - prev.x) + 0.75, sh);
      prev = next;
    }
    // Lighting: darker when turned away from the light, plus a glossy band sweeping across the laminate.
    l.globalCompositeOperation = 'source-atop';
    l.fillStyle = `rgba(12,20,26,${0.5 * (1 - ca)})`;
    l.fillRect(0, 0, W, H);
    const band = 0.5 + sa * 1.8;
    if (band > -0.3 && band < 1.3) {
      const g = l.createLinearGradient(p0.x, ccy - h / 2, p1.x, ccy + h / 2);
      g.addColorStop(clamp(band - 0.22, 0, 1), 'rgba(255,255,255,0)');
      g.addColorStop(clamp(band, 0, 1), `rgba(255,255,255,${0.12 + 0.2 * lift})`);
      g.addColorStop(clamp(band + 0.22, 0, 1), 'rgba(255,255,255,0)');
      l.fillStyle = g;
      l.fillRect(0, 0, W, H);
    }
    c.save();
    c.globalAlpha = alpha;
    c.drawImage(layer, 0, 0);
    c.restore();
  }

  const draw = (): void => {
    if (!ctx) return;
    const t = performance.now() - started;
    const dt = lastFrame < 0 ? 0 : clamp((t - lastFrame) / 1000, 0, 0.1);
    lastFrame = t;
    if (portrait) drawFace(ctx, t, dt);
    else drawDocument(ctx, t, dt);
    ctx.drawImage(vignette, 0, 0);
  };

  const provider: StreamProvider = async () => {
    if (!ctx || typeof canvas.captureStream !== 'function') {
      throw Object.assign(new Error('Simulated camera is not supported in this browser'), { name: 'NotFoundError' });
    }
    draw();
    timer ??= setInterval(draw, 1000 / FPS);
    stream = canvas.captureStream(FPS);
    const track = stream.getVideoTracks()[0];
    // Advertise a plausible facing mode so the UI mirrors the selfie preview.
    const settings = track.getSettings.bind(track);
    track.getSettings = () => ({ ...settings(), width: W, height: H, facingMode: portrait ? 'user' : 'environment', deviceId: 'simulated' });
    Object.defineProperty(track, 'label', { value: 'Simulated camera' });
    return stream;
  };

  return {
    provider,
    setFaceScale: (s) => { targetScale = s; },
    setSide: (s) => { side = s; },
    setPose: (p) => { pose = p; },
    stop: () => {
      if (timer) clearInterval(timer);
      timer = null;
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    },
  };
}

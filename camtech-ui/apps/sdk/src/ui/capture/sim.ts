// The simulated camera (src/sim) only exists in development and mock builds (see simulateMode in main.tsx and
// mount.tsx). It is loaded on demand with import(); in production builds SIM_AVAILABLE is a compile-time `false`,
// so the import() and the whole sim module are dropped from the bundle.
import type * as Sim from '../../sim';

export type SimKit = typeof Sim;

export const SIM_AVAILABLE: boolean = import.meta.env.DEV || import.meta.env.VITE_USE_MOCKS === 'true';

let kit: SimKit | null = null;
let pending: Promise<SimKit> | null = null;

export function loadSim(): Promise<SimKit> {
  if (!SIM_AVAILABLE) return Promise.reject(new Error('camtech: the simulated camera is not part of this build'));
  pending ??= import('../../sim').then((m) => (kit = m));
  return pending;
}

/** The loaded sim module. Set before any SimulatedCamera exists (useCamera only makes one after loadSim()). */
export function loadedSim(): SimKit | null {
  return kit;
}

// Everything the simulated camera needs, as one module: loaded with import() by ui/capture/sim.ts so that
// production builds do not contain it.
export * from './scripted';
export * from './simulated-camera';

import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';

// Library build of the embed loader: dist-lib/camtech-sdk.js (IIFE, global `Camtech`) and camtech-sdk.mjs (ESM).
// MediaPipe is not bundled: it is imported at runtime from the CDN that also serves its wasm (keeps the file small).
const MEDIAPIPE_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.0.1/vision_bundle.mjs';

function mediapipeFromCdn(): Plugin {
  return {
    name: 'camtech-mediapipe-cdn',
    enforce: 'pre',
    resolveId(id) {
      if (id === '@mediapipe/tasks-vision') return { id: MEDIAPIPE_URL, external: true };
      return null;
    },
  };
}

export default defineConfig({
  plugins: [mediapipeFromCdn(), react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'dist-lib',
    emptyOutDir: true,
    target: 'es2020',
    sourcemap: true,
    copyPublicDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/embed.ts'),
      name: 'Camtech',
      formats: ['iife', 'es'],
      fileName: (format) => (format === 'es' ? 'camtech-sdk.mjs' : 'camtech-sdk.js'),
    },
    // Both files stay single, self-contained scripts (integrators load them from one fixed URL): the import()s of
    // the UI (embed.ts â†’ mount, App.tsx â†’ flows) are inlined. Only the hosted page (vite.config.ts) is split.
    rolldownOptions: {
      output: { codeSplitting: false },
    },
  },
});

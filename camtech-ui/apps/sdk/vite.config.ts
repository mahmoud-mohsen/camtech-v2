import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Hosted page (index.html). `npm run dev:mock` uses .env.mock (VITE_USE_MOCKS=true).
export default defineConfig({
  plugins: [react()],
  server: { port: 5175, strictPort: true },
  preview: { port: 5175 },
  build: {
    outDir: 'dist',
    target: 'es2020',
    sourcemap: true,
    chunkSizeWarningLimit: 600,
  },
});

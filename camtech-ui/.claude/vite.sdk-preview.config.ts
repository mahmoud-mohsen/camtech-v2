// Local preview only: the SDK in mock mode on its own port, next to the dev server on 5175.
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('../apps/sdk', import.meta.url));

export default defineConfig({
  root,
  envDir: root,
  plugins: [react()],
  server: { port: 5185, strictPort: true },
});

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const nm = (pkgs: string) => new RegExp(`[\\/]node_modules[\\/](${pkgs})[\\/]`);

export default defineConfig({
  plugins: [react()],
  server: { port: 5174, strictPort: true },
  preview: { port: 5174 },
  build: {
    chunkSizeWarningLimit: 700,
    rolldownOptions: {
      output: {
        // Third-party code in stable, long-cached vendor chunks (an app deploy does not change their hashes).
        // Higher priority groups claim their modules first. vendor-antd only takes the antd code the shell needs
        // at start-up ($initial); components used by lazy pages only (table, date picker…) stay with those pages.
        // vendor-charts (recharts and the d3 / redux code only it uses) is loaded with the overview page.
        codeSplitting: {
          groups: [
            { name: 'vendor-react', test: nm('react|react-dom|scheduler|react-router|react-router-dom|cookie|set-cookie-parser'), priority: 40 },
            { name: 'vendor-query', test: nm('@tanstack'), priority: 30 },
            { name: 'vendor-antd', test: nm('antd|@ant-design|@rc-component|@babel|dayjs|clsx|throttle-debounce|scroll-into-view-if-needed|compute-scroll-into-view|stylis|@emotion'), tags: ['$initial'], priority: 20 },
            { name: 'vendor-charts', test: nm('recharts|victory-vendor|d3-[^\\/]+|internmap|@reduxjs|redux|redux-thunk|react-redux|reselect|immer|decimal\\.js-light|eventemitter3|es-toolkit|tiny-invariant|use-sync-external-store'), priority: 10 },
          ],
        },
      },
    },
  },
});

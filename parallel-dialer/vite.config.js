import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * The dev server proxies the control plane to the Express backend so the
 * browser sees one origin. That matters for the SSE activity feed, which
 * otherwise trips CORS preflight on every reconnect.
 */
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});

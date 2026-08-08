import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    // The editor records component-level startup timings in production. The
    // separate game runtime config keeps using React's standard production build.
    alias: { 'react-dom/client': 'react-dom/profiling' },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        desktop: fileURLToPath(new URL('./desktop.html', import.meta.url)),
      },
    },
  },
});

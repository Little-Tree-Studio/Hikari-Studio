import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  define: {
    'process.env.NODE_ENV': JSON.stringify('production'),
  },
  build: {
    outDir: 'runtime-dist',
    emptyOutDir: true,
    cssCodeSplit: false,
    lib: {
      entry: fileURLToPath(new URL('./src/runtime/main.tsx', import.meta.url)),
      name: 'SlideGameRuntime',
      formats: ['iife'],
      fileName: () => 'player.js',
    },
    rollupOptions: {
      output: { assetFileNames: (asset) => asset.name?.endsWith('.css') ? 'player.css' : 'assets/[name]-[hash][extname]' },
    },
  },
});

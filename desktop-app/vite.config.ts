import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { resolve } from 'node:path';

export default defineConfig({
  base: './',
  root: resolve(__dirname, 'src/renderer'),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(__dirname, 'dist-renderer'),
    emptyOutDir: false
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true
  }
});

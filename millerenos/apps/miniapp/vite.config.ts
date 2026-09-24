import preact from '@preact/preset-vite';
import { defineConfig } from 'vite';

export default defineConfig({
  base: '/app/',
  plugins: [preact()],
  build: { target: 'es2020', sourcemap: false, cssCodeSplit: false, assetsInlineLimit: 4096 },
  server: { proxy: { '/api': 'http://localhost:8080' } },
});

import { defineConfig } from 'vite';

// GitHub Pages serves under /deja-boo/; the workflow sets DEJA_BOO_BASE. Locally the base is '/'.
export default defineConfig({
  base: process.env['DEJA_BOO_BASE'] ?? '/',
  server: { fs: { allow: ['..'] } },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2022' },
});

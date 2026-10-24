import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  envDir: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [react()],
  // Keep this app independent of any parent project's PostCSS/Tailwind setup.
  css: { postcss: { plugins: [] } },
  server: { port: 5175, strictPort: true },
  build: { outDir: 'dist', emptyOutDir: true },
});

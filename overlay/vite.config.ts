import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));

// Builds the React overlay renderer into renderer-dist/ for file:// loading in
// Electron. Reuses the web app's ddragon helpers via the @web alias.
export default defineConfig({
  root: path.join(dir, 'renderer'),
  base: './',
  plugins: [react()],
  resolve: { alias: { '@web': path.join(dir, '../web/src') } },
  build: {
    outDir: path.join(dir, 'renderer-dist'),
    emptyOutDir: true,
    rollupOptions: { input: path.join(dir, 'renderer/overlay.html') },
  },
});

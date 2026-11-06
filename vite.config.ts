import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: { host: '127.0.0.1', port: 1420, strictPort: true },
  preview: {
    headers: {
      'Content-Security-Policy':
        "default-src 'self'; script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'self'",
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  optimizeDeps: { include: ['@mlightcad/libredwg-web'] },
  build: { target: ['es2022', 'safari15'], chunkSizeWarningLimit: 850 },
  worker: { format: 'es' },
  test: { include: ['tests/**/*.test.ts'] },
});

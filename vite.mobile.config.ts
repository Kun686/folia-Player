import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// vite.mobile.config.ts — bundled assets only; no remote app code or service worker.
export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  define: { __APP_VERSION__: JSON.stringify('0.7.16-mobile.2'), __APP_VERSION_LABEL__: JSON.stringify('0.7.16-mobile.2'),
    __APP_RELEASE_CHANNEL__: JSON.stringify('development'), __BUILD_COMMIT__: JSON.stringify('d824c0b'), __BUILD_REPO__: JSON.stringify('chthollyphile/folia-major') },
  build: { target: 'safari17', outDir: 'dist-mobile', rollupOptions: { input: 'mobile.html' } },
});

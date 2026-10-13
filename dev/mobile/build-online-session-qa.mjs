import { build } from 'vite';
import { fileURLToPath } from 'node:url';

// build-online-session-qa.mjs — same Vite QA packaging pattern as the existing native connection tests.
await build({
  configFile: false, root: fileURLToPath(new URL('../../', import.meta.url)), publicDir: false,
  resolve: { alias: { '@': fileURLToPath(new URL('../../src', import.meta.url)) } },
  build: {
    target: 'safari17', outDir: '.mobile-test-results/native-logout/qa-assets', emptyOutDir: true,
    lib: { entry: 'dev/mobile/online-session-qa.ts', name: 'FoliaOnlineSessionQA', formats: ['iife'],
      fileName: () => 'online-session-qa.js' },
  },
});

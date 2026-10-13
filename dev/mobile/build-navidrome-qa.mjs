import { build } from 'vite';
import { fileURLToPath } from 'node:url';

// build-navidrome-qa.mjs — bundle the actual mobile connection for isolated WKWebView/native integration tests only.
await build({
  configFile: false, root: fileURLToPath(new URL('../../', import.meta.url)), publicDir: false,
  build: {
    target: 'safari17', outDir: '.mobile-test-results/navidrome-shared/qa-assets', emptyOutDir: true,
    lib: { entry: 'src/mobile/navidromeConnection.ts', name: 'FoliaNavidromeQA', formats: ['iife'],
      fileName: () => 'navidrome-connection-qa.js' },
  },
});

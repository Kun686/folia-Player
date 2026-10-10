import { build } from 'vite';
import { fileURLToPath } from 'node:url';

// build-transitions.mjs — trusted local planner code, separate from React and WKWebView execution.
const root = fileURLToPath(new URL('../../', import.meta.url));
await build({
  configFile: false, root, publicDir: false,
  build: {
    target: 'safari17', outDir: 'dist-mobile/native', emptyOutDir: true,
    lib: { entry: 'src/services/automix/nativeRuntime.ts', name: 'FoliaTransitions', formats: ['iife'], fileName: () => 'transitions.js' },
  },
});
await build({
  configFile: false, root, publicDir: false,
  build: {
    target: 'safari17', outDir: 'dist-mobile/native', emptyOutDir: false,
    lib: { entry: 'src/services/automix/nativeProfileRuntime.ts', name: 'FoliaProfiles', formats: ['iife'], fileName: () => 'profiles.js' },
  },
});

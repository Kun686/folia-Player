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
await build({
  configFile: false, root, publicDir: false,
  build: {
    target: 'safari17', outDir: 'dist-mobile/native', emptyOutDir: false,
    lib: { entry: 'src/services/automix/nativeDeckRuntime.ts', name: 'FoliaDeck', formats: ['iife'], fileName: () => 'deck.js' },
  },
});
await build({
  configFile: false, root, publicDir: false,
  // JavaScriptCore has no console; raw lyric diagnostics must not leave the isolated parser.
  esbuild: { drop: ['console'] },
  build: {
    target: 'safari17', outDir: 'dist-mobile/native', emptyOutDir: false,
    lib: { entry: 'src/utils/lyrics/nativeLocalRuntime.ts', name: 'FoliaLocalLyrics', formats: ['iife'], fileName: () => 'lyrics.js' },
  },
});

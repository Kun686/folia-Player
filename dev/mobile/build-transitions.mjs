import { build } from 'vite';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

// build-transitions.mjs — trusted local planner code, separate from React and WKWebView execution.
const root = fileURLToPath(new URL('../../', import.meta.url));
// The isolated metadata bridge reuses internal entry points; review them explicitly on library upgrades.
const metadataPackage = JSON.parse(await readFile(new URL('../../node_modules/music-metadata/package.json', import.meta.url), 'utf8'));
if (metadataPackage.version !== '11.16.1') throw new Error('Review native metadata decoding before upgrading music-metadata from 11.16.1');
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
    lib: { entry: 'src/services/onlineMusic/nativeLyricRuntime.ts', name: 'FoliaLocalLyrics', formats: ['iife'], fileName: () => 'lyrics.js' },
    license: { fileName: 'metadata-licenses.md' },
    // uint8array-extras eagerly creates unused UTF-8 codecs. Drop unused constructors, retaining its numeric helpers.
    // Used decoders remain; music-metadata's text-codec supplies its own UTF fallbacks in bare JavaScriptCore.
    rolldownOptions: { treeshake: { manualPureFunctions: ['globalThis.TextDecoder', 'globalThis.TextEncoder'] } },
  },
});
await build({
  configFile: false, root, publicDir: false,
  build: {
    target: 'safari17', outDir: 'dist-mobile/native', emptyOutDir: false,
    lib: { entry: 'src/mobile/nativeLibraryRuntime.ts', name: 'FoliaLibrary', formats: ['iife'], fileName: () => 'library.js' },
  },
});
await build({
  configFile: false, root, publicDir: false,
  build: {
    target: 'safari17', outDir: 'dist-mobile/native', emptyOutDir: false,
    lib: { entry: 'src/mobile/nativeFolderRuntime.ts', name: 'FoliaFolders', formats: ['iife'], fileName: () => 'folders.js' },
  },
});

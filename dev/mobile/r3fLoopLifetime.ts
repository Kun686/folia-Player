import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { Plugin } from 'vite';

// r3fLoopLifetime.ts — narrowly scope R3F frame scratch references in mobile builds; preserve upstream rendering and licensing.
const require = createRequire(import.meta.url);
const sourceName = 'events-9ce18a08.esm.js';
const sourceSha256 = '0f2563472e4f3c6a4691e01d22358f15db9adeb750c366ab53ed84989ecec755';
const scopeEdits = [
  ['let subscribers;\nlet subscription;\nfunction update(timestamp, state, frame) {',
    'function update(timestamp, state, frame) {\n  let subscribers;\n  let subscription;'],
  ['let state;\nfunction loop(timestamp) {', 'function loop(timestamp) {\n  let state;'],
] as const;

// The exact vendor source is pinned: an upgrade must be reviewed, never silently patched or left unprotected.
export function scopeR3fFrameReferences(source: string): string {
  if (createHash('sha256').update(source).digest('hex') !== sourceSha256) {
    throw new Error('Folia mobile R3F lifetime patch: vendor source changed; review the patch before building.');
  }
  for (const [before, after] of scopeEdits) {
    if (source.split(before).length !== 2) throw new Error('Folia mobile R3F lifetime patch: unexpected frame-loop structure.');
    source = source.replace(before, after);
  }
  return source;
}

export function r3fLoopLifetimePlugin(): Plugin {
  const packagePath = require.resolve('@react-three/fiber/package.json');
  const sourcePath = join(dirname(packagePath), 'dist', sourceName).replaceAll('\\', '/');
  let applied = false;
  return {
    name: 'folia-mobile-r3f-loop-lifetime', enforce: 'pre', apply: 'build',
    buildStart() {
      applied = false;
      const { version } = JSON.parse(readFileSync(packagePath, 'utf8')) as { version: string };
      if (version !== '9.8.1') throw new Error('Folia mobile R3F lifetime patch requires reviewed @react-three/fiber 9.8.1.');
    },
    transform(source, id) {
      if (id.split('?')[0].replaceAll('\\', '/') !== sourcePath) return null;
      const code = scopeR3fFrameReferences(source);
      applied = true;
      return { code, map: null };
    },
    generateBundle() {
      if (!applied) throw new Error('Folia mobile R3F lifetime patch was not applied; review the renderer build entry.');
    },
  };
}

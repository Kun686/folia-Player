import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { normalizeBuildCommit, resolveBuildRepo } from './dev/build/buildIdentity.mjs';

// vite.mobile.config.ts — bundled assets only; no remote app code or service worker.
const root = fileURLToPath(new URL('.', import.meta.url));
const project = readFileSync(new URL('./ios/App/App.xcodeproj/project.pbxproj', import.meta.url), 'utf8');
function nativeVersion(key: string): string {
  const values = new Set([...project.matchAll(new RegExp(`${key} = ([0-9.]+);`, 'g'))].map(match => match[1]));
  if (values.size !== 1) throw new Error(`Inconsistent native ${key}`);
  return [...values][0];
}
const version = `${nativeVersion('MARKETING_VERSION')}-mobile.${nativeVersion('CURRENT_PROJECT_VERSION')}`;
function git(...args: string[]): string {
  try { return execFileSync('git', args, { cwd: root, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
  catch { return ''; }
}
const commit = normalizeBuildCommit(process.env.GITHUB_SHA || git('rev-parse', 'HEAD'));
const repository = resolveBuildRepo(process.env, () => git('remote', 'get-url', 'origin'));
export default defineConfig({
  plugins: [react(), {
    name: 'folia-mobile-build-identity',
    generateBundle() {
      // Keep provenance even when the optimizer removes all consumers of a build constant.
      this.emitFile({ type: 'asset', fileName: 'build-identity.json',
        source: JSON.stringify({ version, commit, repository }) + '\n' });
    },
  }],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  // Scan the mobile entry and lazy animation dependencies before serving the first test/page.
  // Discovering them during a blend otherwise reloads the development WebView and loses its state.
  optimizeDeps: { entries: ['mobile.html'], include: ['animejs', '@paper-design/shaders-react'] },
  server: { watch: { ignored: ['**/ios/**', '**/dist-mobile/**', '**/.mobile-test-results/**'] } },
  define: { __APP_VERSION__: JSON.stringify(version), __APP_VERSION_LABEL__: JSON.stringify(version),
    __APP_RELEASE_CHANNEL__: JSON.stringify('development'), __BUILD_COMMIT__: JSON.stringify(commit), __BUILD_REPO__: JSON.stringify(repository) },
  build: { target: 'safari17', outDir: 'dist-mobile', rollupOptions: { input: 'mobile.html' } },
});

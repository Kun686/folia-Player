import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// patch-qq-search.mjs — reuse the pinned library's private authentication/RPC implementation without copying credentials rules.
export function patchQqSearch(source) {
  const marker = '    async getUserDetail(token) {';
  if (source.split(marker).length !== 2 || source.includes('async mobileSearchSongs(')) throw new Error('Unexpected QQ service layout');
  return source.replace(marker, `    // Folia mobile: a fixed search RPC through the existing session and device transport.
    async mobileSearchSongs(token, param, signal) {
        const auth = await this.authFor(token);
        if (!auth) return null;
        // Keep this request's cookie jar isolated from earlier profile/login calls and other accounts.
        const client = this.createSessionHttp();
        const http = { post: (url, data, options) => client.post(url, data, {
            ...options, signal, timeout: 12000, maxContentLength: 8388608, maxBodyLength: 262144
        }) };
        return callMusicu(http, auth.device, 'mobile-search-songs', 'music.search.SearchCgiService',
            'DoSearchForQQMusicLite', param, auth.credential);
    }
${marker}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('@yakult-green-tea/qq-music-api/package.json'));
  if (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version !== '3.1.4') throw new Error('QQ mobile patch requires 3.1.4');
  const file = join(root, 'dist/src/services/auth/qrLogin.js'), source = readFileSync(file, 'utf8');
  const expected = process.env.FOLIA_QQ_SOURCE_SHA256;
  if (!expected || createHash('sha256').update(source).digest('hex') !== expected) throw new Error('QQ source hash mismatch');
  writeFileSync(file, patchQqSearch(source));
}

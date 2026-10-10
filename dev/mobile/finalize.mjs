import { rename } from 'node:fs/promises';
// dev/mobile/finalize.mjs
await rename('dist-mobile/mobile.html', 'dist-mobile/index.html');

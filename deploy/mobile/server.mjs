import { createMobileApp } from './gateway.mjs';
// deploy/mobile/server.mjs
const app = createMobileApp({ token: process.env.MOBILE_ACCESS_TOKEN,
  providers: (process.env.MOBILE_PROVIDERS || 'netease,qq').split(',').map(id => id.trim()),
  bases: { netease: 'http://netease-api:3000', qq: 'http://qq-api:3000', kugou: 'http://kugou-api:3000' } });
const server = app.listen(Number(process.env.PORT || 3000), '0.0.0.0');
server.requestTimeout = 20000;
server.headersTimeout = 10000;
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close());

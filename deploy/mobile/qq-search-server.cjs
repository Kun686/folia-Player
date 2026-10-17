const path = require('node:path');
const { createQqSearchRoute } = require('./qqSearchRoute.cjs');

// qq-search-server.cjs — mobile-only composition; existing QQ routes and persisted sessions remain owned by the package.
const base = path.join(path.dirname(require.resolve('@yakult-green-tea/qq-music-api/package.json')), 'dist/src');
const router = require(path.join(base, 'routes/router.js')).default;
const service = require(path.join(base, 'services/auth/qrLogin.node.js')).default;
const { getAuthToken } = require(path.join(base, 'controllers/login.js'));
const { QqProtocolError } = require(path.join(base, 'services/auth/qrLogin.js'));
if (typeof service.mobileSearchSongs !== 'function') throw new Error('Pinned QQ mobile search patch is missing');
router.get('/mobile/search', createQqSearchRoute({ service, getAuthToken, ProtocolError: QqProtocolError }));
require(path.join(base, 'app.js'));

import { test, expect } from '@playwright/test';

// test/mobile-ui/mobile.spec.ts — native bridge fixture exercises real Omni adapters and UI.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.CapacitorCustomPlatform = { name: 'ios' };
    let subscriber: (state: unknown) => void;
    let cookie = false;
    const song = { id: 42, name: '测试歌曲', ar: [{ id: 1, name: '测试歌手' }], al: { id: 1, name: '专辑' }, dt: 180000 };
    const state = { queue: [] as any[], index: -1, position: 0, duration: 180, playing: false, repeat: 'off', revision: 0 };
    const localSong = { id: '11111111-1111-4111-8111-111111111111', name: '本地测试音乐', artists: [{ id: '', name: '本地歌手' }], album: { id: '', name: '' }, durationMs: 180000,
      sourceRef: { kind: 'local', mediaId: '11111111-1111-4111-8111-111111111111' } };
    let localSongs: any[] = [];
    let lyric = '[00:00.00]测试本地歌词\n[00:10.00]第二句';
    const emit = () => { state.revision++; subscriber?.({ ...state }); };
    const methods = ['bootstrap', 'configure', 'health', 'saveSession', 'clearSession', 'request', 'cancelRequests', 'setQueue', 'command', 'getState', 'shareQR',
      'localCatalog', 'importAudio', 'localDetails', 'importLyrics', 'removeLocal', 'audioLevels'];
    win.Capacitor = {
      PluginHeaders: [{ name: 'FoliaNative', methods: [...methods.map(name => ({ name, rtype: 'promise' })), { name: 'addListener' }, { name: 'removeListener' }] }],
      nativeCallback: (_plugin: string, method: string, _options: unknown, cb: (state: unknown) => void) => {
        if (method === 'addListener') subscriber = cb; return 'callback-1';
      },
      nativePromise: async (_plugin: string, method: string, options: any) => {
        if (method === 'health') return { protocol: 1, providers: ['netease', 'qq'] };
        if (method === 'bootstrap') return { server: win.fixtureNoServer ? '' : 'https://fixture.invalid', sessions: {} };
        if (method === 'localCatalog') return { songs: localSongs };
        if (method === 'importAudio') { localSongs = [localSong]; return { songs: localSongs, failures: [] }; }
        if (method === 'localDetails') return { content: lyric };
        if (method === 'importLyrics') { win.fixtureLyricImports = (win.fixtureLyricImports ?? 0) + 1; lyric = '[00:00.00]新导入的歌词\n[00:08.00]下一句'; return { content: lyric }; }
        if (method === 'removeLocal') { localSongs = []; return {}; }
        if (method === 'audioLevels') return { available: true, spectrum: Array(512).fill(140), sampleRate: 44100 };
        if (method === 'getState') return { ...state };
        if (method === 'clearSession') { cookie = false; return {}; }
        if (method === 'setQueue') {
          state.queue = options.append ? [...state.queue, ...options.songs] : options.songs;
          state.index = options.index; state.playing = true; emit(); return {};
        }
        if (method === 'command') { state.playing = options.action === 'play'; if (options.action === 'seek') state.position = options.position; emit(); return {}; }
        if (method !== 'request') return {};
        const path = options.payload.path as string;
        let body: any = { code: 200 };
        const profile = cookie ? { userId: 9, nickname: '测试用户', avatarUrl: '' } : null;
        if (path.startsWith('/login/qr/key')) body = { code: 200, data: { unikey: 'key' } };
        else if (path.startsWith('/login/qr/create')) body = { code: 200, data: { qrimg: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=' } };
        else if (path.startsWith('/login/qr/check')) { cookie = true; body = { code: 803, cookie: 'fixture-cookie' }; }
        else if (path.startsWith('/login/status')) body = { code: 200, data: { code: 200, profile } };
        else if (path.startsWith('/user/account')) body = { code: 200, profile, account: cookie ? { id: 9 } : null };
        else if (path.startsWith('/user/playlist')) body = { code: 200, playlist: [{ id: 8, name: '测试歌单', trackCount: 1, creator: { userId: 9 } }], more: false };
        else if (path.startsWith('/cloudsearch')) body = path.includes('fail') ? { code: 500 } : { code: 200, result: { songs: [song], songCount: 1 } };
        else if (path.startsWith('/playlist/track/all')) body = { code: 200, songs: [song] };
        else if (path.startsWith('/playlist/detail')) body = { code: 200, playlist: { id: 8, name: '测试歌单', tracks: [song], trackIds: [{ id: 42 }], trackCount: 1 } };
        else if (path.startsWith('/lyric')) body = { code: 200, lrc: { lyric: '[00:00.00]测试歌词\n[00:10.00]第二句' } };
        return { status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } };
      },
    };
  });
});
test('login, catalog, queue, controls and responsive layout', async ({ page }, info) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/mobile.html');
  await expect(page).toHaveTitle('Folia');
  await expect(page.getByRole('heading', { name: '音乐库' })).toBeVisible();
  await page.getByRole('button', { name: '扫码登录', exact: true }).click();
  await page.getByRole('button', { name: '重新生成二维码' }).click();
  await expect(page.getByRole('img', { name: '扫码登录' })).toBeVisible();
  await expect(page.getByText('已登录', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(page.getByText('测试用户', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '测试歌单', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 测试歌曲', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('测试');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).click();
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '播放 测试歌曲', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '加入队列 测试歌曲' }).click();
  await page.getByRole('button', { name: '播放 测试歌曲', exact: true }).click();
  await expect(page.locator('.player-panel')).toBeVisible();
  await page.locator('.player-panel').getByRole('button', { name: '暂停', exact: true }).click();
  await expect(page.locator('.player-panel').getByRole('button', { name: '播放', exact: true })).toBeVisible();
  if (info.project.name !== 'ipad') await page.getByRole('button', { name: '返回音乐库' }).click();
  await expect(page.locator('vite-error-overlay')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: '/tmp/folia-' + info.project.name + '.png', fullPage: false });
  await page.getByRole('button', { name: '退出登录', exact: true }).click();
  await expect(page.getByText('测试用户', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-cookie');
});
test('settings and unavailable server error are visible', async ({ page }) => {
  await page.goto('/mobile.html');
  await page.locator('.brand').getByRole('button', { name: '服务器与外观' }).click();
  await page.getByLabel('HTTPS 服务器地址').fill('https://music.example.com');
  await page.getByLabel('访问凭据').fill('x'.repeat(40));
  await page.getByRole('button', { name: '保存连接' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => {
    const win = window as any;
    const original = win.Capacitor.nativePromise;
    win.Capacitor.nativePromise = (plugin: string, method: string, options: unknown) => method === 'request' ? Promise.reject(new Error('network')) : original(plugin, method, options);
  });
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('fail');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
});

test('local playback without server and original visualizer registry', async ({ page }, info) => {
  const errors: string[] = [];
  const warnings: unknown[] = [];
  page.on('console', async message => {
    if (message.type() === 'warning') for (const argument of message.args()) {
      try { const value = await argument.evaluate(v => v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : String(v)); warnings.push(value); } catch {}
    }
  });
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByText('从「文件」导入音乐即可离线播放，无需配置服务器。')).toBeVisible();
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await expect(page.locator('.player-panel')).toBeVisible();
  // The initial lyric load changes control height; wait for it before choosing another file.
  await expect(page.locator('.player-controls').getByText('暂无歌词', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '导入歌词', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureLyricImports)).toBe(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: '歌词与动效', exact: true }).click();
  await expect(page.getByLabel('歌词动画', { exact: true })).toBeVisible();
  const modes = await page.getByLabel('歌词动画', { exact: true }).locator('option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value));
  expect(modes).toHaveLength(14);
  for (const mode of modes) {
    await page.getByLabel('歌词动画', { exact: true }).selectOption(mode);
    await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.locator('.lyric-stage')).toBeVisible();
    if (mode === 'still') await expect(page.locator('.lyric-stage').getByText('新导入的歌词', { exact: true })).toBeVisible();
    else await expect(page.locator('.lyric-stage').locator('canvas, svg, span').first()).toBeAttached();
    await page.waitForTimeout(250);
    await page.getByRole('button', { name: '歌词与动效', exact: true }).click();
  }
  await page.getByLabel('歌词动画', { exact: true }).selectOption('monet');
  await page.getByLabel('背景效果', { exact: true }).selectOption('monet');
  await page.getByText('导入／导出外观', { exact: true }).click();
  await page.getByRole('button', { name: '生成外观短码', exact: true }).click();
  await expect(page.getByLabel('Folia 外观短码或 JSON')).toHaveValue(/^folia-theme:\/\//);
  await page.getByRole('button', { name: '应用外观配置', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.mobile-test-results/local-visuals-' + info.project.name + '.png' });
  if (info.project.name !== 'ipad') await page.getByRole('button', { name: '返回音乐库' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除 本地测试音乐', exact: true }).click();
  await expect(page.getByRole('button', { name: '播放 本地测试音乐', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
  await info.attach('renderer-warnings', { body: JSON.stringify(warnings, null, 2), contentType: 'application/json' });
  console.log('Renderer diagnostics:', JSON.stringify(warnings));
});

test('paused Partita lyrics are visible after switching modes and seeking', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await page.locator('.player-panel').getByRole('button', { name: '暂停', exact: true }).click();
  await page.getByRole('button', { name: '歌词与动效', exact: true }).click();
  await page.getByLabel('歌词动画', { exact: true }).selectOption('partita');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  // Text can be attached while every lyric chunk is transparent; inspect rendered opacity.
  const visibleChunk = () => page.locator('.lyric-stage .inline-flex.origin-center').evaluateAll(nodes =>
    nodes.some(node => Number(getComputedStyle(node).opacity) > 0.9));
  await expect.poll(visibleChunk).toBe(true);
  await page.getByRole('slider', { name: '播放进度' }).fill('12');
  await expect(page.locator('.lyric-stage .inline-flex.origin-center').first()).toContainText('第');
  await expect.poll(visibleChunk).toBe(true);
  await expect(page.locator('.player-panel').getByRole('button', { name: '播放', exact: true })).toBeVisible();
});

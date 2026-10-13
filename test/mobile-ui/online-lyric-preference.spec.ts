import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';

// online-lyric-preference.spec.ts — real matcher/store over the existing controlled native transport and QRC sample.
const settings = (page: Page) => page.getByRole('dialog', { name: '服务器与外观', exact: true });
const region = (page: Page) => settings(page).getByRole('region', { name: '自动使用最佳歌词', exact: true });
const toggle = (page: Page) => region(page).getByRole('button', { name: '自动使用最佳歌词', exact: true });
const source = (page: Page) => region(page).getByRole('combobox', { name: '歌词匹配优先级', exact: true });
const cache = (page: Page) => page.evaluate(() => Object.values(JSON.parse(sessionStorage.getItem('fixture-lyric-cache') || '{}')) as any[]);
async function open(page: Page) { await page.getByRole('button', { name: '服务器与外观', exact: true }).tap(); }
async function seedSong(page: Page, providerId: 'netease' | 'qq' = 'netease') {
  // A native playback snapshot keeps the library visible while exercising the mounted lyric loader.
  await page.evaluate(providerId => {
    const w = window as any;
    const song = { id: 42, name: 'QQ 匹配候选', artists: [{ id: 1, name: '测试歌手' }],
      album: { id: 1, name: '样本专辑' }, durationMs: 180000,
      sourceRef: { kind: 'online', providerId, mediaId: '42' } };
    w.fixtureEmitPlayback({ queue: [song], index: 0, currentSong: song, playing: false, position: 12 });
  }, providerId);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureLyricTools = true; });
  await page.goto('/mobile.html');
  await expect(page.getByRole('button', { name: '服务器与外观', exact: true })).toBeVisible();
});

test('touch settings persist across reload and rotation and recover from failed writes', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  await expect(source(page)).toHaveValue('qq');
  expect(await source(page).locator('option').evaluateAll(nodes => nodes.map(node => (node as HTMLOptionElement).value)))
    .toEqual(['netease', 'amll', 'qq', 'kugou']);
  await toggle(page).tap(); await source(page).selectOption('amll');
  await page.reload(); await open(page);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(source(page)).toHaveValue('amll');
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    (window as any).restorePreferenceStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = function (key, value) {
      if (key === 'auto_use_best_lyric' || key === 'preferred_alternative_lyric_source_v2') throw new Error('controlled-storage-error');
      original.call(this, key, value);
    };
  });
  await toggle(page).tap();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  await source(page).selectOption('kugou');
  await expect(source(page)).toHaveValue('amll');
  await expect(region(page).getByRole('alert')).toContainText('歌词偏好未能保存或恢复');
  await page.evaluate(() => (window as any).restorePreferenceStorage());
  await source(page).selectOption('netease'); await toggle(page).tap();
  await expect(region(page).getByRole('alert')).toHaveCount(0);
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  for (const viewport of [page.viewportSize()!, info.project.name === 'phone' ? { width: 844, height: 390 } : { width: 834, height: 1194 }]) {
    await page.setViewportSize(viewport); await source(page).scrollIntoViewIfNeeded();
    expect((await source(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect((await toggle(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await settings(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath('online-lyric-preference.png') });
  await page.reload(); await open(page);
  await expect(source(page)).toHaveValue('netease');
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  expect(errors).toEqual([]);
});

test('enabling matching uses the original QQ decoder and preserves the saved choice after preference changes', async ({ page }) => {
  await seedSong(page);
  await expect.poll(async () => (await cache(page))[0]?.lyrics?.lines[0]?.fullText).toBe('测试歌词');
  await open(page); await toggle(page).tap();
  await expect.poll(async () => (await cache(page))[0]?.state?.matchedLyricsSource).toBe('qq');
  const selected = (await cache(page))[0];
  expect(selected.state.onlineOverrideLyrics.isWordByWord).toBe(true);
  expect(selected.lyrics.lines[0].fullText).toBe('测试歌词');
  await toggle(page).tap(); await source(page).selectOption('amll');
  await toggle(page).tap();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'true');
  expect((await cache(page))[0]).toEqual(selected);
  await page.reload();
  await page.evaluate(() => { (window as any).fixtureOfflineLyrics = true; });
  await seedSong(page);
  await open(page); await source(page).selectOption('kugou');
  expect((await cache(page))[0]).toEqual(selected);
  expect(await page.evaluate(() => (window as any).fixtureLyricRequests || 0)).toBe(0);
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(12);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('disabling matching rejects a late QQ result without changing playback or cached provider lyrics', async ({ page }) => {
  await seedSong(page);
  await expect.poll(async () => (await cache(page))[0]?.lyrics?.lines[0]?.fullText).toBe('测试歌词');
  await page.evaluate(() => {
    const w = window as any, original = w.Capacitor.nativePromise;
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'request' && options.payload.path === 'https://u.y.qq.com/cgi-bin/musicu.fcg'
        && JSON.parse(options.payload.body).request.method !== 'DoSearchForQQMusicLite') {
        await new Promise<void>(resolve => { w.releasePreferenceMatch = resolve; });
      }
      return original(plugin, method, options);
    };
  });
  await open(page); await toggle(page).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releasePreferenceMatch)).toBe('function');
  await toggle(page).tap();
  await expect(toggle(page)).toHaveAttribute('aria-pressed', 'false');
  const accepted = page.waitForEvent('console', { predicate: message => message.text().includes('Found accepted QQ lyric match!') });
  await page.evaluate(() => (window as any).releasePreferenceMatch());
  await accepted;
  // Allow the actual async decoder/matcher continuation and React commit to finish, without a guessed delay.
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect((await cache(page))[0].state).toBeUndefined();
  expect((await cache(page))[0].lyrics.lines[0].fullText).toBe('测试歌词');
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(12);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('imported lyrics remain authoritative for both online platforms when preferences change', async ({ page }) => {
  for (const providerId of ['qq', 'netease'] as const) {
    await page.evaluate(async providerId => {
      const w = window as any;
      await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', {
        song: { sourceRef: { kind: 'online', providerId, mediaId: '42' } }, token: 'initial', field: 'state',
        value: { lyricsSource: 'imported', importedLyrics: { lines: [{ startTime: 0, endTime: 10, fullText: '导入正文', words: [] }] } },
      });
    }, providerId);
    await seedSong(page, providerId); await open(page);
    await toggle(page).tap(); await source(page).selectOption(providerId === 'qq' ? 'netease' : 'qq');
    await settings(page).getByRole('button', { name: '关闭', exact: true }).tap();
  }
  expect((await cache(page)).map(entry => entry.state.importedLyrics.lines[0].fullText)).toEqual(['导入正文', '导入正文']);
  expect(await page.evaluate(() => (window as any).fixtureLyricRequests || 0)).toBe(0);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('a new preferred source wins over an older in-flight match', async ({ page }) => {
  await seedSong(page);
  await expect.poll(async () => (await cache(page))[0]?.lyrics?.lines[0]?.fullText).toBe('测试歌词');
  await page.evaluate(() => {
    const w = window as any, original = w.Capacitor.nativePromise;
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'request') {
        if (w.preferOwnWords && options.payload.path.startsWith('/lyric')) {
          return { status: 200, headers: {}, body: JSON.stringify({ code: 200,
            lrc: { lyric: '[00:00.00]新的首选歌词' }, yrc: { lyric: '[0,10000](0,10000,0)新的首选歌词' } }) };
        }
        if (options.payload.path === 'https://u.y.qq.com/cgi-bin/musicu.fcg'
          && JSON.parse(options.payload.body).request.method !== 'DoSearchForQQMusicLite') {
          await new Promise<void>(resolve => { w.releasePreferenceMatch = resolve; });
        }
      }
      return original(plugin, method, options);
    };
  });
  await open(page); await toggle(page).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releasePreferenceMatch)).toBe('function');
  await page.evaluate(() => { (window as any).preferOwnWords = true; });
  await source(page).selectOption('netease');
  await expect.poll(async () => (await cache(page))[0]?.lyrics?.lines[0]?.fullText).toBe('新的首选歌词');
  expect((await cache(page))[0].lyrics.isWordByWord).toBe(true);
  const accepted = page.waitForEvent('console', { predicate: message => message.text().includes('Found accepted QQ lyric match!') });
  await page.evaluate(() => (window as any).releasePreferenceMatch()); await accepted;
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect((await cache(page))[0].state).toBeUndefined();
  expect((await cache(page))[0].lyrics.lines[0].fullText).toBe('新的首选歌词');
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('online preference changes leave local lyric loading alone', async ({ page }) => {
  await page.evaluate(() => {
    const w = window as any, original = w.Capacitor.nativePromise;
    w.localLyricReads = 0;
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (method === 'readLocalLyrics') w.localLyricReads++;
      return original(plugin, method, options);
    };
    const song = { id: '11111111-1111-4111-8111-111111111111', name: '本地歌曲', artists: [], album: { id: '', name: '' },
      sourceRef: { kind: 'local', mediaId: '11111111-1111-4111-8111-111111111111' } };
    w.fixtureEmitPlayback({ queue: [song], index: 0, currentSong: song, playing: false, position: 12 });
  });
  await expect.poll(() => page.evaluate(() => (window as any).localLyricReads)).toBeGreaterThan(0);
  const reads = await page.evaluate(() => (window as any).localLyricReads);
  await open(page); await toggle(page).tap(); await source(page).selectOption('amll');
  await expect(source(page)).toHaveValue('amll');
  expect(await page.evaluate(() => (window as any).localLyricReads)).toBe(reads);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('native cached upgrades refresh foreground lyrics and recover on return without platform requests', async ({ page }) => {
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('测试');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  await page.getByRole('button', { name: '播放 测试歌曲', exact: true }).tap();
  await clickPlayerTool(page, '歌词与动效');
  await page.getByLabel('歌词动画', { exact: true }).selectOption('still');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).tap();
  const lyric = (text: string) => page.locator('.lyric-stage').getByText(text, { exact: true });
  await expect(lyric('测试歌词')).toBeVisible();
  const requests = await page.evaluate(() => (window as any).fixtureLyricRequests || 0);
  const update = async (text: string, hidden: boolean) => page.evaluate(async ({ text, hidden }) => {
    const w = window as any, song = w.fixturePlayback.currentSong;
    w.fixtureOfflineLyrics = true;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.lyricHidden === true });
    w.lyricHidden = hidden;
    await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', {
      song, token: 'initial', field: 'state', value: { lyricsSource: 'online', hasOnlineOverride: true,
        onlineOverrideLyrics: { lines: [{ startTime: 0, endTime: 180, fullText: text, words: [] }] } },
    });
    w.fixtureEmitLyrics(song);
  }, { text, hidden });
  await update('原生后台匹配结果', false);
  await expect(lyric('原生后台匹配结果')).toBeVisible();
  await update('再次返回后的歌词', true);
  await expect(lyric('原生后台匹配结果')).toBeVisible();
  await page.evaluate(() => {
    (window as any).lyricHidden = false;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(lyric('再次返回后的歌词')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureLyricRequests || 0)).toBe(requests);
});

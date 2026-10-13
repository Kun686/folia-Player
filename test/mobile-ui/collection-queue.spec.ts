import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';
import { searchPlaybackFixture, seedSearchQueue } from './search-playback-fixture';

// collection-queue.spec.ts — original scope semantics over actual adapters and the versioned native fixture.
const enqueue = (page: Page) => page.getByRole('button', { name: '加入播放队列', exact: true });
const identities = (page: Page) => page.evaluate(() => (window as any).fixturePlayback.queue.map((s: any) => s.sourceRef.mediaId));
async function playlistFixture(page: Page) {
  await searchPlaybackFixture(page);
  await page.addInitScript(() => {
    const w = window as any, previous = w.fixtureOnlineRequest;
    w.collectionPages = [];
    w.fixtureOnlineRequest = async (payload: any) => {
      const url = new URL(payload.path, 'https://fixture.invalid');
      if (url.pathname !== '/playlist/track/all') return previous(payload);
      const offset = Number(url.searchParams.get('offset')); w.collectionPages.push(offset);
      const ids = offset ? [250, 251] : Array.from({ length: 50 }, (_, i) => i === 49 ? 200 : 200 + i);
      return { status: 200, headers: {}, body: JSON.stringify(w.collectionPageFailure && offset ? { code: 301 } : {
        code: 200, songs: ids.map(id => ({ id, name: '范围歌曲' + id, ar: [{ id: 1, name: '歌手' }], al: { id: 1, name: '专辑' }, dt: 180000,
          ...(id === 201 || w.collectionAllUnavailable ? { privilege: { st: -200 } } : {}) })),
      }) };
    };
  });
  await page.goto('/mobile.html'); await seedSearchQueue(page);
}
async function openPlaylist(page: Page) { await page.getByRole('button', { name: '搜索回归歌单', exact: true }).tap(); }

test('local filtering and sorting enqueue only the displayed scope, preserve playback and remain touchable after rotation', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await searchPlaybackFixture(page);
  await page.addInitScript(() => {
    const w = window as any; w.fixtureNoServer = true;
    w.fixtureSetLocalSongs([1, 2, 3].map(n => {
      const id = `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`, name = n === 3 ? '其他' : '通勤' + n;
      return { id, name, importedFileName: name + '.m4a', artists: [], album: { id: '', name: '' }, durationMs: 120000,
        sourceRef: { kind: 'local', mediaId: id } };
    }));
  });
  await page.goto('/mobile.html'); await seedSearchQueue(page);
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('通勤');
  await page.getByRole('combobox', { name: '排序方向', exact: true }).selectOption('desc');
  await expect(page.locator('.song-main strong')).toHaveText(['通勤2', '通勤1']);
  await expect(page.locator('.library-panel').getByRole('alert')).toHaveCount(0);
  const original = page.viewportSize()!;
  for (const size of [original, { width: original.height, height: original.width }, original]) {
    await page.setViewportSize(size); await enqueue(page).scrollIntoViewIfNeeded();
    await expect(enqueue(page)).toBeVisible(); expect((await enqueue(page).boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.locator('.library-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await enqueue(page).tap(); await expect(page.getByText('已将 2 首歌曲加入播放队列', { exact: true })).toBeVisible();
  expect(await identities(page)).toEqual(['qq-101', '100', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001']);
  expect(await page.evaluate(() => ({ position: (window as any).fixturePlayback.position, playing: (window as any).fixturePlayback.playing,
    current: (window as any).fixturePlayback.currentSong.sourceRef.mediaId }))).toEqual({ position: 42, playing: false, current: 'qq-101' });
  await enqueue(page).tap(); expect(await page.evaluate(() => (window as any).searchPlaybackCalls.length)).toBe(1);
  await page.screenshot({ path: info.outputPath('local-scope.png') });
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('没有这首歌'); await expect(enqueue(page)).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('online scope excludes unavailable songs and repeats, uses only loaded pages and survives paging failure', async ({ page }, info) => {
  await playlistFixture(page); await openPlaylist(page);
  await expect(page.getByText('当前范围 49 首', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).fixtureStaleEdit = true; });
  await enqueue(page).tap(); await expect(page.getByText('已将 48 首歌曲加入播放队列', { exact: true })).toBeVisible();
  expect(await identities(page)).toEqual(['qq-101', '100', '200', ...Array.from({ length: 47 }, (_, i) => String(202 + i))]);
  expect(await page.evaluate(() => (window as any).collectionPages)).toEqual([0]);
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls.map((x: any) => x.method))).toEqual(['editQueue', 'editQueue']);
  await page.evaluate(() => { (window as any).collectionPageFailure = true; });
  await page.getByRole('button', { name: '加载更多', exact: true }).tap();
  await expect(page.getByRole('button', { name: '重试歌曲加载', exact: true })).toBeVisible();
  await enqueue(page).tap(); await expect(page.getByText('已将 48 首歌曲加入播放队列', { exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).collectionPageFailure = false; });
  await page.getByRole('button', { name: '重试歌曲加载', exact: true }).tap();
  await expect(page.getByText('当前范围 51 首', { exact: true })).toBeVisible();
  await enqueue(page).tap(); await expect(page.getByText('已将 50 首歌曲加入播放队列', { exact: true })).toBeVisible();
  expect((await identities(page)).slice(-2)).toEqual(['250', '251']);
  expect(await page.evaluate(() => (window as any).collectionPages)).toEqual([0, 50, 50]);
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(42);
  await page.screenshot({ path: info.outputPath('online-scope.png') });
});

test('logout during a pending scope enqueue cancels the whole write', async ({ page }) => {
  await playlistFixture(page); await openPlaylist(page);
  await page.evaluate(() => { (window as any).searchDelayState = true; }); await enqueue(page).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseSearchState)).toBe('function');
  await expect(enqueue(page)).toBeDisabled();
  await page.getByRole('button', { name: '退出登录', exact: true }).tap();
  await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeVisible();
  await page.evaluate(() => { (window as any).searchDelayState = false; (window as any).releaseSearchState(); });
  await expect(page.getByText('播放队列已变化，请重新选择歌曲。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]);
});

test('batch insertion retains the selected next preference while a pending action blocks double taps', async ({ page }) => {
  await searchPlaybackFixture(page); await page.goto('/mobile.html'); await seedSearchQueue(page);
  const settings = page.getByRole('dialog', { name: '服务器与外观', exact: true });
  await page.locator('.brand').getByRole('button', { name: '服务器与外观', exact: true }).tap();
  await settings.getByRole('combobox', { name: '加入队列的默认位置', exact: true }).selectOption('next');
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await openPlaylist(page); await page.evaluate(() => { (window as any).searchDelayState = true; });
  await enqueue(page).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseSearchState)).toBe('function');
  await expect(enqueue(page)).toBeDisabled();
  await page.locator('.brand').getByRole('button', { name: '服务器与外观', exact: true }).tap();
  await settings.getByRole('combobox', { name: '加入队列的默认位置', exact: true }).selectOption('append');
  await settings.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.evaluate(() => { (window as any).searchDelayState = false; (window as any).releaseSearchState(); });
  await expect(page.getByText('已将 2 首歌曲加入播放队列', { exact: true })).toBeVisible();
  expect(await identities(page)).toEqual(['qq-101', '200', '201', '100']);
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls.map((x: any) => x.method))).toEqual(['editQueue']);
});

test('capacity failure is atomic and unavailable scopes cannot enqueue; search keeps single-song actions', async ({ page }) => {
  await playlistFixture(page); await openPlaylist(page);
  await page.evaluate(() => {
    const w = window as any, current = w.fixturePlayback.currentSong;
    w.fixtureEmitPlayback({ queue: [current, ...Array.from({ length: 999 }, (_, i) => ({ ...current, id: 'filler' + i,
      sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'filler' + i } }))], index: 0 });
  });
  await enqueue(page).tap(); await expect(page.getByText('播放队列最多容纳 1,000 首歌曲。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).searchPlaybackCalls)).toEqual([]); expect((await identities(page)).length).toBe(1000);
  await page.evaluate(() => { (window as any).collectionAllUnavailable = true; }); await openPlaylist(page);
  await expect(page.getByText('当前范围 0 首', { exact: true })).toBeVisible(); await expect(enqueue(page)).toBeDisabled();
  await page.getByRole('textbox', { name: '搜索歌曲', exact: true }).fill('搜索');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap();
  await expect(page.getByRole('button', { name: '播放 搜索歌曲100', exact: true })).toBeVisible(); await expect(enqueue(page)).toHaveCount(0);
});

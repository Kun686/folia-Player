import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// queue-search.spec.ts — desktop search semantics through touch UI and a versioned native bridge fixture.
const search = (page: Page) => page.getByRole('textbox', { name: '搜索播放队列', exact: true });
const scope = (page: Page) => page.getByRole('combobox', { name: '搜索范围', exact: true });
const actions = (page: Page) => page.getByRole('dialog', { name: '歌曲操作', exact: true });
const rows = (page: Page) => page.locator('.song-list .song-main');
const order = (page: Page) => page.evaluate(() => (window as any).fixturePlayback.queue.map((song: any) => song.fixtureOccurrence));
const edits = (page: Page) => page.evaluate(() => (window as any).queueSearchCalls.filter((call: any) => call.method === 'editQueue'));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any, bridge = w.Capacitor.nativePromise;
    w.fixtureNoServer = true; w.fixtureLyricTools = true; w.queueSearchCalls = [];
    w.Capacitor.nativePromise = async (plugin: string, method: string, options: any) => {
      if (['editQueue', 'selectQueue', 'setQueue'].includes(method)) w.queueSearchCalls.push({ method, ...structuredClone(options) });
      return bridge(plugin, method, options);
    };
  });
  await page.goto('/mobile.html');
  await expect(page.getByRole('heading', { name: '音乐库', exact: true })).toBeVisible();
  await page.evaluate(() => {
    const song = (fixtureOccurrence: number, name: string, artist: string, album: string) => ({
      id: String(fixtureOccurrence), fixtureOccurrence, name, artists: [{ id: 'artist', name: artist }],
      album: { id: 'album', name: album }, durationMs: 180000,
      sourceRef: fixtureOccurrence === 0 ? { kind: 'local', mediaId: '00000000-0000-4000-8000-000000000000' }
        : { kind: 'online', providerId: fixtureOccurrence === 2 ? 'qq' : 'netease', mediaId: String(fixtureOccurrence) },
    });
    const queue = [song(0, 'Before Echo', 'The "Echo" Band', 'Night Session'), song(1, 'Bridge', 'Guest', 'Day Session'),
      song(2, 'Echo', 'The "Echo" Band', 'Night Session'), song(3, 'Interlude', 'Guest', 'Day Session')];
    queue.push({ ...queue[2], fixtureOccurrence: 4 });
    (window as any).fixtureEmitPlayback({ queue, index: 2, currentSong: queue[2], position: 42, playing: false });
  });
  await page.getByRole('button', { name: '播放队列 · 5', exact: true }).tap();
  await expect(search(page)).toBeVisible();
});

test('search ranks songs, quotes artist and album facets, and never submits a catalog search', async ({ page }) => {
  await expect(page.getByRole('textbox', { name: '搜索歌曲', exact: true })).toHaveCount(0);
  await expect(page.getByRole('group', { name: '队列匹配项操作' })).toHaveCount(0);
  await search(page).fill('Echo'); await search(page).press('Enter');
  await expect(rows(page)).toHaveText(['EchoThe "Echo" Band', 'EchoThe "Echo" Band', 'Before EchoThe "Echo" Band']);
  await expect(rows(page).nth(0)).toHaveAttribute('aria-current', 'true');
  await expect(rows(page).nth(1)).not.toHaveAttribute('aria-current', 'true');
  await scope(page).selectOption('artist'); await search(page).fill('The "Echo" Band');
  await expect(rows(page)).toHaveCount(3);
  await scope(page).selectOption('album'); await search(page).fill('Day Session');
  await expect(rows(page)).toHaveText(['BridgeGuest', 'InterludeGuest']);
  await search(page).fill('不存在的专辑'); await expect(rows(page)).toHaveCount(0);
  await expect(page.getByText('暂无结果', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '移除匹配项', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '清除筛选', exact: true }).tap();
  await expect(rows(page)).toHaveCount(5);
  expect(await edits(page)).toEqual([]);
  await scope(page).selectOption('all'); await search(page).fill('--remove'); await search(page).press('Enter');
  await expect(page.getByRole('group', { name: '队列匹配项操作' })).toHaveCount(0);
  expect(await edits(page)).toEqual([]);
});

test('filtered play selects the original duplicate occurrence and returns to the same filter', async ({ page }) => {
  await search(page).fill('Echo');
  await page.getByRole('button', { name: '播放 Echo', exact: true }).nth(1).tap();
  await expect.poll(() => page.evaluate(() => (window as any).queueSearchCalls)).toEqual([{ method: 'selectQueue', index: 4, queueRevision: 0 }]);
  await page.getByRole('button', { name: '返回音乐库', exact: true }).tap();
  await expect(search(page)).toHaveValue('Echo');
  await expect(rows(page).nth(1)).toHaveAttribute('aria-current', 'true');
});

test('filtered row menu keeps the current song and maps end/remove to original queue positions', async ({ page }) => {
  await search(page).fill('Echo');
  await page.getByRole('button', { name: '歌曲操作 Echo', exact: true }).nth(0).tap();
  await expect(actions(page).getByRole('button', { name: '下一首播放', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).fixtureEmitPlayback({ position: 43 }); });
  await expect(actions(page)).toBeVisible();
  await actions(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 Before Echo', exact: true }).tap();
  await actions(page).getByRole('button', { name: '移到队尾', exact: true }).tap();
  await expect.poll(() => order(page)).toEqual([1, 2, 3, 4, 0]);
  await page.getByRole('button', { name: '歌曲操作 Echo', exact: true }).nth(1).tap();
  await actions(page).getByRole('button', { name: '从队列移除', exact: true }).tap();
  await expect.poll(() => order(page)).toEqual([1, 2, 3, 0]);
  expect((await edits(page)).map((call: any) => call.currentIndex)).toEqual([1, 1]);
});

test('batch moves in original queue order, preserves the playing occurrence and confirms removal', async ({ page }) => {
  await search(page).fill('Echo');
  await expect(page.getByRole('status').filter({ hasText: '批量操作保留当前播放歌曲' })).toBeVisible();
  await page.getByRole('button', { name: '匹配项下一首播放', exact: true }).tap();
  await expect.poll(() => order(page)).toEqual([1, 2, 0, 4, 3]);
  await page.getByRole('button', { name: '匹配项移到队尾', exact: true }).tap();
  await expect.poll(() => order(page)).toEqual([1, 2, 3, 0, 4]);
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: '移除匹配项', exact: true }).tap();
  expect(await edits(page)).toHaveLength(2);
  page.once('dialog', async dialog => { expect(dialog.message()).toContain('2 首'); await dialog.accept(); });
  await page.getByRole('button', { name: '移除匹配项', exact: true }).tap();
  await expect.poll(() => order(page)).toEqual([1, 2, 3]);
  await expect(page.getByRole('button', { name: '移除匹配项', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => {
    const state = (window as any).fixturePlayback;
    return { index: state.index, current: state.currentSong.fixtureOccurrence, position: state.position, playing: state.playing };
  })).toEqual({ index: 1, current: 2, position: 42, playing: false });
});

test('rejects a stale batch once and closes a stale row menu after a remote queue edit', async ({ page }) => {
  await search(page).fill('Echo');
  await page.evaluate(() => { (window as any).fixtureStaleEdit = true; });
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除匹配项', exact: true }).tap();
  await expect(page.getByRole('alert').filter({ hasText: '播放队列已变化' })).toBeVisible();
  expect(await edits(page)).toHaveLength(1); expect(await order(page)).toEqual([0, 1, 2, 3, 4]);
  await page.getByRole('button', { name: '歌曲操作 Before Echo', exact: true }).tap();
  await page.evaluate(() => {
    const w = window as any, queue = w.fixturePlayback.queue.slice(1);
    w.fixtureEmitPlayback({ queue, index: 1, queueRevision: w.fixturePlayback.queueRevision + 1 });
  });
  await expect(actions(page)).not.toBeVisible();
  await expect(search(page)).toHaveValue('Echo');
  await expect(rows(page)).toHaveCount(2);
});

test('detached playback allows removal of both queued duplicates without changing transport', async ({ page }) => {
  await page.evaluate(() => { (window as any).fixtureEmitPlayback({ index: -1 }); });
  await search(page).fill('Echo');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除匹配项', exact: true }).tap();
  await expect.poll(() => order(page)).toEqual([1, 3]);
  expect((await edits(page))[0].currentIndex).toBe(-1);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('touch controls and queue rows remain reachable in narrow and rotated windows', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await search(page).fill('Echo');
  const sizes = info.project.name === 'phone' ? [[320, 568], [844, 390], [390, 844]]
    : info.project.name === 'ipad' ? [[834, 1194], [1194, 834]] : [[390, 600], [600, 834]];
  for (const [width, height] of sizes) {
    await page.setViewportSize({ width, height });
    for (const control of [scope(page), search(page), page.getByRole('button', { name: '匹配项下一首播放', exact: true }), rows(page).first()]) {
      await control.scrollIntoViewIfNeeded();
      const box = await control.boundingBox();
      expect(box!.height, await control.getAttribute('aria-label') ?? await control.getAttribute('class') ?? 'search scope').toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    expect(await page.locator('.library-panel').evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await page.getByRole('button', { name: '匹配项下一首播放', exact: true }).tap();
    await expect.poll(() => order(page)).toEqual([1, 2, 0, 4, 3]);
    await search(page).scrollIntoViewIfNeeded();
    await page.screenshot({ path: info.outputPath(`queue-${width}x${height}.png`) });
  }
  expect(errors).toEqual([]);
});

import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';

// lyric-timing.spec.ts — original controls/preview/renderers over controlled native clock snapshots.
const localKey = 'local:11111111-1111-4111-8111-111111111111';
const tools = (page: Page) => page.getByRole('dialog', { name: '歌词', exact: true });
const calibration = (page: Page) => page.getByRole('dialog', { name: '全局时间偏移', exact: true });
const openTools = (page: Page) => clickPlayerTool(page, '歌词');
const openCalibration = (page: Page) => tools(page).getByRole('button', { name: '全局时间偏移', exact: true }).click();
const savedOffsets = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('lyric_timeline_offsets') || '{}'));
const globalOffset = (page: Page) => page.evaluate(() => Number(localStorage.getItem('global_lyric_timeline_offset_ms')));
async function startLocal(page: Page, position = 10.25) {
  await page.addInitScript(() => {
    const w = window as any; w.fixtureNoServer = true; w.fixtureLyricTools = true;
    w.fixtureLocalLyric = { fileName: 'timing.yrc',
      content: '[0,10000](0,10000,0)测试本地歌词\n[10000,10000](10000,10000,0)第二句' };
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await page.evaluate(position => (window as any).fixtureEmitPlayback({ playing: false, position }), position);
}
async function setOffset(page: Page, value: number, key = localKey) {
  await tools(page).getByRole('spinbutton', { name: '时间轴偏移' }).fill(String(value));
  await expect.poll(() => savedOffsets(page)).toMatchObject({ [key]: value });
}
async function highlightPercent(page: Page) {
  return calibration(page).locator('[data-start="0"]').first().evaluate(node => {
    const match = (node as HTMLElement).style.backgroundImage.match(/([\d.]+)%/);
    return match ? Number(match[1]) : -1;
  });
}
test('song and global lyric offsets calibrate paused word progress without changing audio', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await startLocal(page);
  await openTools(page);
  await expect(tools(page)).toBeVisible({ timeout: 3000 });
  await setOffset(page, 500);
  await tools(page).getByRole('button', { name: '+250ms', exact: true }).click();
  await expect.poll(() => savedOffsets(page)).toMatchObject({ [localKey]: 750 });
  await tools(page).getByRole('button', { name: '-250ms', exact: true }).click();
  await expect.poll(() => savedOffsets(page)).toMatchObject({ [localKey]: 500 });
  await openCalibration(page);
  // 10.25 seconds of audio minus 0.5 seconds of song correction = 97.5% of the first 10s line.
  await expect.poll(() => highlightPercent(page)).toBeCloseTo(97.5, 3);
  await calibration(page).getByRole('button', { name: '+50ms', exact: true }).click();
  await expect.poll(() => highlightPercent(page)).toBeCloseTo(97, 3);
  expect(await globalOffset(page)).toBe(0);
  await calibration(page).getByRole('button', { name: '返回', exact: true }).click();
  await openCalibration(page);
  await expect.poll(() => highlightPercent(page)).toBeCloseTo(97.5, 3);
  await calibration(page).getByRole('button', { name: '+50ms', exact: true }).tap();
  await calibration(page).getByRole('button', { name: '应用', exact: true }).tap();
  expect(await globalOffset(page)).toBe(50);
  await openCalibration(page);
  await expect.poll(() => highlightPercent(page)).toBeCloseTo(97, 3);
  await expect.poll(() => calibration(page).evaluate(node => Number(getComputedStyle(node).opacity))).toBe(1);
  await page.screenshot({ path: '.mobile-test-results/lyric-timing-' + info.project.name + '.png' });
  const dialog = calibration(page);
  expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  // The existing ruler supports a finger/pointer gesture, and draft cancellation is reversible.
  const ruler = dialog.getByRole('slider');
  const box = (await ruler.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down(); await page.mouse.move(box.x + box.width / 2 + 40, box.y + box.height / 2); await page.mouse.up();
  await expect(ruler).not.toHaveAttribute('aria-valuenow', '50');
  await dialog.getByRole('button', { name: '返回', exact: true }).click();
  expect(await globalOffset(page)).toBe(50);
  const native = await page.evaluate(() => ({ state: (window as any).fixturePlayback, commands: (window as any).fixtureCommands }));
  expect(native.state.position).toBe(10.25); expect(native.state.playing).toBe(false); expect(native.commands).toEqual([]);
  expect(errors).toEqual([]);
});

test('song offsets retain source identity, metadata refreshes and app reload', async ({ page }) => {
  await startLocal(page); await openTools(page); await setOffset(page, 500);
  await page.evaluate(() => { const w = window as any; w.fixtureEmitPlayback({ currentSong: { ...w.fixturePlayback.currentSong, name: '更新后的歌名' } }); });
  await expect(tools(page).getByRole('spinbutton', { name: '时间轴偏移' })).toHaveValue('500');
  for (const [provider, value] of [['netease', 250], ['qq', -250]] as const) {
    await page.evaluate(provider => {
      const w = window as any;
      w.fixtureEmitPlayback({ currentSong: { ...w.fixturePlayback.currentSong, id: 42,
        sourceRef: { kind: 'online', providerId: provider, mediaId: '42' } } });
    }, provider);
    await expect(tools(page)).toBeHidden(); await openTools(page);
    await expect(tools(page).getByRole('spinbutton', { name: '时间轴偏移' })).toHaveValue('0');
    await setOffset(page, value, 'online:' + provider + ':42');
  }
  expect(await savedOffsets(page)).toEqual({ [localKey]: 500, 'online:netease:42': 250, 'online:qq:42': -250 });
  await page.reload();
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await openTools(page);
  await expect(tools(page).getByRole('spinbutton', { name: '时间轴偏移' })).toHaveValue('500');
  await tools(page).getByRole('button', { name: '重置时间轴偏移', exact: true }).click();
  await expect.poll(() => savedOffsets(page)).toEqual({ 'online:netease:42': 250, 'online:qq:42': -250 });
});

test('Monet lyric taps seek the corrected audio position and foreground restore resyncs', async ({ page }) => {
  await startLocal(page, 5);
  await clickPlayerTool(page, '歌词与动效');
  await page.getByLabel('歌词动画', { exact: true }).selectOption('monet');
  await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
  await openTools(page); await setOffset(page, 500); await openCalibration(page);
  await calibration(page).getByRole('button', { name: '+50ms', exact: true }).click();
  await calibration(page).getByRole('button', { name: '应用', exact: true }).click();
  await tools(page).getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.lyric-stage').getByRole('button', { name: '第二句', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.position)).toBeCloseTo(10.55, 5);
  await expect(page.locator('.player-panel')).toHaveAttribute('data-controls-hidden', 'false');
  await page.evaluate(() => {
    const w = window as any;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.fixtureHidden });
    w.fixtureHidden = true; document.dispatchEvent(new Event('visibilitychange'));
    w.fixturePlayback.position = 8;
    w.fixtureHidden = false; document.dispatchEvent(new Event('visibilitychange'));
  });
  await openTools(page); await openCalibration(page);
  await expect.poll(() => highlightPercent(page)).toBeCloseTo(74.5, 3);
  await calibration(page).getByRole('button', { name: '返回', exact: true }).click();
  await setOffset(page, -1000);
  await tools(page).getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.lyric-stage').getByRole('button', { name: '测试本地歌词', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.position)).toBe(0);
});

test('opening timing tools during a slow lyric load still receives the preview', async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureLocalLyricDelay = true; });
  await startLocal(page);
  await expect.poll(() => page.evaluate(() => (window as any).fixturePendingLocalLyrics?.length || 0)).toBeGreaterThan(0);
  await openTools(page); await setOffset(page, 500); await openCalibration(page);
  await page.evaluate(() => {
    const w = window as any; w.fixtureLocalLyricDelay = false;
    for (const finish of w.fixturePendingLocalLyrics) finish();
  });
  await expect.poll(() => highlightPercent(page)).toBeCloseTo(97.5, 3);
});

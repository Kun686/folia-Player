import { test, expect, clickPlayerTool } from './fixtures';
import type { Page } from '@playwright/test';

// random-visualizer.spec.ts — the original per-song setting follows native identity snapshots, not UI mounts.
const label = '每首歌随机歌词动画';
const mode = (page: Page) => page.evaluate(() => localStorage.getItem('visualizer_mode'));
async function start(page: Page, enabled = false) {
  await page.addInitScript(enabled => {
    const win = window as any;
    win.fixtureNoServer = true;
    win.fixtureLyricTools = true;
    win.fixtureLocalLyric = { embeddedContent: '[00:00.00]第一句\n[00:10.00]第二句', lyricsSource: 'embedded' };
    Math.random = () => 0; // Select a predictable registry candidate; production still uses the original hook.
    if (!sessionStorage.getItem('random-test-seeded')) {
      localStorage.setItem('visualizer_mode', 'cadenza');
      localStorage.setItem('random_visualizer_mode_per_song', String(enabled));
      localStorage.setItem('folia_transition_animation', 'false');
      localStorage.setItem('folia_transition_animation_card', 'false');
      sessionStorage.setItem('random-test-seeded', 'true');
    }
  }, enabled);
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 1 }));
}
async function song(page: Page, provider: 'local' | 'qq' | 'netease', id: string) {
  await page.evaluate(({ provider, id }) => {
    const win = window as any, previous = win.fixturePlayback.currentSong;
    win.fixtureEmitPlayback({ playing: false, currentSong: { ...previous, id, name: `Song ${provider} ${id}`,
      sourceRef: provider === 'local' ? { kind: 'local', mediaId: id } : { kind: 'online', providerId: provider, mediaId: id } } });
  }, { provider, id });
}

test('stored setting switches only on a new song, including collapsed playback and cross-provider IDs', async ({ page }) => {
  await start(page, true);
  await clickPlayerTool(page, '歌词与动效');
  await expect(page.getByLabel('歌词动画', { exact: true })).toHaveValue('cadenza');
  await expect.poll(() => mode(page)).toBe('cadenza'); // Initial restoration is not a song change.
  await page.evaluate(() => {
    const win = window as any;
    win.fixtureEmitPlayback({ position: 5, playing: false, currentSong: { ...win.fixturePlayback.currentSong, name: 'Updated title' } });
  });
  await expect(page.getByLabel('歌词动画', { exact: true })).toHaveValue('cadenza');
  await page.getByRole('dialog', { name: '歌词与动效', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '返回音乐库' }).tap();
  await song(page, 'qq', '42');
  await expect.poll(() => mode(page)).not.toBe('cadenza');
  const first = await mode(page);
  await song(page, 'netease', '42');
  await expect.poll(() => mode(page)).not.toBe(first);
  const second = await mode(page);
  await song(page, 'netease', '42');
  await page.locator('.mini-title').tap();
  await clickPlayerTool(page, '歌词与动效');
  await expect(page.getByLabel('歌词动画', { exact: true })).toHaveValue(second!);
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.getByLabel('歌词动画', { exact: true })).toHaveValue(second!);
});

test('touch toggle preserves the current choice, honors manual selection, and persists across reload', async ({ page }) => {
  await start(page);
  await clickPlayerTool(page, '歌词与动效');
  const toggle = page.getByRole('checkbox', { name: label, exact: true });
  const select = page.getByLabel('歌词动画', { exact: true });
  await expect(toggle).not.toBeChecked();
  await toggle.tap();
  await expect(toggle).toBeChecked();
  await expect(select).toHaveValue('cadenza');
  await page.screenshot({ path: test.info().outputPath('random-control.png') });
  await song(page, 'local', 'next');
  await expect(select).not.toHaveValue('cadenza');
  await select.selectOption('sonnet');
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ position: 14, playing: false }));
  await expect(select).toHaveValue('sonnet');
  await toggle.tap();
  await expect(toggle).not.toBeChecked();
  await song(page, 'local', 'while-disabled');
  await expect(select).toHaveValue('sonnet');
  await toggle.tap();
  await expect(select).toHaveValue('sonnet');
  await page.reload();
  await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false }));
  await clickPlayerTool(page, '歌词与动效');
  await expect(toggle).toBeChecked();
  await expect(select).toHaveValue('sonnet');
  await song(page, 'local', 'after-reload');
  await expect(select).not.toHaveValue('sonnet');
});

test('original JSON and appearance code restore both the random flag and its actual behavior', async ({ page }) => {
  await start(page);
  await clickPlayerTool(page, '歌词与动效');
  await page.locator('.appearance-transfer > summary').tap();
  const text = page.locator('.appearance-transfer textarea');
  await text.fill(JSON.stringify({ randomVisualizerModePerSong: true, visualizerMode: 'sonnet' }));
  await page.locator('.appearance-transfer').getByRole('button', { name: '应用外观配置', exact: true }).tap();
  const toggle = page.getByRole('checkbox', { name: label, exact: true });
  const select = page.getByLabel('歌词动画', { exact: true });
  await expect(toggle).toBeChecked();
  await expect(select).toHaveValue('sonnet');
  await page.locator('.appearance-transfer').getByRole('button', { name: '生成外观短码', exact: true }).tap();
  const code = await text.inputValue();
  expect(code.length).toBeGreaterThan(10);
  await toggle.tap();
  await expect(toggle).not.toBeChecked();
  await select.selectOption('cadenza');
  await text.fill(code);
  await page.locator('.appearance-transfer').getByRole('button', { name: '应用外观配置', exact: true }).tap();
  await expect(toggle).toBeChecked();
  await expect(select).toHaveValue('sonnet');
  await song(page, 'local', 'restored-option');
  await expect(select).not.toHaveValue('sonnet');
});

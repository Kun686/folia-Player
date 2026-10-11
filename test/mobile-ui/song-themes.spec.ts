import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';
import { BASE_DUAL_THEME } from '../../src/services/baseThemes';
import { decompressConfig } from '../../src/utils/appearanceCodec';

// song-themes.spec.ts — real IndexedDB theme storage with fixture native song events; no remote AI or real-provider claims.
const editor = (page: Page) => page.getByRole('dialog', { name: 'Theme Park · 主题编辑', exact: true });
const track = (provider: 'qq' | 'netease', id = '42') => ({ id, name: `${provider} song ${id}`, artists: [{ id: 0, name: provider }],
  album: { id: 0, name: '' }, durationMs: 180000, sourceRef: { kind: 'online', providerId: provider, mediaId: id } });
async function emit(page: Page, provider: 'qq' | 'netease', id = '42') {
  await page.evaluate(song => (window as any).fixtureEmitPlayback({ currentSong: song, queue: [song], index: 0, position: 0, playing: false }), track(provider, id));
}
async function playLocal(page: Page) {
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
}
async function openEditor(page: Page) {
  await page.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true }).click();
  await editor(page).getByRole('button', { name: 'AI 主题', exact: true }).click();
  await editor(page).getByRole('button', { name: '信息', exact: true }).click();
}
async function saveName(page: Page, name: string) {
  await openEditor(page); await editor(page).getByRole('textbox').nth(2).fill(name);
  await editor(page).getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
}
async function appliedName(page: Page) {
  const area = page.locator('.appearance-transfer');
  if (!(await area.evaluate(node => (node as HTMLDetailsElement).open))) await area.locator('summary').click();
  await area.getByRole('button', { name: '生成外观短码', exact: true }).click();
  return decompressConfig(await area.getByRole('textbox').inputValue()).theme.dark.name;
}
async function seed(page: Page) {
  await page.evaluate(async ({ songs, base }) => {
    const { saveEditedSongTheme } = await import(new URL('/src/services/songThemeCache.ts', location.href).href);
    for (const song of songs) await saveEditedSongTheme(song, { light: { ...base.light, name: song.artists[0].name }, dark: { ...base.dark, name: song.artists[0].name } }, () => true);
  }, { songs: [track('qq'), track('netease')], base: BASE_DUAL_THEME });
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
  await page.goto('/mobile.html'); await playLocal(page); await emit(page, 'qq'); await clickPlayerTool(page, '歌词与动效');
});
test('per-song editing, source identity, auto-switch, misses, manual apply and restart preserve original choices', async ({ page }) => {
  await saveName(page, 'QQ Theme');
  await emit(page, 'netease'); await saveName(page, 'NetEase Theme');
  await emit(page, 'qq');
  await expect(page.getByText('已保存的歌曲主题：QQ Theme', { exact: true })).toBeVisible();
  await expect.poll(() => appliedName(page)).toBe('QQ Theme');
  await emit(page, 'netease', 'missing');
  await expect(page.getByText('这首歌还没有保存主题。', { exact: true })).toBeVisible();
  expect(await appliedName(page)).toBe('QQ Theme');
  await page.getByLabel('切歌时自动使用已保存的歌曲主题').uncheck();
  await emit(page, 'netease');
  await expect(page.getByText('已保存的歌曲主题：NetEase Theme', { exact: true })).toBeVisible();
  expect(await appliedName(page)).toBe('QQ Theme');
  await page.getByRole('button', { name: '应用本曲主题', exact: true }).click();
  expect(await appliedName(page)).toBe('NetEase Theme');
  await page.reload(); await playLocal(page); await emit(page, 'qq'); await clickPlayerTool(page, '歌词与动效');
  await expect(page.getByLabel('切歌时自动使用已保存的歌曲主题')).not.toBeChecked();
  await expect.poll(() => appliedName(page)).toBe('NetEase Theme');
});
test('song changes retain the draft without writing it to another song; storage failures can retry', async ({ page }) => {
  await openEditor(page); await editor(page).getByRole('textbox').nth(2).fill('Stale draft');
  await emit(page, 'netease');
  await expect(editor(page).getByRole('alert')).toContainText('歌曲已切换');
  await expect(editor(page).getByRole('textbox').nth(2)).toHaveValue('Stale draft');
  await expect(editor(page).getByRole('button', { name: '保存并应用', exact: true })).toBeDisabled();
  await emit(page, 'qq');
  await expect(editor(page).getByRole('button', { name: '保存并应用', exact: true })).toBeDisabled();
  await emit(page, 'netease');
  await editor(page).getByRole('button', { name: '取消', exact: true }).click();
  await openEditor(page); await editor(page).getByRole('textbox').nth(2).fill('Retried theme');
  await page.evaluate(() => {
    (window as any).themeWriteFailure = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function(value, key) {
      if ((window as any).themeWriteFailure && this.name === 'api_cache' && String(value.key).startsWith('dual_theme_')) throw new DOMException('Full', 'QuotaExceededError');
      return key === undefined ? put.call(this, value) : put.call(this, value, key);
    };
  });
  await editor(page).getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect(editor(page).getByRole('alert')).toContainText('草稿已保留');
  await expect(editor(page).getByRole('textbox').nth(2)).toHaveValue('Retried theme');
  await page.evaluate(() => { (window as any).themeWriteFailure = false; });
  await editor(page).getByRole('button', { name: '保存并应用', exact: true }).click();
  await expect(editor(page)).toHaveCount(0);
  const saved = await page.evaluate(async () => {
    const { readCacheEntry } = await import(new URL('/src/services/repositories/cacheRepository.ts', location.href).href);
    return [await readCacheEntry('dual_theme_online:qq:42'), await readCacheEntry('dual_theme_online:netease:42')];
  });
  expect(saved[0]).toBeNull(); expect(saved[1]).toMatchObject({ dark: { name: 'Retried theme' } });
});
for (const returnToOpeningSong of [false, true]) test(`a delayed read cannot replace native intent (return=${returnToOpeningSong})`, async ({ page }) => {
  await seed(page); await emit(page, 'qq', 'other');
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get;
    const handler = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'onsuccess')!;
    IDBObjectStore.prototype.get = function(key) {
      const request = get.call(this, key);
      if (key === 'dual_theme_online:qq:42' && !(window as any).delayedThemeRead) {
        (window as any).delayedThemeRead = true;
        Object.defineProperty(request, 'onsuccess', { configurable: true, set(callback) {
          handler.set!.call(request, (event: Event) => { (window as any).releaseThemeRead = () => callback.call(request, event); });
        } });
      }
      return request;
    };
  });
  await emit(page, 'qq');
  await expect.poll(() => page.evaluate(() => typeof (window as any).releaseThemeRead)).toBe('function');
  if (returnToOpeningSong) await page.evaluate(songs => {
    for (const song of songs) (window as any).fixtureEmitPlayback({ currentSong: song, queue: [song], index: 0, position: 0, playing: false });
  }, [track('netease'), track('qq')]);
  else await emit(page, 'netease');
  const expected = returnToOpeningSong ? 'qq' : 'netease';
  await expect(page.getByText(`已保存的歌曲主题：${expected}`, { exact: true })).toBeVisible();
  await expect.poll(() => appliedName(page)).toBe(expected);
  await expect(page.getByRole('button', { name: 'Theme Park · 主题编辑', exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    (window as any).releaseThemeRead();
    await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame);
  });
  await expect(page.getByText(`已保存的歌曲主题：${expected}`, { exact: true })).toBeVisible();
  expect(await appliedName(page)).toBe(expected);
  await expect(page.locator('.mobile-song-theme [role=alert]')).toHaveCount(0);
});
test('the installed custom preference remains pinned until original auto-switch is enabled', async ({ page }) => {
  await seed(page);
  await page.addInitScript(base => {
    localStorage.setItem('custom_dual_theme', JSON.stringify({ light: { ...base.light, name: 'Pinned' }, dark: { ...base.dark, name: 'Pinned' } }));
    localStorage.setItem('last_applied_theme_pointer', 'custom'); localStorage.removeItem('custom_theme_preferred');
  }, BASE_DUAL_THEME);
  await page.reload(); await playLocal(page); await emit(page, 'qq'); await clickPlayerTool(page, '歌词与动效');
  await expect(page.getByLabel('切歌时自动使用已保存的歌曲主题')).not.toBeChecked();
  expect(await appliedName(page)).toBe('Pinned');
  await page.getByLabel('切歌时自动使用已保存的歌曲主题').check();
  await emit(page, 'netease');
  await expect.poll(() => appliedName(page)).toBe('netease');
  expect(await page.evaluate(() => localStorage.getItem('custom_theme_preferred'))).toBe('false');
});

test('auto-switch survives appearance code export and import', async ({ page }) => {
  await page.getByLabel('切歌时自动使用已保存的歌曲主题').uncheck();
  await appliedName(page);
  const input = page.getByRole('textbox', { name: 'Folia 外观短码或 JSON' });
  const code = await input.inputValue();
  expect(decompressConfig(code).songThemeAutoSwitchEnabled).toBe(false);
  await page.getByLabel('切歌时自动使用已保存的歌曲主题').check();
  await input.fill(code);
  await page.getByRole('button', { name: '应用外观配置', exact: true }).click();
  await expect(page.getByLabel('切歌时自动使用已保存的歌曲主题')).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('theme_auto_switch_enabled'))).toBe('false');
});

test('a failed cache read shows recovery without discarding the applied theme', async ({ page }) => {
  await seed(page); await emit(page, 'netease');
  await expect.poll(() => appliedName(page)).toBe('netease');
  await page.evaluate(() => {
    const get = IDBObjectStore.prototype.get;
    (window as any).themeReadFailure = true;
    IDBObjectStore.prototype.get = function(key) {
      if ((window as any).themeReadFailure && this.name === 'api_cache') throw new DOMException('Unavailable', 'UnknownError');
      return get.call(this, key);
    };
  });
  await emit(page, 'qq');
  await expect(page.locator('.mobile-song-theme [role=alert]')).toBeVisible();
  expect(await appliedName(page)).toBe('netease');
  await page.evaluate(() => { (window as any).themeReadFailure = false; });
  await page.locator('.mobile-song-theme').getByRole('button', { name: '重试', exact: true }).click();
  await expect.poll(() => appliedName(page)).toBe('qq');
  await expect(page.locator('.mobile-song-theme [role=alert]')).toHaveCount(0);
});

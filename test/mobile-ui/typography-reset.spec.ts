import type { Locator, Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';
import { decompressConfig } from '../../src/utils/appearanceCodec';

// typography-reset.spec.ts — desktop section reset parity; empty queue, no music/provider acceptance.
const commonValues = {
  lyrics_font_style: 'mono', lyrics_font_scale: '1.3', lyrics_font_weight: '650',
  lyrics_custom_font: JSON.stringify({ source: 'system', family: 'Georgia', label: 'Georgia' }),
  lyrics_font_fallback_families: '["serif"]', visualizer_opacity: '0.4',
};
const subtitleValues = {
  hide_player_translation_subtitle: 'true', show_subtitle_translation: 'true', subtitle_content_mode: 'both',
  subtitle_overlay_background: 'false', subtitle_upcoming_lyrics_blur: 'false',
  show_harmony_subtitle: 'false', harmony_subtitle_background: 'false', subtitle_overlay_opacity: '0.3',
  subtitle_font_scale: '1.25', subtitle_font_inherits_lyrics: 'false', subtitle_font_style: 'serif',
  subtitle_font_weight: '600', subtitle_font_family: 'Georgia', subtitle_font_fallback_families: '["serif"]',
};
const commonDefaults = {
  lyrics_font_style: 'sans', lyrics_font_scale: '1', lyrics_font_weight: null,
  lyrics_custom_font: null, lyrics_font_fallback_families: '[]', visualizer_opacity: '1',
};
const subtitleDefaults = {
  hide_player_translation_subtitle: 'false', show_subtitle_translation: 'true', subtitle_content_mode: 'translation',
  subtitle_overlay_background: 'true', subtitle_upcoming_lyrics_blur: 'true',
  show_harmony_subtitle: 'true', harmony_subtitle_background: 'true', subtitle_overlay_opacity: '0.6',
  subtitle_font_scale: '1', subtitle_font_inherits_lyrics: 'true', subtitle_font_style: 'sans',
  subtitle_font_weight: null, subtitle_font_family: null, subtitle_font_fallback_families: '[]',
};
const protectedValues = { visualizer_mode: 'cadenza', background_opacity: '0.4', visualizer_background_mode: 'common' };
const readSettings = (page: Page, keys: string[]) => page.evaluate(keys =>
  Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys);

async function tapReset(section: Locator) {
  const button = section.getByRole('button', { name: '默认', exact: true });
  await button.scrollIntoViewIfNeeded();
  await expect(button).toBeInViewport();
  expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await button.tap();
}

test('common and subtitle resets remain isolated, export defaults and survive rotation/reload', async ({ page }, info) => {
  const seed = { ...commonValues, ...subtitleValues, ...protectedValues };
  await page.addInitScript(values => {
    if (sessionStorage.getItem('typography-reset-seeded')) return;
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    sessionStorage.setItem('typography-reset-seeded', 'yes');
  }, seed);
  const open = async () => {
    await page.locator('.mini-title').tap();
    await clickPlayerTool(page, '歌词与动效');
  };
  await page.goto('/mobile.html');
  await open();
  const dialog = page.getByRole('dialog', { name: '歌词与动效', exact: true });
  const common = dialog.locator('.typography-controls > details').nth(0);
  const subtitles = dialog.locator('.typography-controls > details').nth(1);
  await common.locator('summary').tap();
  await tapReset(common);
  await expect.poll(() => readSettings(page, Object.keys(seed))).toEqual({ ...seed, ...commonDefaults });
  await expect(common.getByLabel('字体', { exact: true })).toHaveValue('sans');
  await expect(common.getByRole('slider', { name: /^字号/ })).toHaveValue('1');
  await expect(common.getByRole('checkbox', { name: '自动字重', exact: true })).toBeChecked();
  await expect(common.getByRole('button', { name: '恢复内置字体', exact: true })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('common-reset.png') });
  await common.locator('summary').tap();
  await subtitles.locator('summary').tap();
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  await tapReset(subtitles);
  const expected = { ...protectedValues, ...commonDefaults, ...subtitleDefaults };
  await expect.poll(() => readSettings(page, Object.keys(seed))).toEqual(expected);
  await expect(subtitles.getByRole('checkbox', { name: '隐藏底部字幕层', exact: true })).not.toBeChecked();
  await expect(subtitles.getByRole('checkbox', { name: '字幕继承歌词字体', exact: true })).toBeChecked();
  await expect(subtitles.getByRole('slider', { name: /^字幕缩放/ })).toHaveValue('1');
  await expect(subtitles.getByRole('slider', { name: /^字幕透明度/ })).toHaveValue('0.6');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath('subtitle-reset-rotated.png') });
  await dialog.locator('.appearance-transfer > summary').tap();
  await dialog.getByRole('button', { name: '生成外观短码', exact: true }).tap();
  const exported = decompressConfig(await dialog.getByLabel('Folia 外观短码或 JSON', { exact: true }).inputValue());
  expect(exported).toMatchObject({ lyricsFontStyle: 'sans', lyricsFontScale: 1, lyricsFontWeight: null,
    lyricsFontFallbackFamilies: [], visualizerOpacity: 1, hidePlayerTranslationSubtitle: false,
    subtitleContentMode: 'translation', subtitleOverlayBackground: true, subtitleUpcomingLyricsBlur: true,
    subtitleOverlayOpacity: 0.6, showHarmonySubtitle: true, harmonySubtitleBackground: true,
    subtitleFontInheritsLyrics: true, subtitleFontScale: 1, subtitleFontStyle: 'sans', subtitleFontWeight: null,
    subtitleFontFallbackFamilies: [], visualizerMode: 'cadenza', backgroundOpacity: 0.4 });
  // Applying the exported defaults must remove subsequently selected fallback fonts.
  await common.locator('summary').tap();
  await common.getByLabel('备用字体', { exact: true }).fill('serif');
  await common.getByLabel('备用字体', { exact: true }).blur();
  await subtitles.getByRole('checkbox', { name: '字幕继承歌词字体', exact: true }).uncheck();
  await subtitles.getByLabel('字幕备用字体', { exact: true }).fill('serif');
  await subtitles.getByLabel('字幕备用字体', { exact: true }).blur();
  await expect.poll(() => readSettings(page, ['lyrics_font_fallback_families', 'subtitle_font_fallback_families']))
    .toEqual({ lyrics_font_fallback_families: '["serif"]', subtitle_font_fallback_families: '["serif"]' });
  await dialog.getByRole('button', { name: '应用外观配置', exact: true }).tap();
  await expect.poll(() => readSettings(page, Object.keys(seed))).toEqual(expected);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  await page.reload();
  await open();
  expect(await readSettings(page, Object.keys(seed))).toEqual(expected);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

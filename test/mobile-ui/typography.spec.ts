import type { Locator, Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';
import { compressConfig } from '../../src/utils/appearanceCodec';

// typography.spec.ts — original parser/renderers/stores over a native bridge fixture; no provider claim.
const sheet = (page: Page) => page.getByRole('dialog', { name: '歌词与动效', exact: true });
const common = (page: Page) => sheet(page).locator('.typography-controls > details').nth(0);
const subtitles = (page: Page) => sheet(page).locator('.typography-controls > details').nth(1);
const open = (page: Page) => clickPlayerTool(page, '歌词与动效');
const close = (page: Page) => sheet(page).locator('header').getByRole('button', { name: '关闭', exact: true }).click();
async function range(input: Locator, value: string) {
  await input.evaluate((node, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(node, value);
    node.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}
async function play(page: Page) {
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 1 }));
}
async function start(page: Page) {
  await page.addInitScript(() => {
    const w = window as any; w.fixtureNoServer = true;
    w.fixtureLocalLyric = { embeddedContent: '[00:00.00]第一句歌词\n[00:10.00]第二句歌词',
      embeddedTranslation: '[00:00.00]Translated first line\n[00:10.00]Translated second line', lyricsSource: 'embedded' };
  });
  await page.goto('/mobile.html'); await play(page);
}

test('typography edits persist, apply to lyrics and retain original automatic sizing rules', async ({ page }) => {
  await start(page); await open(page);
  await common(page).locator('summary').click();
  expect((await common(page).getByLabel('字体', { exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await common(page).getByLabel('字体', { exact: true }).selectOption('mono');
  await range(common(page).getByRole('slider', { name: /^字号/ }), '1.2');
  await common(page).getByRole('checkbox', { name: '自动字重', exact: true }).uncheck();
  await range(common(page).getByRole('slider', { name: /^字重/ }), '600');
  await range(common(page).getByRole('slider', { name: /^整体透明度/ }), '0.5');
  await common(page).getByLabel('备用字体', { exact: true }).fill('Georgia, Georgia, serif');
  await common(page).getByLabel('备用字体', { exact: true }).blur();
  await expect(common(page).getByLabel('备用字体', { exact: true })).toHaveValue('Georgia, serif');
  await page.getByLabel('歌词动画', { exact: true }).selectOption('sonnet');
  await expect(common(page).getByRole('slider', { name: /^字号/ })).toBeDisabled();
  await page.getByLabel('歌词动画', { exact: true }).selectOption('classic');
  await close(page);
  await expect.poll(() => page.evaluate(() => localStorage.getItem('lyrics_font_weight'))).toBe('600');
  await expect.poll(() => page.locator('.lyric-stage').evaluate(node => [...node.querySelectorAll<HTMLElement>('*')]
    .some(el => el.style.opacity === '0.5'))).toBe(true);
  await page.reload(); await play(page); await open(page); await common(page).locator('summary').click();
  await expect(common(page).getByLabel('字体', { exact: true })).toHaveValue('mono');
  await expect(common(page).getByRole('slider', { name: /^字重/ })).toHaveValue('600');
  await expect(common(page).getByRole('slider', { name: /^字号/ })).toHaveValue('1.2');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('typography-common.png') });
});

test('subtitle visibility reaches original renderer and non-sync fields round-trip in appearance codes', async ({ page }) => {
  await start(page);
  const translated = page.locator('.lyric-stage [data-subtitle-track="translation"]');
  await expect(translated).toHaveText('Translated first line');
  await open(page); await subtitles(page).locator('summary').click();
  const hide = subtitles(page).getByRole('checkbox', { name: '隐藏底部字幕层', exact: true });
  await hide.check(); await close(page); await expect(translated).toHaveCount(0);
  await open(page); await subtitles(page).locator('summary').click(); await hide.uncheck();
  await subtitles(page).getByRole('checkbox', { name: '字幕继承歌词字体', exact: true }).uncheck();
  await subtitles(page).getByLabel('字幕主字体', { exact: true }).fill('Georgia');
  await close(page);
  await expect(translated).toHaveText('Translated first line');
  await expect(translated).toHaveCSS('font-family', /Georgia/);
  await open(page); await sheet(page).locator('.appearance-transfer > summary').click();
  await page.getByLabel('Folia 外观短码或 JSON', { exact: true }).fill(compressConfig({ subtitleFontScale: 1.25,
    subtitleOverlayOpacity: 0.4, showHarmonySubtitle: false, harmonySubtitleBackground: false, lyricsCustomFontFamily: 'Georgia' }));
  await sheet(page).getByRole('button', { name: '应用外观配置', exact: true }).click();
  await subtitles(page).locator('summary').click();
  await expect(subtitles(page).getByRole('slider', { name: /^字幕缩放/ })).toHaveValue('1.25');
  await expect(subtitles(page).getByRole('slider', { name: /^字幕透明度/ })).toHaveValue('0.4');
  await expect(subtitles(page).getByRole('checkbox', { name: '显示和声字幕', exact: true })).not.toBeChecked();
  await sheet(page).getByRole('button', { name: '生成外观短码', exact: true }).click();
  expect(await page.getByLabel('Folia 外观短码或 JSON', { exact: true }).inputValue()).toContain('folia-theme://');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('typography-subtitles.png') });
});

test('invalid uploaded font preserves current choice and remains retryable', async ({ page }) => {
  await start(page); await open(page); await common(page).locator('summary').click();
  await common(page).getByLabel('字体', { exact: true }).selectOption('serif');
  await common(page).locator('input[type=file]').setInputFiles({ name: 'invalid.ttf', mimeType: 'font/ttf', buffer: Buffer.from('invalid font bytes') });
  await expect(common(page).getByRole('alert')).toBeVisible();
  await expect(common(page).getByLabel('字体', { exact: true })).toHaveValue('serif');
  await expect(common(page).getByRole('button', { name: '上传自定义字体', exact: true })).toBeEnabled();
  await expect(sheet(page).locator('header').getByRole('button', { name: '关闭', exact: true })).toBeEnabled();
});

test('actual host font loads, restores after reload and releases on clear', async ({ page }) => {
  test.skip(!process.env.FOLIA_TEST_FONT, 'Local licensed font supplied through FOLIA_TEST_FONT; no font fixture is redistributed.');
  await start(page); await open(page); await common(page).locator('summary').click();
  await common(page).locator('input[type=file]').setInputFiles(process.env.FOLIA_TEST_FONT!);
  await expect(common(page).getByRole('button', { name: '恢复内置字体', exact: true })).toBeVisible();
  const family = await page.evaluate(() => JSON.parse(localStorage.getItem('lyrics_custom_font')!).family as string);
  await expect.poll(() => page.evaluate(f => document.fonts.check(`16px "${f}"`), family)).toBe(true);
  await page.reload(); await play(page); await open(page); await common(page).locator('summary').click();
  await expect(common(page).getByLabel('字体', { exact: true })).toHaveValue('custom');
  await expect.poll(() => page.evaluate(f => Array.from(document.fonts).some(font => font.family === f && font.status === 'loaded'), family)).toBe(true);
  await common(page).getByRole('button', { name: '恢复内置字体', exact: true }).click();
  await expect.poll(() => page.evaluate(f => Array.from(document.fonts).some(font => font.family === f), family)).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem('lyrics_custom_font'))).toBeNull();
});

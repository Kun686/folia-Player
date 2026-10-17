import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';
import {
  DEFAULT_CLASSIC_TUNING, DEFAULT_PARTITA_TUNING, DEFAULT_FUME_TUNING, DEFAULT_CLADDAGH_TUNING,
  DEFAULT_CAPPELLA_TUNING, DEFAULT_TILT_TUNING, DEFAULT_DIORAMA_TUNING, DEFAULT_MONET_TUNING,
  DEFAULT_PENDOLO_TUNING, DEFAULT_SONNET_TUNING, DEFAULT_TEMPERA_TUNING, DEFAULT_LUMIERE_TUNING,
  DEFAULT_MONET_BACKGROUND_TUNING, DEFAULT_NOMAND_BACKGROUND_TUNING, DEFAULT_LATENT_BACKGROUND_TUNING,
  DEFAULT_SORA_BACKGROUND_TUNING,
} from '../../src/types';

// visual-reset.spec.ts — reset the selected desktop-defined settings only; empty queue, no provider claims.
const modes = [
  { mode: 'classic', defaults: DEFAULT_CLASSIC_TUNING, patch: { enableWordRotation: false } },
  { mode: 'partita', defaults: DEFAULT_PARTITA_TUNING, patch: { showGuideLines: false } },
  { mode: 'fume', defaults: DEFAULT_FUME_TUNING, patch: { hidePrintSymbols: true } },
  { mode: 'claddagh', defaults: DEFAULT_CLADDAGH_TUNING, patch: { showAxisLine: false } },
  { mode: 'cappella', defaults: DEFAULT_CAPPELLA_TUNING, patch: { showEmoMessages: false } },
  { mode: 'tilt', defaults: DEFAULT_TILT_TUNING, patch: { splitProbability: 0.2 } },
  { mode: 'diorama', defaults: DEFAULT_DIORAMA_TUNING, patch: { motionAmount: 0.5 } },
  { mode: 'monet', defaults: DEFAULT_MONET_TUNING, patch: { showDescription: false } },
  { mode: 'pendolo', defaults: DEFAULT_PENDOLO_TUNING, patch: { showCoverOnWatchFace: true } },
  { mode: 'sonnet', defaults: DEFAULT_SONNET_TUNING, patch: { showOnlyText: true } },
  { mode: 'tempera', defaults: DEFAULT_TEMPERA_TUNING, patch: { wholeLineLyrics: true } },
  { mode: 'lumiere', defaults: DEFAULT_LUMIERE_TUNING, patch: { lightIntensity: 0.6 } },
];
const backgrounds = [
  { mode: 'monet', defaults: DEFAULT_MONET_BACKGROUND_TUNING, patch: { backgroundBlurPx: 12 } },
  { mode: 'nomand', defaults: DEFAULT_NOMAND_BACKGROUND_TUNING, patch: { inverted: true } },
  { mode: 'latent', defaults: DEFAULT_LATENT_BACKGROUND_TUNING, patch: { enhancedBeatResponse: false } },
  { mode: 'sora', defaults: DEFAULT_SORA_BACKGROUND_TUNING, patch: { blank: true } },
];
const readSettings = (page: Page, keys: string[]) => page.evaluate(keys =>
  Object.fromEntries(keys.map(key => [key, localStorage.getItem(key)])), keys);

async function seedSettings(page: Page, values: Record<string, string>) {
  await page.addInitScript(values => {
    if (sessionStorage.getItem('visual-reset-seeded')) return;
    for (const [key, value] of Object.entries(values)) localStorage.setItem(key, value);
    sessionStorage.setItem('visual-reset-seeded', 'yes');
  }, values);
}
async function openSettings(page: Page) {
  await page.locator('.mini-title').tap();
  await clickPlayerTool(page, '歌词与动效');
  return page.getByRole('dialog', { name: '歌词与动效', exact: true });
}

test('all available animation resets preserve other tunings and survive reload', async ({ page }, info) => {
  test.setTimeout(90000);
  const values: Record<string, string> = Object.fromEntries(modes.map(item =>
    [`${item.mode}_tuning`, JSON.stringify({ ...item.defaults, ...item.patch })]));
  Object.assign(values, { lyrics_font_scale: '1.2', background_opacity: '0.4' });
  await seedSettings(page, { ...values, visualizer_mode: 'classic' });
  await page.goto('/mobile.html');
  const dialog = await openSettings(page);
  const select = dialog.getByLabel('歌词动画', { exact: true });
  const reset = dialog.getByRole('button', { name: '重置歌词动画参数', exact: true });
  for (const item of modes) {
    await select.selectOption(item.mode);
    await expect(reset).toBeEnabled();
    await reset.tap();
    expect((await reset.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    values[`${item.mode}_tuning`] = JSON.stringify(item.defaults);
    await expect.poll(() => readSettings(page, Object.keys(values))).toEqual(values);
    await expect(select).toHaveValue(item.mode);
  }
  await page.screenshot({ path: info.outputPath('animation-reset.png') });
  for (const mode of ['cadenza', 'still']) {
    await select.selectOption(mode);
    await expect(reset).toHaveCount(0);
  }
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  await page.reload();
  await openSettings(page);
  expect(await readSettings(page, Object.keys(values))).toEqual(values);
});

test('background reset stays scoped through rotation and reload', async ({ page }, info) => {
  test.setTimeout(90000);
  const common = { background_opacity: '0.4', use_cover_color_bg: 'true', disable_visualizer_vignette: 'true', disable_visualizer_geometric_background: 'true' };
  const values: Record<string, string> = Object.fromEntries(backgrounds.map(item =>
    [`${item.mode}_background_tuning`, JSON.stringify({ ...item.defaults, ...item.patch })]));
  Object.assign(values, common, { classic_tuning: JSON.stringify({ ...DEFAULT_CLASSIC_TUNING, enableWordRotation: false }), lyrics_font_scale: '1.2' });
  await seedSettings(page, { ...values, visualizer_mode: 'classic', visualizer_background_mode: 'monet' });
  await page.goto('/mobile.html');
  const dialog = await openSettings(page);
  const select = dialog.getByLabel('背景效果', { exact: true });
  const details = dialog.locator('details').filter({ has: page.locator('summary').getByText('背景效果', { exact: true }) });
  await details.locator('summary').tap();
  const reset = details.getByRole('button', { name: '默认', exact: true });
  for (const item of backgrounds) {
    await select.selectOption(item.mode);
    await reset.tap();
    values[`${item.mode}_background_tuning`] = JSON.stringify(item.defaults);
    await expect.poll(() => readSettings(page, Object.keys(values))).toEqual(values);
    await expect(select).toHaveValue(item.mode);
  }
  await select.selectOption('common');
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  await reset.tap();
  expect((await reset.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  Object.assign(values, { background_opacity: '0.75', use_cover_color_bg: 'false', disable_visualizer_vignette: 'false', disable_visualizer_geometric_background: 'false' });
  await expect.poll(() => readSettings(page, Object.keys(values))).toEqual(values);
  await expect(reset).toBeInViewport();
  await page.screenshot({ path: info.outputPath('background-reset-rotated.png') });
  await select.selectOption('url');
  await expect(reset).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  await page.reload();
  await openSettings(page);
  expect(await readSettings(page, Object.keys(values))).toEqual(values);
});

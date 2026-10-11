import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';
import { BASE_DUAL_THEME } from '../../src/services/baseThemes';
import { decompressConfig } from '../../src/utils/appearanceCodec';

// ai-themes.spec.ts — real theme/cache/UI code with explicit AI transport fixtures; no network inference or real credentials.
const generation = (page: Page) => page.locator('.mobile-theme-generation');
const cached = (page: Page) => page.evaluate(async () => {
  const { readCacheEntry } = await import(new URL('/src/services/repositories/cacheRepository.ts', location.href).href);
  return readCacheEntry('dual_theme_local:11111111-1111-4111-8111-111111111111');
});
async function open(page: Page) {
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await clickPlayerTool(page, '歌词与动效');
  await expect(generation(page).getByRole('button', { name: '为本曲生成主题' })).toBeEnabled();
}
test.beforeEach(async ({ page }) => {
  page.on('pageerror', error => console.error('AI fixture page:', error.message));
  await page.addInitScript(base => {
    const win = window as any; win.fixtureNoServer = true;
    const config = { provider: 'openai', revision: 0, gemini: { hasKey: false }, openai: { hasKey: false,
      apiURL: 'https://ai.example/v1/chat/completions', model: 'fixture-model', temperature: 0.7, stream: false } };
    win.fixtureAIConfig = config; win.fixtureAIRequests = []; win.fixtureAIEdits = []; win.fixtureAICancelled = [];
    win.fixtureAIBridge = async (method: string, options: any) => {
      if (method === 'getAISettings') return structuredClone(config);
      if (method === 'setAISettings') {
        win.fixtureAIEdits.push(options.settings);
        if (win.fixtureAISaveFailure) throw Error('storage-failure');
        const { provider, apiKey, ...values } = options.settings;
        config.provider = provider; Object.assign((config as any)[provider], values);
        if (apiKey !== undefined) (config as any)[provider].hasKey = !!apiKey;
        config.revision++; return structuredClone(config);
      }
      if (method === 'cancelAIRequest') { win.fixtureAICancelled.push(options.id); return; }
      win.fixtureAIRequests.push(options);
      if (win.fixtureAIDelay) await new Promise(resolve => { win.fixtureAIRelease = resolve; });
      if (win.fixtureAIError) throw Error(win.fixtureAIError);
      const theme = { light: { ...base.light, name: 'Fixture Dawn' }, dark: { ...base.dark, name: 'Fixture Night' } };
      const content = JSON.stringify(theme);
      return { status: 200, contentType: 'application/json', body: JSON.stringify(config.provider === 'gemini'
        ? { candidates: [{ content: { parts: [{ text: content }] } }] } : { choices: [{ message: { content } }] }) };
    };
  }, BASE_DUAL_THEME);
});
test('manual missing-key fallback and offline cover generation preserve cache and appearance controls', async ({ page }) => {
  await open(page);
  await expect(page.getByLabel('自动为无主题的歌曲生成')).not.toBeChecked();
  expect(await page.evaluate(() => (window as any).fixtureAIRequests.length)).toBe(0);
  await generation(page).getByRole('button', { name: '为本曲生成主题' }).click();
  await expect(generation(page).getByRole('status')).toContainText('尚未配置 AI 密钥');
  expect(await cached(page)).toMatchObject({ dark: { provider: 'Built-in' } });
  await page.getByLabel('主题生成来源').selectOption('cover');
  await generation(page).getByRole('button', { name: '为本曲生成主题' }).click();
  await expect(generation(page).getByRole('status')).toContainText('主题已保存并应用');
  expect(await page.evaluate(() => (window as any).fixtureAIRequests.length)).toBe(0);
  await page.getByLabel('自动为无主题的歌曲生成').check();
  await page.locator('.appearance-transfer summary').click();
  await page.getByRole('button', { name: '生成外观短码' }).click();
  const code = await page.getByLabel('Folia 外观短码或 JSON').inputValue();
  expect(decompressConfig(code)).toMatchObject({ songThemeAutoGenerateEnabled: true, themeGenerationSource: 'cover' });
  await page.getByLabel('自动为无主题的歌曲生成').uncheck(); await page.getByLabel('主题生成来源').selectOption('ai');
  await page.getByRole('button', { name: '应用外观配置' }).click();
  await expect(page.getByLabel('自动为无主题的歌曲生成')).toBeChecked();
  await expect(page.getByLabel('主题生成来源')).toHaveValue('cover');
  await page.reload();
  expect(await page.evaluate(() => [localStorage.getItem('theme_auto_generate_enabled'), localStorage.getItem('theme_generation_source')])).toEqual(['true', 'cover']);
});
test('settings retain blank keys, clear explicitly, keep failed drafts and export no credentials', async ({ page }) => {
  await open(page);
  for (const button of await generation(page).getByRole('button').all()) {
    const box = await button.boundingBox(); expect(box?.height).toBeGreaterThanOrEqual(44); expect(box?.width).toBeGreaterThanOrEqual(44);
  }
  await generation(page).getByRole('button', { name: 'AI 服务设置' }).click();
  const sheet = page.getByRole('dialog', { name: 'AI 服务设置', exact: true });
  await sheet.getByLabel('API 地址').fill('https://compatible.example/v1');
  await sheet.getByLabel('API Key', { exact: true }).fill('fixture-only-key');
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sheet.getByLabel('API Key', { exact: true })).toHaveValue('');
  await expect(sheet.getByText('此服务已保存密钥')).toBeVisible();
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  const edits = await page.evaluate(() => (window as any).fixtureAIEdits);
  expect(edits[0]).toMatchObject({ apiURL: 'https://compatible.example/v1/chat/completions', apiKey: 'fixture-only-key' });
  expect(edits[1]).not.toHaveProperty('apiKey');
  await sheet.getByLabel('清除此服务的密钥').check();
  await page.evaluate(() => { (window as any).fixtureAISaveFailure = true; });
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sheet.getByRole('alert')).toBeVisible(); await expect(sheet.getByLabel('清除此服务的密钥')).toBeChecked();
  await page.evaluate(() => { (window as any).fixtureAISaveFailure = false; });
  await sheet.getByRole('button', { name: '保存', exact: true }).click();
  await expect(sheet.getByText('此服务尚未配置密钥')).toBeVisible();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('fixture-only-key');
  await sheet.getByRole('button', { name: '关闭', exact: true }).click();
  await page.locator('.appearance-transfer summary').click(); await page.getByRole('button', { name: '生成外观短码' }).click();
  expect(JSON.stringify(decompressConfig(await page.getByLabel('Folia 外观短码或 JSON').inputValue()))).not.toContain('fixture-only-key');
});
test('automatic generation waits for lyrics, runs once, and reuses the cached theme', async ({ page }) => {
  await page.addInitScript(() => { localStorage.setItem('theme_auto_generate_enabled', 'true'); (window as any).fixtureLocalLyricDelay = true; });
  await page.goto('/mobile.html');
  await page.evaluate(() => { (window as any).fixtureAIConfig.openai.hasKey = true; });
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await clickPlayerTool(page, '歌词与动效');
  await expect.poll(() => page.evaluate(() => (window as any).fixturePendingLocalLyrics?.length ?? 0)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).fixtureAIRequests.length)).toBe(0);
  await page.evaluate(() => { (window as any).fixtureLocalLyricDelay = false; (window as any).fixturePendingLocalLyrics.forEach((release: () => void) => release()); });
  await expect(generation(page).getByRole('status')).toContainText('主题已保存并应用');
  expect(await cached(page)).toMatchObject({ dark: { name: 'Fixture Night' } });
  await page.evaluate(() => { for (let i = 0; i < 5; i++) (window as any).fixtureEmitPlayback({ position: i }); });
  expect(await page.evaluate(() => (window as any).fixtureAIRequests.length)).toBe(1);
});
for (const action of ['cancel', 'song', 'choice', 'settings'] as const) test(`late AI result cannot overwrite ${action}`, async ({ page }) => {
  await open(page);
  await page.evaluate(() => { const win = window as any; win.fixtureAIConfig.openai.hasKey = true; win.fixtureAIDelay = true; });
  await generation(page).getByRole('button', { name: '为本曲生成主题' }).click();
  await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureAIRelease)).toBe('function');
  if (action === 'cancel') await generation(page).getByRole('button', { name: '取消', exact: true }).click();
  else if (action === 'choice') await page.getByRole('button', { name: '使用默认主题' }).click();
  else if (action === 'settings') await page.evaluate(() => window.dispatchEvent(new Event('folia-ai-settings-changed')));
  else await page.evaluate(() => {
    const win = window as any, original = win.fixturePlayback.currentSong;
    win.fixtureEmitPlayback({ currentSong: { ...original, sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'different' } } });
    win.fixtureEmitPlayback({ currentSong: original });
  });
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAICancelled.length)).toBe(1);
  await page.evaluate(async () => { (window as any).fixtureAIRelease(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  expect(await cached(page)).toBeNull();
  await expect(generation(page).getByText('正在生成主题…')).toHaveCount(0);
});
test('manual generation saves a song theme without replacing the pinned custom theme', async ({ page }) => {
  await page.addInitScript(base => {
    localStorage.setItem('custom_dual_theme', JSON.stringify({ light: { ...base.light, name: 'Pinned' }, dark: { ...base.dark, name: 'Pinned' } }));
    localStorage.setItem('last_applied_theme_pointer', 'custom'); localStorage.setItem('custom_theme_preferred', 'true');
  }, BASE_DUAL_THEME);
  await open(page); await page.evaluate(() => { (window as any).fixtureAIConfig.openai.hasKey = true; });
  await generation(page).getByRole('button', { name: '为本曲生成主题' }).click();
  await expect(generation(page).getByRole('status')).toContainText('当前继续使用自定义主题');
  expect(await cached(page)).toMatchObject({ dark: { name: 'Fixture Night' } });
  expect(await page.evaluate(() => localStorage.getItem('last_applied_theme_pointer'))).toBe('custom');
  await page.locator('.appearance-transfer summary').click(); await page.getByRole('button', { name: '生成外观短码' }).click();
  expect(decompressConfig(await page.getByLabel('Folia 外观短码或 JSON').inputValue()).theme.dark.name).toBe('Pinned');
});
test('a failed automatic request is not retried by time snapshots; manual retry remains available', async ({ page }) => {
  await open(page); await page.evaluate(() => { const win = window as any; win.fixtureAIConfig.openai.hasKey = true; win.fixtureAIError = 'ai-rate-limit'; });
  await page.getByLabel('自动为无主题的歌曲生成').check();
  await expect(generation(page).getByRole('alert')).toContainText('AI 服务限流');
  await page.evaluate(() => { for (let i = 0; i < 5; i++) (window as any).fixtureEmitPlayback({ position: i }); });
  expect(await page.evaluate(() => (window as any).fixtureAIRequests.length)).toBe(1);
  await page.evaluate(() => { (window as any).fixtureAIError = ''; });
  await generation(page).getByRole('button', { name: '为本曲生成主题' }).click();
  await expect(generation(page).getByRole('status')).toContainText('主题已保存并应用');
  expect(await page.evaluate(() => (window as any).fixtureAIRequests.length)).toBe(2);
});

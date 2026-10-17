import { test, expect } from './fixtures';

// feature-entry-preservation.spec.ts — UI reachability only, with an empty queue and no live service calls.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    win.fixtureAIBridge = async (method: string) => {
      if (method !== 'getAISettings') throw Error('unexpected-ai-write');
      return { provider: 'openai', revision: 0, gemini: { hasKey: false }, openai: {
        hasKey: true, apiURL: 'https://ai.example/v1/chat/completions', model: 'saved-model', temperature: 0.4, stream: false,
      } };
    };
  });
  await page.goto('/mobile.html');
});

test('existing settings remain reachable without a current song or changing saved configuration', async ({ page }) => {
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '本地歌曲歌词优先级', exact: true })).toBeEnabled();
  for (const name of ['AI 服务设置', 'Navidrome 音乐库', '同步服务', '本地歌词文件格式优先级']) {
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog', { name, exact: true });
    await expect(dialog).toBeVisible();
    if (name === 'AI 服务设置') {
      await expect(dialog.getByRole('textbox', { name: '模型', exact: true })).toHaveValue('saved-model');
      await expect(dialog.getByLabel('API Key', { exact: true })).toHaveValue('');
    }
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '设置', exact: true })).toBeVisible();
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('local library and other existing sources remain available alongside both online platforms', async ({ page }) => {
  const platforms = page.getByRole('navigation', { name: 'Music platform' });
  for (const name of ['QQ 音乐', '网易云', '本地音乐', 'Navidrome', '媒体缓存']) {
    await expect(platforms.getByRole('button', { name, exact: true })).toBeAttached();
  }
  await platforms.getByRole('button', { name: '本地音乐', exact: true }).click();
  await expect(page.getByRole('navigation', { name: '浏览本地音乐库' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入音乐', exact: true })).toBeEnabled();
  await platforms.getByRole('button', { name: 'Navidrome', exact: true }).click();
  await expect(page.getByRole('button', { name: '配置 Navidrome', exact: true })).toBeVisible();
  await platforms.getByRole('button', { name: '本地音乐', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

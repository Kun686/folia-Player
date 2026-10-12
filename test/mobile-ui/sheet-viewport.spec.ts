import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';

// sheet-viewport.spec.ts — controlled visual viewport with unchanged layout height; native keyboard proof is separate.
async function viewport(page: Page, width: number, height: number, visibleHeight: number, top = 0) {
  await page.setViewportSize({ width, height });
  await page.evaluate(({ width, visibleHeight, top }) => {
    const view = (window as any).fixtureViewport;
    Object.assign(view, { width, height: visibleHeight, offsetTop: top });
    view.dispatchEvent(new Event('resize'));
  }, { width, visibleHeight, top });
}
async function visibleField(page: Page, label: string, bottom: number, top = 0) {
  await expect.poll(async () => {
    const box = await page.getByRole('textbox', { name: label, exact: true }).boundingBox();
    return !!box && box.y >= top && box.y + box.height <= bottom;
  }).toBe(true);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    // Before the viewport meta tag is parsed, mobile WebKit reports a 980px layout. Keep live defaults until overridden.
    const view = new EventTarget(), overrides: Record<string, number> = {};
    const defaults = { width: () => innerWidth, height: () => innerHeight, offsetTop: () => 0, offsetLeft: () => 0, scale: () => 1 };
    for (const [key, fallback] of Object.entries(defaults)) Object.defineProperty(view, key, {
      get: () => overrides[key] ?? fallback(), set: (value: number) => { overrides[key] = value; },
    });
    Object.defineProperty(window, 'visualViewport', { value: view }); win.fixtureViewport = view;
    win.fixtureAIBridge = async (method: string) => {
      if (method !== 'getAISettings') throw Error('unexpected-ai-write');
      return { provider: 'openai', revision: 0, gemini: { hasKey: false }, openai: { hasKey: false,
        apiURL: 'https://ai.example/v1/chat/completions', model: 'QA-local-only', temperature: 0.4, stream: false } };
    };
  });
});
test('focused sheet field stays above keyboard through rotation and restores full height', async ({ page }) => {
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '服务器与外观', exact: true }).click();
  await page.getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  await viewport(page, 834, 1210, 870);
  const model = page.getByRole('textbox', { name: '模型', exact: true });
  await model.focus();
  await visibleField(page, '模型', 870);
  await viewport(page, 1210, 834, 405);
  await visibleField(page, '模型', 405);
  const sheet = page.getByRole('dialog', { name: 'AI 服务设置', exact: true });
  await expect.poll(async () => { const r = await sheet.boundingBox(); return r!.y + r!.height; }).toBeLessThanOrEqual(405);
  await model.press('End'); await model.press('-');
  await expect(model).toHaveValue('QA-local-only-');
  await model.press('Backspace');
  await viewport(page, 834, 1210, 850, 20);
  await visibleField(page, '模型', 870, 20);
  await viewport(page, 834, 1210, 1210);
  await expect.poll(async () => (await sheet.boundingBox())!.height).toBeGreaterThan(700);
  await expect(model).toHaveValue('QA-local-only');
});
test('lyric paste remains reachable in a short visual viewport without resizing the player', async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any; win.fixtureLyricTools = true;
    win.fixtureLocalLyric = { content: '[0,10000](0,5000,0)第一(5000,5000,0)句歌词', fileName: 'keyboard.yrc' };
  });
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  const player = page.locator('.player-panel');
  const initial = await player.boundingBox();
  await clickPlayerTool(page, '歌词');
  await page.getByRole('button', { name: '歌词分词调整', exact: true }).click();
  await page.getByText('粘贴／编辑分词', { exact: true }).click();
  const box = page.getByRole('textbox', { name: /分词结果/ });
  await box.focus();
  const size = page.viewportSize()!;
  await viewport(page, size.width, size.height, 330);
  await expect.poll(async () => { const r = await box.boundingBox(); return !!r && r.y >= 0 && r.y + r.height <= 330; }).toBe(true);
  await expect(box).toBeFocused();
  expect(await player.boundingBox()).toEqual(initial);
});

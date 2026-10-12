import type { Page } from '@playwright/test';
import { test, expect, clickPlayerTool } from './fixtures';

// segmentation-ai.spec.ts — real editor, original parser and IndexedDB; AI/native playback are controlled, no live model.
const raw = '[00:00.00]第一句歌词\n[00:10.00]第二句歌词';
const rows = [['第', '一句', '歌词'], ['第二', '句歌', '词']];
const dialog = (page: Page) => page.getByRole('dialog', { name: '歌词分词调整', exact: true });
async function open(page: Page) {
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '导入音乐', exact: true }).click();
  await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 5 }));
  await editor(page);
}
async function editor(page: Page) {
  await clickPlayerTool(page, '歌词');
  await page.getByRole('button', { name: '歌词分词调整', exact: true }).click();
  await expect(dialog(page).getByRole('button', { name: 'AI 分词' })).toBeVisible();
}
const run = (page: Page) => dialog(page).getByRole('button', { name: 'AI 分词', exact: true }).click();
const saved = (page: Page) => page.evaluate(async () => {
  const { readCacheEntry } = await import(new URL('/src/services/repositories/cacheRepository.ts', location.href).href);
  return readCacheEntry('lyricSeg_local:11111111-1111-4111-8111-111111111111');
});
test.beforeEach(async ({ page }) => {
  await page.addInitScript(({ raw, rows }) => {
    const w = window as any; w.fixtureNoServer = true; w.fixtureLyricTools = true;
    w.fixtureLocalLyric = { content: raw, fileName: 'ai-test.lrc' };
    w.fixtureAIRequests = []; w.fixtureAICancelled = [];
    w.fixtureAIConfig = { provider: 'openai', revision: 0, gemini: { hasKey: false },
      openai: { apiURL: 'https://ai.example/v1/chat/completions', model: 'fixture-model', hasKey: true, stream: false, temperature: 0.7 } };
    w.fixtureAIBridge = async (method: string, options: any) => {
      if (method === 'getAISettings') return structuredClone(w.fixtureAIConfig);
      if (method === 'cancelAIRequest') { w.fixtureAICancelled.push(options.id); return; }
      if (method !== 'aiRequest') throw Error('unexpected-ai-fixture-operation');
      w.fixtureAIRequests.push(options);
      if (w.fixtureAIDelay) await new Promise(resolve => { w.fixtureAIRelease = resolve; });
      if (w.fixtureAIError) throw Error(w.fixtureAIError);
      return { status: 200, contentType: 'application/json',
        body: JSON.stringify({ choices: [{ message: { content: JSON.stringify({ lines: w.fixtureAIRows ??
          JSON.parse(options.body).messages[1].content.split('\n\n')[1].split('\n').map((line: string) => {
            const text = line.replace(/^\d+\. /, '');
            return text === '第一句歌词' ? rows[0] : text === '第二句歌词' ? rows[1] : [text];
          }) }) } }] }) };
    };
  }, { raw, rows });
});
test('AI saves original validated boundaries, survives reload and leaves audio/raw lyrics unchanged', async ({ page }) => {
  const webRequests: string[] = []; await page.route('**/api/segment-lyrics', route => { webRequests.push(route.request().url()); return route.abort(); });
  await open(page); await run(page);
  await expect(dialog(page).getByText('AI 分词 · 3 行', { exact: true })).toBeVisible();
  expect(await saved(page)).toMatchObject({ source: 'ai', lines: { '0|第一句歌词': rows[0], '10000|第二句歌词': rows[1] } });
  expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(5);
  expect(await page.evaluate(() => (window as any).fixtureLocalLyric.content)).toBe(raw);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  expect(webRequests).toEqual([]);
  await open(page);
  await expect(dialog(page).getByText('AI 分词 · 3 行', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureAIRequests.length)).toBe(0);
});
test('bad model output preserves manual work, hides diagnostics and permits retry', async ({ page }) => {
  await open(page);
  await dialog(page).getByText('粘贴／编辑分词', { exact: true }).click();
  await dialog(page).getByRole('textbox', { name: /分词结果/ }).fill('第一句/歌词\n......\n第二句/歌词');
  await dialog(page).getByRole('button', { name: '保存分词', exact: true }).click();
  const before = await saved(page);
  await page.evaluate(() => { (window as any).fixtureAIRows = [['private model diagnostic'], ['wrong']]; });
  await run(page);
  await expect(dialog(page).getByRole('alert')).toHaveText('AI 返回的部分行无法对应原歌词，未采用这些行。请重试。');
  expect(await saved(page)).toEqual(before);
  await page.evaluate(() => { delete (window as any).fixtureAIRows; });
  await run(page); await expect(dialog(page).getByText('AI 分词 · 3 行', { exact: true })).toBeVisible();
});
for (const reason of ['cancel', 'close', 'song', 'background', 'settings'] as const) test('drops late AI output after ' + reason, async ({ page }) => {
  await open(page); await page.evaluate(() => { (window as any).fixtureAIDelay = true; }); await run(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureAIRelease)).toBe('function');
  if (reason === 'cancel') await dialog(page).getByRole('button', { name: /取消/ }).click();
  else if (reason === 'close') await dialog(page).getByRole('button', { name: '关闭', exact: true }).click();
  else await page.evaluate(reason => {
    const w = window as any;
    if (reason === 'song') w.fixtureEmitPlayback({ currentSong: { ...w.fixturePlayback.currentSong, sourceRef: { kind: 'local', mediaId: 'other' } } });
    if (reason === 'settings') window.dispatchEvent(new Event('folia-ai-settings-changed'));
    if (reason === 'background') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
  }, reason);
  // Song invalidation is guarded synchronously; unmount then cancels native work as well.
  await expect.poll(() => page.evaluate(() => (window as any).fixtureAICancelled.length)).toBe(1);
  await page.evaluate(async () => { const w = window as any; w.fixtureAIRelease(); await new Promise(requestAnimationFrame); await new Promise(requestAnimationFrame); });
  expect(await saved(page)).toBeNull();
});
test('failed local save reports a fixed error and a subsequent explicit run succeeds', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    (window as any).restoreSegmentationWrite = () => { IDBObjectStore.prototype.put = put; };
    IDBObjectStore.prototype.put = function (value, key) {
      if (String(value?.key).startsWith('lyricSeg_')) throw Error('private storage diagnostic');
      return put.call(this, value, key);
    };
  });
  await run(page);
  await expect(dialog(page).getByRole('alert')).toHaveText('分词保存失败，请重试。');
  expect(await saved(page)).toBeNull();
  await page.evaluate(() => (window as any).restoreSegmentationWrite());
  await run(page); await expect(dialog(page).getByText('AI 分词 · 3 行', { exact: true })).toBeVisible();
});
test('missing key does not send lyrics and the editor opens the existing native AI settings', async ({ page }) => {
  await open(page); await page.evaluate(() => { (window as any).fixtureAIConfig.openai.hasKey = false; });
  await run(page); await expect(dialog(page).getByRole('alert')).toHaveText('请先配置此 AI 服务的密钥。');
  expect(await page.evaluate(() => (window as any).fixtureAIRequests)).toEqual([]);
  await dialog(page).getByRole('button', { name: 'AI 服务设置', exact: true }).click();
  const settings = page.getByRole('dialog', { name: 'AI 服务设置', exact: true });
  await expect(settings.getByText('此服务尚未配置密钥', { exact: true })).toBeVisible();
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(dialog(page)).toBeVisible();
});

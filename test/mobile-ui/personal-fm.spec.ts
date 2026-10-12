import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// personal-fm.spec.ts — touch UI over a controlled native contract; actual queue ownership is covered in XCTest.
const sheet = (page: Page) => page.getByRole('dialog', { name: '私人 FM', exact: true });
async function setup(page: Page) {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureHealth = { protocol: 1, providers: ['netease', 'qq'], personalFmProviders: ['netease'] };
    win.fixturePlayback.personalFM = { active: false, selection: null, loading: false, fallback: false, error: null };
    win.fmCalls = [];
    win.fixtureFmBridge = async (method: string, options: any) => {
      const state = win.fixturePlayback;
      if (method === 'leavePersonalFM') { win.fixtureEmitPlayback({ personalFM: { ...state.personalFM, active: false, selection: null, error: null } }); return {}; }
      win.fmCalls.push(options.selection);
      if (win.fmDelay) {
        win.fixtureEmitPlayback({ personalFM: { ...state.personalFM, loading: true } });
        await new Promise<void>(resolve => { win.fmRelease = resolve; });
      }
      if (win.fmFail) { win.fixtureEmitPlayback({ personalFM: { ...state.personalFM, loading: false, error: 'network' } }); throw new Error('network'); }
      const song = { id: 42, name: 'FM 曲目', artists: [{ id: 1, name: '测试歌手' }], album: { id: 2, name: 'FM' }, durationMs: 180000,
        sourceRef: { kind: 'online', providerId: 'netease', mediaId: '42' } };
      win.fixtureEmitPlayback({ queue: [song], currentSong: song, index: 0, position: 0, playing: true, queueRevision: state.queueRevision + 1,
        personalFM: { active: true, selection: options.selection, loading: false, fallback: !!win.fmFallback, error: null } });
      return state;
    };
  });
  await page.goto('/mobile.html');
}
async function login(page: Page) {
  await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
  await page.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect(page.getByText('已登录', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('dialog', { name: '扫码登录' }).getByRole('button', { name: '关闭', exact: true }).tap();
}
async function open(page: Page) { await page.getByRole('button', { name: '私人 FM', exact: true }).tap(); }
test('original modes and scenes persist, remain touch sized across rotation, and start native playback', async ({ page }, info) => {
  await setup(page); await login(page); await open(page);
  const mode = sheet(page).getByRole('combobox', { name: 'FM 模式', exact: true });
  await mode.selectOption('SCENE_RCMD');
  await sheet(page).getByRole('combobox', { name: '场景', exact: true }).selectOption('FOCUS');
  expect(await page.evaluate(() => (window as any).fmCalls.length)).toBe(0);
  expect((await mode.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const frame = (await sheet(page).boundingBox())!;
  expect(frame.x).toBeGreaterThanOrEqual(12); expect(frame.y).toBeGreaterThanOrEqual(12);
  const size = page.viewportSize()!; await page.setViewportSize({ width: size.height, height: size.width });
  await expect(sheet(page).getByRole('button', { name: '播放私人 FM', exact: true })).toBeInViewport();
  await page.setViewportSize(size); await page.screenshot({ path: info.outputPath('personal-fm.png') });
  await sheet(page).getByRole('button', { name: '播放私人 FM', exact: true }).tap();
  await expect(sheet(page)).not.toBeVisible();
  expect(await page.evaluate(() => (window as any).fixturePlayback.personalFM)).toMatchObject({ active: true, selection: { mode: 'SCENE_RCMD', scene: 'FOCUS' } });
  await page.reload(); await login(page); await open(page);
  await expect(sheet(page).getByRole('combobox', { name: 'FM 模式', exact: true })).toHaveValue('SCENE_RCMD');
  await expect(sheet(page).getByRole('combobox', { name: '场景', exact: true })).toHaveValue('FOCUS');
});
test('active mode changes are immediate, serialized and preserve old native state on failure', async ({ page }) => {
  await setup(page); await login(page);
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ personalFM: { active: true, selection: { mode: 'DEFAULT', scene: null }, loading: false, fallback: false, error: null } }));
  await open(page); await page.evaluate(() => { (window as any).fmDelay = true; });
  await sheet(page).getByRole('combobox', { name: 'FM 模式', exact: true }).selectOption('EXPLORE');
  await expect.poll(() => page.evaluate(() => typeof (window as any).fmRelease)).toBe('function');
  await expect(sheet(page).getByRole('combobox', { name: 'FM 模式', exact: true })).toBeDisabled();
  await page.evaluate(() => { (window as any).fmFail = true; (window as any).fmRelease(); });
  await expect(sheet(page).getByRole('alert')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixturePlayback.personalFM.selection.mode)).toBe('DEFAULT');
  expect(await page.evaluate(() => (window as any).fmCalls.length)).toBe(1);
  await page.evaluate(() => { (window as any).fmDelay = false; (window as any).fmFail = false; });
  await sheet(page).getByRole('combobox', { name: 'FM 模式', exact: true }).selectOption('FAMILIAR');
  await expect(sheet(page).getByRole('alert')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixturePlayback.personalFM.selection.mode)).toBe('FAMILIAR');
});
test('fallback is explained and leaving radio preserves queued playback', async ({ page }) => {
  await setup(page); await login(page);
  await page.evaluate(() => (window as any).fixtureEmitPlayback({ personalFM: { active: true, selection: { mode: 'EXPLORE', scene: null }, loading: false, fallback: true, error: null }, playing: true }));
  await open(page); await expect(sheet(page).getByRole('status')).toContainText('正在使用默认 FM');
  await sheet(page).getByRole('button', { name: '退出 FM，保留队列', exact: true }).tap();
  expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
  expect(await page.evaluate(() => (window as any).fixturePlayback.personalFM.active)).toBe(false);
});
test('anonymous users, old gateways and QQ cannot start unsupported radio', async ({ page }) => {
  await setup(page); await expect(page.getByRole('button', { name: '私人 FM', exact: true })).toBeDisabled();
  await login(page);
  await page.addInitScript(() => { (window as any).fixtureHealth.personalFmProviders = undefined; });
  await page.reload(); await expect(page.getByRole('button', { name: '私人 FM', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'QQ 音乐', exact: true }).tap();
  await expect(page.getByRole('button', { name: '私人 FM', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fmCalls)).toEqual([]);
});

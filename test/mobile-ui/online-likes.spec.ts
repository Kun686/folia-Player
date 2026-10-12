import type { Page } from '@playwright/test';
import { test, expect, openPlayerTools } from './fixtures';

// online-likes.spec.ts — real Omni/provider/runtime and touch controls over a synthetic native transport.
const actions = (page: Page) => page.getByRole('dialog', { name: '歌曲操作', exact: true });
async function library(page: Page) {
  await page.goto('/mobile.html');
  await page.getByRole('button', { name: '扫码登录', exact: true }).tap();
  await page.getByRole('button', { name: '重新生成二维码', exact: true }).tap();
  await expect(page.getByText('已登录', { exact: true })).toBeVisible({ timeout: 10000 });
  await page.getByRole('dialog', { name: '扫码登录' }).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '测试歌单', exact: true }).tap();
  await expect(page.getByRole('button', { name: '歌曲操作 测试歌曲', exact: true })).toBeVisible();
}
const open = (page: Page) => page.getByRole('button', { name: '歌曲操作 测试歌曲', exact: true }).tap();
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any;
    w.fixtureHealth = { protocol: 1, providers: ['netease', 'qq'], songLikeProviders: ['netease'] };
    w.fixtureLikeIds = []; w.fixtureLikeWrites = []; w.fixtureLikeReads = []; w.fixtureLikeStatuses = [];
    w.fixtureOnlineRequest = async (payload: any) => {
      const path = new URL(payload.path, 'https://fixture.invalid');
      const reply = (body: unknown) => ({ status: 200, body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
      if (path.pathname === '/login/status') w.fixtureLikeStatuses.push(payload.provider);
      if (payload.provider === 'qq' && path.pathname === '/login/status') return reply({ code: 0, data: { profile: { uin: '77', nick: 'QQ fixture' } } });
      if (path.pathname === '/user/liked-songs') {
        w.fixtureLikeReads.push('qq'); return reply({ code: 0, songs: [{ mid: '42', title: 'QQ歌曲', singer: [], album: {}, interval: 180 }], more: false, total: 1 });
      }
      if (path.pathname === '/likelist') {
        w.fixtureLikeReads.push('netease');
        if (w.fixtureLikeReadDelay) await new Promise(resolve => { w.fixtureLikeReadRelease = resolve; });
        return reply(w.fixtureLikeReadFailure ? { code: 500, msg: 'private-read-detail' } : { code: 200, ids: [...w.fixtureLikeIds] });
      }
      if (path.pathname === '/like') {
        const liked = path.searchParams.get('like') === 'true', id = path.searchParams.get('id');
        w.fixtureLikeWrites.push({ provider: payload.provider, id, liked });
        if (w.fixtureLikeDelay) await new Promise(resolve => { w.fixtureLikeRelease = resolve; });
        if (w.fixtureLikeFailure) return reply({ code: 500, msg: 'private-mutation-detail' });
        w.fixtureLikeIds = liked ? [id] : []; return reply({ code: 200 });
      }
    };
  });
});
test('NetEase likes and unlikes from touch rows, player tools and queue without changing audio', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await library(page); await open(page);
  await actions(page).getByRole('button', { name: '喜欢这首歌', exact: true }).tap();
  await expect(actions(page).getByRole('button', { name: '取消喜欢', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await actions(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '播放 测试歌曲', exact: true }).tap();
  await openPlayerTools(page); const tools = page.getByRole('dialog', { name: '更多播放选项', exact: true });
  await expect(tools.getByRole('button', { name: '取消喜欢', exact: true })).toBeEnabled();
  await tools.getByRole('button', { name: '取消喜欢', exact: true }).tap();
  await expect(tools.getByRole('button', { name: '喜欢这首歌', exact: true })).toHaveAttribute('aria-pressed', 'false');
  expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(true);
  expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
  await page.screenshot({ path: '.mobile-test-results/online-likes/' + info.project.name + '.png' });
  await tools.getByRole('button', { name: '关闭', exact: true }).tap();
  await page.locator('.player-panel').getByRole('button', { name: '播放队列', exact: true }).tap(); await open(page);
  await expect(actions(page).getByRole('button', { name: '喜欢这首歌', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).fixtureLikeWrites)).toEqual([
    { provider: 'netease', id: '42', liked: true }, { provider: 'netease', id: '42', liked: false },
  ]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
test('a legacy gateway displays read-only state and never sends a mutation', async ({ page }) => {
  await page.addInitScript(() => { delete (window as any).fixtureHealth.songLikeProviders; });
  await library(page); await open(page);
  await expect(actions(page).getByRole('button', { name: '未喜欢', exact: true })).toBeDisabled();
  await expect(actions(page).getByText('当前平台或服务器连接仅支持读取收藏状态。')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureLikeWrites)).toEqual([]);
});
test('business failure shows a safe error and requires re-reading before another write', async ({ page }) => {
  await library(page); await open(page);
  await page.evaluate(() => { (window as any).fixtureLikeFailure = true; });
  await actions(page).getByRole('button', { name: '喜欢这首歌', exact: true }).tap();
  await expect(actions(page).getByRole('alert')).toHaveText('无法确认收藏结果，请重新读取状态后再操作。');
  expect(await actions(page).textContent()).not.toContain('private-mutation-detail');
  await expect(actions(page).getByRole('button', { name: '取消喜欢', exact: true })).toHaveCount(0);
  await page.evaluate(() => { (window as any).fixtureLikeFailure = false; });
  await actions(page).getByRole('button', { name: '重新读取收藏状态', exact: true }).tap();
  await actions(page).getByRole('button', { name: '喜欢这首歌', exact: true }).tap();
  await expect(actions(page).getByRole('button', { name: '取消喜欢', exact: true })).toBeEnabled();
});
test('closing while saving and reopening waits for the sent mutation, without a second write', async ({ page }) => {
  await library(page); await open(page); await page.evaluate(() => { (window as any).fixtureLikeDelay = true; });
  await actions(page).getByRole('button', { name: '喜欢这首歌', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureLikeRelease)).toBe('function');
  await actions(page).getByRole('button', { name: '关闭', exact: true }).tap(); await open(page);
  await expect(actions(page).getByRole('status')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureLikeReads.length)).toBe(1);
  await page.evaluate(() => { (window as any).fixtureLikeRelease(); });
  await expect(actions(page).getByRole('button', { name: '取消喜欢', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).fixtureLikeWrites.length)).toBe(1);
});
test('a late read after logout cannot restore the previous account state', async ({ page }) => {
  await library(page); await page.evaluate(() => { (window as any).fixtureLikeReadDelay = true; }); await open(page);
  await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureLikeReadRelease)).toBe('function');
  await actions(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await page.getByRole('button', { name: '退出登录', exact: true }).tap();
  await expect(page.getByRole('button', { name: '扫码登录', exact: true })).toBeEnabled();
  await page.evaluate(() => { const w = window as any; w.fixtureLikeIds = [42]; w.fixtureLikeReadRelease(); });
  await page.getByRole('textbox', { name: '搜索歌曲' }).fill('test');
  await page.getByRole('button', { name: '搜索歌曲', exact: true }).tap(); await open(page);
  await expect(actions(page).getByText('请先登录这首歌所属的音乐平台，再查看收藏。')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureLikeWrites)).toEqual([]);
});
test('read failure is unknown, and retry can restore the existing like', async ({ page }) => {
  await library(page); await page.evaluate(() => { (window as any).fixtureLikeReadFailure = true; }); await open(page);
  await expect(actions(page).getByRole('alert')).toBeVisible();
  await expect(actions(page).getByRole('button', { name: '喜欢这首歌', exact: true })).toHaveCount(0);
  await page.evaluate(() => { const w = window as any; w.fixtureLikeReadFailure = false; w.fixtureLikeIds = [42]; });
  await actions(page).getByRole('button', { name: '重新读取收藏状态', exact: true }).tap();
  await expect(actions(page).getByRole('button', { name: '取消喜欢', exact: true })).toBeEnabled();
});
test('QQ uses its own liked IDs in a mixed queue and remains read-only even if the gateway advertises it', async ({ page }) => {
  await page.addInitScript(() => { const w = window as any; w.fixtureSessions = { qq: { cookie: 'qqmusic_session=fixture-qq' } }; w.fixtureHealth.songLikeProviders.push('qq'); });
  await library(page);
  await page.evaluate(() => {
    const s = { id: '42', name: 'QQ歌曲', artists: [], album: { id: '', name: '' }, durationMs: 180000, sourceRef: { kind: 'online', providerId: 'qq', mediaId: '42' } };
    (window as any).fixtureEmitPlayback({ queue: [s], currentSong: null, index: -1, playing: false });
  });
  await page.getByRole('button', { name: '播放队列 · 1', exact: true }).tap();
  await page.getByRole('button', { name: '歌曲操作 QQ歌曲', exact: true }).tap();
  await expect(actions(page).getByRole('button', { name: '已喜欢', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => (window as any).fixtureLikeReads)).toEqual(['qq']);
  expect(await page.evaluate(() => (window as any).fixtureLikeWrites)).toEqual([]);
});

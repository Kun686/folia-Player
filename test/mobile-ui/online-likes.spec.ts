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
        w.fixtureLikeReads.push('qq');
        if (w.fixtureLikeReadDelay) await new Promise(resolve => { w.fixtureLikeReadRelease = resolve; });
        return reply(w.fixtureLikeReadFailure ? { code: 500 } : {
          code: 0, songs: [{ mid: '42', title: 'QQ歌曲', singer: [], album: {}, interval: 180 }], more: false, total: 1 });
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
for (const provider of ['netease', 'qq']) for (const failure of [false, true]) {
  test(`song menu targets stay fixed after ${provider} like read ${failure ? 'fails' : 'finishes'}`, async ({ page }) => {
    await page.addInitScript(() => { (window as any).fixtureSessions = { qq: { cookie: 'qqmusic_session=fixture-qq' } }; });
    await library(page);
    await page.evaluate(provider => {
      const w = window as any;
      w.fixtureLikeReadDelay = true;
      const song = { id: '42', name: '目录歌曲', artists: [], album: { id: '', name: '' }, durationMs: 180000,
        sourceRef: { kind: 'online', providerId: provider, mediaId: '42' } };
      w.fixtureEmitPlayback({ queue: [song], currentSong: null, index: -1, playing: false });
    }, provider);
    await page.getByRole('button', { name: '播放队列 · 1', exact: true }).tap();
    await page.getByRole('button', { name: '歌曲操作 目录歌曲', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureLikeReadRelease)).toBe('function');
    const menu = actions(page);
    const targets = ['关闭', '播放', '下一首播放', '复制歌曲信息'].map(name => menu.getByRole('button', { name, exact: true }));
    const before = await Promise.all(targets.map(target => target.boundingBox()));
    await page.evaluate(fails => {
      const w = window as any; w.fixtureLikeReadFailure = fails; w.fixtureLikeReadRelease();
    }, failure);
    await expect(menu.getByRole('button', { name: failure ? '重新读取收藏状态' : provider === 'qq' ? '已喜欢' : '喜欢这首歌', exact: true })).toBeVisible();
    for (const [index, target] of targets.entries()) {
      await expect.poll(async () => Math.abs((await target.boundingBox())!.y - before[index]!.y)).toBeLessThan(1);
    }
    await expect(menu.getByRole(failure ? 'alert' : 'status')).toHaveCount(failure ? 1 : 0);
    expect(await page.evaluate(() => (window as any).fixtureLikeWrites)).toEqual([]);
  });
}
test('an unlike refreshes the open playlist without requiring the user to reopen it', async ({ page }) => {
  await page.addInitScript(() => {
    const w = window as any, request = w.fixtureOnlineRequest;
    w.fixtureLikeIds = ['42']; w.fixtureLikeCollectionReads = 0; w.fixtureLikeCollectionVersions = [];
    w.fixtureOnlineRequest = async (payload: any) => {
      const path = new URL(payload.path, 'https://fixture.invalid');
      if (path.pathname === '/playlist/track/all') {
        w.fixtureLikeCollectionReads++;
        w.fixtureLikeCollectionVersions.push(path.searchParams.get('timestamp'));
        if (!w.fixtureLikeIds.length) return { status: 200, body: JSON.stringify({ code: 200, songs: [] }),
          headers: { 'content-type': 'application/json' } };
      }
      return request(payload);
    };
  });
  await library(page); await open(page);
  await actions(page).getByRole('button', { name: '取消喜欢', exact: true }).tap();
  await expect(actions(page).getByRole('button', { name: '喜欢这首歌', exact: true })).toBeEnabled();
  await actions(page).getByRole('button', { name: '关闭', exact: true }).tap();
  await expect.poll(() => page.evaluate(() => (window as any).fixtureLikeCollectionReads)).toBe(2);
  const versions = await page.evaluate(() => (window as any).fixtureLikeCollectionVersions as string[]);
  expect(versions.every(value => /^\d+$/.test(value))).toBe(true);
  expect(versions[0]).not.toBe(versions[1]);
  await expect(page.getByRole('button', { name: '播放 测试歌曲', exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).fixtureLikeWrites)).toEqual([{ provider: 'netease', id: '42', liked: false }]);
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

for (const failure of [false, true]) {
  test(`player shortcuts stay reachable when a pending like read ${failure ? 'fails' : 'finishes'}`, async ({ page }) => {
    await library(page);
    await page.getByRole('button', { name: '播放 测试歌曲', exact: true }).tap();
    await page.evaluate(() => { (window as any).fixtureLikeReadDelay = true; });
    await openPlayerTools(page);
    await expect.poll(() => page.evaluate(() => typeof (window as any).fixtureLikeReadRelease)).toBe('function');
    const tools = page.getByRole('dialog', { name: '更多播放选项', exact: true });
    const body = tools.locator('.sheet-body');
    const visual = tools.getByRole('button', { name: '歌词与动效', exact: true });
    await body.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(visual).toBeInViewport();
    const before = (await visual.boundingBox())!;
    await page.evaluate(fails => {
      const w = window as any; w.fixtureLikeReadFailure = fails; w.fixtureLikeReadRelease();
    }, failure);
    await expect(tools.getByRole('button', { name: failure ? '重新读取收藏状态' : '喜欢这首歌', exact: true })).toBeAttached();
    await expect.poll(async () => Math.abs((await visual.boundingBox())!.y - before.y)).toBeLessThan(1);
    const original = page.viewportSize()!;
    for (const size of [original, { width: original.height, height: original.width }, original]) {
      await page.setViewportSize(size);
      for (const edge of ['start', 'end']) {
        await body.evaluate((element, edge) => { element.scrollTop = edge === 'start' ? 0 : element.scrollHeight; }, edge);
        for (const button of [visual, tools.getByRole('button', { name: '歌词', exact: true })]) {
          await expect.poll(() => button.evaluate(element => {
            const rect = element.getBoundingClientRect();
            return rect.width >= 44 && rect.height >= 44 &&
              element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
          })).toBe(true);
        }
      }
    }
    await visual.tap();
    await expect(page.getByRole('dialog', { name: '歌词与动效', exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).fixtureLikeWrites)).toEqual([]);
  });
}

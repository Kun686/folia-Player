import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// lyric-display.spec.ts — real original parser, display rules and dialogs over the controlled native bridge.
const raw = '[0,200](0,200,0)作词 : A\n[200,200](200,200,0)作曲 : B\n[2000,8000](2000,8000,0)第一句歌词\n[10000,10000](10000,10000,0)第二句歌词';
const tools = (page: Page) => page.getByRole('dialog', { name: '歌词', exact: true });
const filter = (page: Page) => page.getByRole('dialog', { name: '歌词过滤', exact: true });
const timeline = (page: Page) => page.getByRole('dialog', { name: '时间线', exact: true });
const openTools = (page: Page) => page.getByRole('button', { name: '歌词', exact: true }).click();
const openFilter = (page: Page) => tools(page).getByRole('button', { name: '歌词过滤', exact: true }).click();
const openTimeline = (page: Page) => tools(page).getByRole('button', { name: '时间线', exact: true }).click();
const close = (dialog: ReturnType<typeof tools>) => dialog.getByRole('button', { name: '关闭', exact: true }).click();
const timelineHas = (page: Page, text: string) => timeline(page).locator('[data-lyric-start]').filter({ hasText: text });
async function start(page: Page) {
    await page.addInitScript(content => {
        const w = window as any; w.fixtureNoServer = true; w.fixtureLyricTools = true;
        w.fixtureLocalLyric = { content, fileName: 'display.yrc' };
    }, raw);
    await page.goto('/mobile.html');
    await playLocal(page);
}
async function playLocal(page: Page) {
    await page.getByRole('button', { name: '导入音乐', exact: true }).click();
    await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 5 }));
    await openTools(page);
    await expect(tools(page).getByRole('button', { name: '歌词过滤', exact: true })).toBeEnabled();
}

test('original staff policy, filter preview, cancel, save and offline restoration use unmodified source', async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page); await openTimeline(page);
    // The default original smart policy removes an opening block with insufficient dwell time.
    await expect(timelineHas(page, '作词 : A')).toHaveCount(0);
    await expect(timelineHas(page, '第一句歌词')).toBeVisible();
    await close(timeline(page)); await openFilter(page);
    await filter(page).getByRole('button', { name: '始终显示', exact: true }).tap();
    await close(filter(page)); await openTimeline(page);
    await expect(timelineHas(page, '作词 : A')).toHaveCount(0);
    await close(timeline(page)); await openFilter(page);
    await filter(page).getByRole('button', { name: '始终显示', exact: true }).tap();
    await filter(page).getByRole('button', { name: '启用逐行过滤', exact: true }).tap();
    await filter(page).getByRole('textbox', { name: '正则表达式', exact: true }).fill('^第一句');
    await expect(filter(page).getByText('已过滤 1 / 总计 4', { exact: true })).toBeVisible();
    await expect(filter(page).getByRole('button', { name: '始终显示', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.screenshot({ animations: 'disabled', path: '.mobile-test-results/lyric-display-filter-' + info.project.name + '.png' });
    expect(await filter(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await filter(page).getByRole('button', { name: '保存', exact: true }).tap();
    await openTimeline(page);
    await expect(timelineHas(page, '作词 : A')).toBeVisible();
    await expect(timelineHas(page, '第一句歌词')).toHaveCount(0);
    await expect(timelineHas(page, '第二句歌词')).toBeVisible();
    await close(timeline(page)); await openFilter(page);
    // Preview must still contain the line removed from the displayed timeline.
    await expect(filter(page).getByText('第一句歌词', { exact: true })).toBeVisible();
    await filter(page).getByRole('button', { name: '启用逐行过滤', exact: true }).tap();
    await filter(page).getByRole('button', { name: '保存', exact: true }).tap();
    await page.reload(); await playLocal(page); await openTimeline(page);
    await expect(timelineHas(page, '作词 : A')).toBeVisible();
    await expect(timelineHas(page, '第一句歌词')).toBeVisible();
    expect(await page.evaluate(() => (window as any).fixtureLocalLyric.content)).toBe(raw);
    expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
    expect(errors).toEqual([]);
});

test('timeline opens on the paused current line and taps use calibrated native positions', async ({ page }, info) => {
    await start(page);
    await tools(page).getByRole('spinbutton', { name: '时间轴偏移' }).fill('500');
    await openTimeline(page);
    await expect(timelineHas(page, '第一句歌词')).toHaveAttribute('data-lyric-active', 'true');
    await timelineHas(page, '第二句歌词').getByText('第二句歌词', { exact: true }).filter({ visible: true }).tap();
    await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.position)).toBe(10.5);
    await expect(timelineHas(page, '第二句歌词')).toHaveAttribute('data-lyric-active', 'true');
    await expect(timelineHas(page, '第一句歌词')).toHaveAttribute('data-lyric-active', 'false');
    await page.screenshot({ animations: 'disabled', path: '.mobile-test-results/lyric-display-timeline-' + info.project.name + '.png' });
    expect(await timeline(page).evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await close(timeline(page)); await openTimeline(page);
    await expect(timelineHas(page, '第二句歌词')).toHaveAttribute('data-lyric-active', 'true');
    expect(await page.evaluate(() => (window as any).fixturePlayback.playing)).toBe(false);
});

test('invalid patterns cannot save and a storage failure leaves the editor recoverable', async ({ page }) => {
    await start(page); await openFilter(page);
    await filter(page).getByRole('button', { name: '启用逐行过滤', exact: true }).tap();
    await filter(page).getByRole('textbox', { name: '正则表达式', exact: true }).fill('[');
    await expect(filter(page).getByRole('button', { name: '保存', exact: true })).toBeDisabled();
    await filter(page).getByRole('textbox', { name: '正则表达式', exact: true }).fill('^第一句');
    await page.evaluate(() => {
        const original = Storage.prototype.setItem;
        (window as any).restoreSettingsStorage = () => { Storage.prototype.setItem = original; };
        Storage.prototype.setItem = function (key, value) {
            if (key === 'lyrics_filter_pattern') throw new Error('controlled-storage-error');
            original.call(this, key, value);
        };
    });
    await filter(page).getByRole('button', { name: '保存', exact: true }).tap();
    await expect(filter(page).getByRole('alert')).toHaveText('歌词设置保存失败，请重试。');
    await page.evaluate(() => (window as any).restoreSettingsStorage());
    await filter(page).getByRole('button', { name: '保存', exact: true }).tap();
    await expect(filter(page)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('lyrics_filter_pattern'))).toBe('^第一句');
});

test('a song change dismisses an old draft and replaces the displayed source', async ({ page }) => {
    await start(page); await openFilter(page);
    await filter(page).getByRole('button', { name: '始终显示', exact: true }).tap();
    await page.evaluate(() => {
        const w = window as any; w.fixtureLocalLyric = { content: '[00:00.00]新歌正文', fileName: 'new.lrc' };
        w.fixtureEmitPlayback({ currentSong: { ...w.fixturePlayback.currentSong,
            sourceRef: { kind: 'local', mediaId: '22222222-2222-4222-8222-222222222222' } } });
    });
    await expect(filter(page)).toBeHidden();
    expect(await page.evaluate(() => localStorage.getItem('lyrics_staff_policy'))).toBeNull();
    await openTools(page); await openTimeline(page);
    await expect(timelineHas(page, '新歌正文')).toBeVisible();
    await expect(timelineHas(page, '第一句歌词')).toHaveCount(0);
});

test('QQ and NetEase cached sources restore hidden lines while offline without rewriting the cache', async ({ page }) => {
    await start(page); await close(tools(page));
    for (const providerId of ['qq', 'netease']) {
        await page.evaluate(async providerId => {
            const w = window as any;
            const sourceRef = { kind: 'online', providerId, mediaId: '42' };
            const source = { lines: [
                { startTime: 0, endTime: 10, fullText: '在线第一句', words: [{ text: '在线第一句', startTime: 0, endTime: 10 }] },
                { startTime: 10, endTime: 20, fullText: '在线第二句', words: [{ text: '在线第二句', startTime: 10, endTime: 20 }] },
            ] };
            await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song: { sourceRef }, token: 'initial', field: 'lyrics', value: source });
            w.fixtureOfflineLyrics = true;
            w.fixtureEmitPlayback({ currentSong: { ...w.fixturePlayback.currentSong, id: 42, sourceRef }, position: 5 });
        }, providerId);
        await openTools(page); await openFilter(page);
        const toggle = filter(page).getByRole('button', { name: '启用逐行过滤', exact: true });
        if (await toggle.getAttribute('aria-pressed') !== 'true') await toggle.tap();
        await filter(page).getByRole('textbox', { name: '正则表达式', exact: true }).fill('^在线第一句');
        await filter(page).getByRole('button', { name: '保存', exact: true }).tap();
        await openTimeline(page); await expect(timelineHas(page, '在线第一句')).toHaveCount(0);
        await expect(timelineHas(page, '在线第二句')).toBeVisible(); await close(timeline(page));
        await openFilter(page); await toggle.tap();
        await filter(page).getByRole('button', { name: '保存', exact: true }).tap();
        await openTimeline(page); await expect(timelineHas(page, '在线第一句')).toBeVisible();
        await close(timeline(page)); await close(tools(page));
        const result = await page.evaluate(providerId => {
            const cache = JSON.parse(sessionStorage.getItem('fixture-lyric-cache')!);
            return cache[JSON.stringify({ kind: 'online', providerId, mediaId: '42' })].lyrics.lines.map((line: any) => line.fullText);
        }, providerId);
        expect(result).toEqual(['在线第一句', '在线第二句']);
    }
    expect(await page.evaluate(() => (window as any).fixtureLyricRequests || 0)).toBe(0);
});

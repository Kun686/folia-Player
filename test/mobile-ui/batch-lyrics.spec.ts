import { unzipSync, strFromU8 } from 'fflate';
import { test, expect } from './fixtures';

// batch-lyrics.spec.ts — original options and actual ZIP contents; native sharing is a controlled boundary.
test('batch export works without a current song, with original scopes, formats and touch layout', async ({ page }, info) => {
    await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
    await page.goto('/mobile.html');
    await page.evaluate(async () => {
        const w = window as any;
        for (const providerId of ['qq', 'netease']) {
            await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song: { sourceRef: { kind: 'online', providerId, mediaId: '42' } }, token: 'initial', field: 'lyrics',
                value: { lines: [{ fullText: '完整缓存歌词', startTime: 1, endTime: 5, words: [], translation: 'Translation', romanization: 'roman' }] } });
        }
    });
    await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
    await page.getByRole('button', { name: '批量导出歌词', exact: true }).tap();
    const dialog = page.getByRole('dialog', { name: '批量导出歌词', exact: true });
    await dialog.getByRole('button', { name: '联网补全歌名', exact: true }).tap();
    await dialog.getByRole('button', { name: '翻译', exact: true }).tap();
    await dialog.getByRole('button', { name: '开始导出', exact: true }).tap();
    await expect(dialog.getByRole('status')).toContainText('已导出 2 首，跳过 0 首');
    const shared = await page.evaluate(() => (window as any).fixtureSharedArchives);
    expect(shared).toHaveLength(1);
    const files = unzipSync(Buffer.from(shared[0].data, 'base64'));
    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest.exported.map((x: any) => x.songKey)).toEqual(['online:qq:42', 'online:netease:42']);
    expect(Object.keys(files)).toHaveLength(5);
    for (const row of manifest.exported) {
        expect(JSON.parse(strFromU8(files[row.files[0]])).lyrics.lines[0].fullText).toBe('完整缓存歌词');
        expect(strFromU8(files[row.files[1]])).not.toContain('Translation');
        expect(strFromU8(files[row.files[1]])).toContain('roman');
    }
    await expect(dialog.getByRole('button', { name: '开始导出', exact: true })).toBeInViewport();
    expect(await dialog.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
    await page.screenshot({ path: `.mobile-test-results/batch-lyrics-${info.project.name}.png` });
    await page.setViewportSize({ width: 390, height: 400 });
    await expect(dialog.getByRole('button', { name: '开始导出', exact: true })).toBeInViewport();
    await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
    expect(await page.evaluate(() => (window as any).fixturePlayback.queue)).toEqual([]);
    expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
});

test('batch close cancels pending reads; failures and system cancellation stay visible', async ({ page }) => {
    await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
    await page.goto('/mobile.html');
    await page.evaluate(async () => {
        const w = window as any;
        await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song: { sourceRef: { kind: 'online', providerId: 'qq', mediaId: '42' } }, token: 'initial', field: 'lyrics',
            value: { lines: [{ fullText: '保留歌词', startTime: 1, endTime: 5, words: [] }] } });
        w.fixtureExportDelay = true;
    });
    await page.getByRole('button', { name: '服务器与外观', exact: true }).tap();
    const open = () => page.getByRole('button', { name: '批量导出歌词', exact: true }).tap();
    await open();
    const dialog = page.getByRole('dialog', { name: '批量导出歌词', exact: true });
    await dialog.getByRole('button', { name: '开始导出', exact: true }).tap();
    await expect.poll(() => page.evaluate(() => (window as any).fixturePendingExport?.length || 0)).toBe(1);
    await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
    await page.evaluate(() => { const w = window as any; w.fixtureExportDelay = false; w.fixturePendingExport.forEach((finish: () => void) => finish()); w.fixtureShareCancelled = true; });
    await open(); await dialog.getByRole('button', { name: '开始导出', exact: true }).tap();
    await expect(dialog.getByRole('status')).toContainText('已取消导出');
    expect(await page.evaluate(() => (window as any).fixtureSharedArchives.length)).toBe(1);
    await page.evaluate(() => { (window as any).fixtureExportReadFailure = true; });
    await dialog.getByRole('button', { name: '开始导出', exact: true }).tap();
    await expect(dialog.getByRole('alert')).toHaveText('歌词导出失败');
    await page.evaluate(() => { const w = window as any; w.fixtureExportReadFailure = false; w.fixtureShareCancelled = false; w.fixtureExportLegacy = true; });
    await dialog.getByRole('button', { name: '开始导出', exact: true }).tap();
    await expect(dialog.getByRole('status').filter({ hasText: '旧缓存缺少歌曲身份' })).toContainText('有 1 首');
});

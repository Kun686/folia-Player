import { test, expect } from './fixtures';

// lyricExport.spec.ts — real dialog/serializers; sharing is controlled and is not iOS acceptance.
test('original FIA/LRC tiles export, report cancellation/failure and retain playback on touch screens', async ({ page }, info) => {
    await page.addInitScript(() => { (window as any).fixtureNoServer = true; });
    await page.goto('/mobile.html');
    await page.getByRole('button', { name: '导入音乐', exact: true }).tap();
    await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).tap();
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 5 }));
    await page.getByRole('button', { name: '歌词', exact: true }).tap();
    await page.getByRole('button', { name: '导出这首歌', exact: true }).tap();
    const dialog = page.locator('[data-ponder="lyric-file-dialog"]');
    const fia = dialog.getByRole('button', { name: /Folia 无损/ });
    await expect(fia).toBeEnabled(); await fia.tap();
    await expect(dialog.getByRole('status')).toHaveText('歌词已导出');
    const files = await page.evaluate(() => (window as any).fixtureSharedLyrics);
    expect(files).toHaveLength(1); expect(files[0].fileName).toMatch(/\.fia$/);
    expect(JSON.parse(files[0].content).lyrics.lines.some((line: any) => line.fullText === '测试本地歌词')).toBe(true);
    await page.evaluate(() => { (window as any).fixtureShareCancelled = true; });
    await dialog.getByRole('button', { name: /增强型 LRC/ }).tap();
    await expect(dialog.getByRole('status')).toHaveText('已取消导出');
    await page.evaluate(() => { (window as any).fixtureShareFailure = true; });
    await fia.tap(); await expect(dialog.getByRole('alert')).toHaveText('歌词导出失败');
    await page.evaluate(() => { (window as any).fixtureShareFailure = false; (window as any).fixtureShareCancelled = false; });
    await fia.tap(); await expect(dialog.getByRole('status')).toHaveText('歌词已导出');
    expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(5);
    expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
    await page.screenshot({ path: `.mobile-test-results/lyric-export-${info.project.name}.png` });
    if (info.project.name === 'phone') {
        await page.setViewportSize({ width: 390, height: 400 });
        await dialog.getByRole('button', { name: '关闭', exact: true }).tap();
        await expect(dialog).toBeHidden();
    } else {
        await page.evaluate(() => { const w = window as any; w.fixtureEmitPlayback({ currentSong: { ...w.fixturePlayback.currentSong,
            sourceRef: { kind: 'local', mediaId: 'other-song' } } }); });
        await expect(dialog).toBeHidden();
    }
});

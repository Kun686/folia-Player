import { test, expect } from './fixtures';

// local-sources.spec.ts — actual original Worker/parser and source buttons over controlled native storage responses.
test('local and embedded sources switch independently and a fresh import selects local', async ({ page }, info) => {
    await page.addInitScript(() => {
        const w = window as any; w.fixtureNoServer = true;
        w.fixtureLocalLyric = { content: '[00:00.00]导入的本地歌词', fileName: 'original.lrc',
            embeddedContent: '[00:00.00]音频内嵌歌词\n[00:00.00]Embedded translation', lyricsSource: 'local' };
    });
    await page.goto('/mobile.html');
    await page.getByRole('button', { name: '导入音乐', exact: true }).click();
    await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
    await expect(page.getByRole('region', { name: '播放', exact: true }).getByRole('heading', { name: '本地测试音乐', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '歌词与动效', exact: true }).tap();
    await page.getByLabel('歌词动画', { exact: true }).selectOption('still');
    await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 1 }));
    const stage = page.locator('.lyric-stage'), dialog = page.getByRole('dialog', { name: '歌词', exact: true });
    const open = () => page.getByRole('button', { name: '歌词', exact: true }).click();
    await expect(stage.getByText('导入的本地歌词', { exact: true })).toBeVisible();
    await open();
    const embedded = dialog.getByRole('button', { name: '内嵌', exact: true });
    await page.evaluate(() => { (window as any).fixtureLocalSaveFailure = true; });
    await embedded.tap();
    await expect(dialog.getByRole('alert')).toBeVisible();
    await expect(dialog.getByRole('button', { name: '本地', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => { (window as any).fixtureLocalSaveFailure = false; });
    await embedded.tap(); await expect(dialog).toBeHidden();
    await expect(stage.getByText('音频内嵌歌词', { exact: true })).toBeVisible();
    await open(); await expect(embedded).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => embedded.evaluate(node => getComputedStyle(node).boxShadow)).not.toBe('none');
    await expect(dialog.getByText('original.lrc', { exact: true })).toBeVisible();
    await page.screenshot({ path: '.mobile-test-results/local-sources-' + info.project.name + '.png' });
    await dialog.getByRole('button', { name: '本地', exact: true }).tap();
    await expect(stage.getByText('导入的本地歌词', { exact: true })).toBeVisible();
    await open(); await embedded.tap();
    await expect(stage.getByText('音频内嵌歌词', { exact: true })).toBeVisible();
    await open(); await dialog.getByRole('button', { name: '导入歌词', exact: true }).tap();
    await expect(stage.getByText('新导入的歌词', { exact: true })).toBeVisible();
    await open(); await embedded.tap();
    await expect(stage.getByText('音频内嵌歌词', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
    expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

import type { Page } from '@playwright/test';
import { test, expect } from './fixtures';

// segmentation.spec.ts — original parser/editor and real IndexedDB, with only native IO controlled.
const raw = ['第一句歌词', '第二句歌词'].map((text, line) => `[${line * 10000},10000]`
    + [...text].map((char, i) => `(${line * 10000 + i * 2000},2000,0)${char}`).join('')).join('\n');
const edited = '第/一句/歌词\n第二/句歌/词';
const dialog = (page: Page) => page.getByRole('dialog', { name: '歌词分词调整', exact: true });
const openTools = (page: Page) => page.getByRole('button', { name: '歌词', exact: true }).click();
async function openEditor(page: Page) {
    await openTools(page);
    await page.getByRole('button', { name: '歌词分词调整', exact: true }).click();
    await expect(dialog(page).getByRole('button', { name: '复制当前结果' })).toBeVisible();
}
async function selectLocal(page: Page) {
    await page.getByRole('button', { name: '导入音乐', exact: true }).click();
    await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
    await page.evaluate(() => (window as any).fixtureEmitPlayback({ playing: false, position: 5 }));
    await openEditor(page);
}
async function start(page: Page) {
    await page.addInitScript(content => {
        const w = window as any; w.fixtureNoServer = true; w.fixtureLyricTools = true;
        w.fixtureLocalLyric = { content, fileName: 'segmentation.yrc' };
    }, raw);
    await page.goto('/mobile.html'); await selectLocal(page);
}
async function input(page: Page) {
    await dialog(page).getByText('粘贴／编辑分词', { exact: true }).tap();
    return dialog(page).getByRole('textbox', { name: /分词结果/ });
}
async function copyCurrent(page: Page) {
    await dialog(page).getByRole('button', { name: '复制当前结果' }).tap();
    return page.evaluate(() => (window as any).fixtureClipboard as string);
}

test('touch import, copy, persistent restoration and reset retain the raw lyrics and audio position', async ({ page }, info) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    await start(page); const original = await copyCurrent(page);
    await (await input(page)).fill(edited);
    await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
    await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
    expect(await copyCurrent(page)).toBe(edited);
    await page.screenshot({ animations: 'disabled', path: '.mobile-test-results/segmentation-' + info.project.name + '.png' });
    expect(await dialog(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => (window as any).fixtureLocalLyric.content)).toBe(raw);
    expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(5);
    expect(await page.evaluate(() => (window as any).fixtureCommands)).toEqual([]);
    await page.reload(); await selectLocal(page);
    expect(await copyCurrent(page)).toBe(edited);
    await dialog(page).getByRole('button', { name: '恢复默认' }).tap();
    await expect(dialog(page).getByText('默认分词', { exact: true })).toBeVisible();
    expect(await copyCurrent(page)).toBe(original);
    await page.reload(); await selectLocal(page);
    await expect(dialog(page).getByText('默认分词', { exact: true })).toBeVisible();
    await dialog(page).getByRole('button', { name: '复制提示词' }).tap();
    expect(await page.evaluate(() => (window as any).fixtureClipboard)).toContain('第一句歌词');
    expect(errors).toEqual([]);
});

test('malformed text and rejected IndexedDB writes remain recoverable and never report success', async ({ page }) => {
    await start(page); const box = await input(page);
    await box.fill('改掉的歌词'); await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
    await expect(dialog(page).getByRole('alert')).toHaveText('行数与当前歌词不一致');
    await page.evaluate(() => {
        const put = IDBObjectStore.prototype.put;
        (window as any).restoreSegmentationWrites = () => { IDBObjectStore.prototype.put = put; };
        IDBObjectStore.prototype.put = function (value, key) {
            if (String(value?.key).startsWith('lyricSeg_')) throw new DOMException('controlled-write-failure', 'QuotaExceededError');
            return key === undefined ? put.call(this, value) : put.call(this, value, key);
        };
    });
    await box.fill(edited); await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
    await expect(dialog(page).getByRole('alert')).toHaveText('分词保存失败，请重试。');
    await expect(dialog(page).getByText('分词结果已保存', { exact: true })).toHaveCount(0);
    await expect(box).toHaveValue(edited);
    await page.evaluate(() => (window as any).restoreSegmentationWrites());
    await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
    await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
});

test('switching songs dismisses drafts and isolates identical lyrics by provider identity', async ({ page }) => {
    await start(page); await (await input(page)).fill(edited);
    await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
    await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
    for (const providerId of ['qq', 'netease']) {
        await page.evaluate(async providerId => {
            const w = window as any, sourceRef = { kind: 'online', providerId, mediaId: '42' };
            const lyrics = { lines: ['第一句歌词', '第二句歌词'].map((fullText, i) => ({ fullText, startTime: i * 10,
                endTime: (i + 1) * 10, words: [{ text: fullText, startTime: i * 10, endTime: (i + 1) * 10 }] })) };
            await w.Capacitor.nativePromise('FoliaNative', 'writeLyricCache', { song: { sourceRef }, token: 'initial', field: 'lyrics', value: lyrics });
            w.fixtureOfflineLyrics = true;
            w.fixtureEmitPlayback({ currentSong: { ...w.fixturePlayback.currentSong, id: 42, sourceRef } });
        }, providerId);
        await expect(dialog(page)).toBeHidden(); await openEditor(page);
        await expect(dialog(page).getByText('默认分词', { exact: true })).toBeVisible();
        await (await input(page)).fill(edited);
        if (providerId === 'qq') {
            await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
            await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
        }
    }
    await page.evaluate(() => {
        const w = window as any; w.fixtureEmitPlayback({ currentSong: { ...w.fixturePlayback.currentSong,
            sourceRef: { kind: 'online', providerId: 'qq', mediaId: '42' } } });
    });
    await expect(dialog(page)).toBeHidden(); await openEditor(page);
    expect(await copyCurrent(page)).toBe(edited);
    expect(await page.evaluate(() => (window as any).fixtureLyricRequests || 0)).toBe(0);
});

test('read and reset failures show errors, keep the saved record and can be retried', async ({ page }) => {
    await start(page); await (await input(page)).fill(edited);
    await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
    await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
    await page.evaluate(() => {
        const remove = IDBObjectStore.prototype.delete;
        (window as any).restoreSegmentationDelete = () => { IDBObjectStore.prototype.delete = remove; };
        IDBObjectStore.prototype.delete = function (key) {
            if (String(key).startsWith('lyricSeg_')) throw new DOMException('controlled-reset-failure', 'UnknownError');
            return remove.call(this, key);
        };
    });
    await dialog(page).getByRole('button', { name: '恢复默认' }).tap();
    await expect(dialog(page).getByRole('alert')).toHaveText('分词保存失败，请重试。');
    await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
    await expect(dialog(page).getByText('分词结果已保存', { exact: true })).toHaveCount(0);
    await page.evaluate(() => (window as any).restoreSegmentationDelete());
    await page.addInitScript(() => {
        const get = IDBObjectStore.prototype.get;
        (window as any).restoreSegmentationRead = () => { IDBObjectStore.prototype.get = get; };
        IDBObjectStore.prototype.get = function (key) {
            if (String(key).startsWith('lyricSeg_')) throw new DOMException('controlled-read-failure', 'UnknownError');
            return get.call(this, key);
        };
    });
    await page.reload();
    await page.getByRole('button', { name: '导入音乐', exact: true }).click();
    await page.getByRole('button', { name: '播放 本地测试音乐', exact: true }).click();
    await openTools(page); await page.getByRole('button', { name: '歌词分词调整', exact: true }).click();
    await expect(dialog(page).getByRole('alert')).toHaveText('分词记录读取失败，请重试。');
    await page.evaluate(() => (window as any).restoreSegmentationRead());
    await dialog(page).getByRole('button', { name: '重试', exact: true }).tap();
    await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
    await dialog(page).getByRole('button', { name: '恢复默认' }).tap();
    await expect(dialog(page).getByText('默认分词', { exact: true })).toBeVisible();
});

test('a delayed old-song database read cannot replace the new song record', async ({ page }) => {
    await start(page); await (await input(page)).fill(edited);
    await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
    await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
    await page.evaluate(() => {
        const w = window as any;
        w.segmentationOriginalSong = w.fixturePlayback.currentSong;
        w.fixtureEmitPlayback({ currentSong: { ...w.segmentationOriginalSong, sourceRef: { kind: 'local', mediaId: 'other' } } });
    });
    await expect(dialog(page)).toBeHidden(); await openEditor(page);
    await expect(dialog(page).getByText('默认分词', { exact: true })).toBeVisible();
    await page.evaluate(() => {
        const w = window as any, get = IDBObjectStore.prototype.get;
        const keyToDelay = 'lyricSeg_local:' + w.segmentationOriginalSong.sourceRef.mediaId;
        IDBObjectStore.prototype.get = function (key) {
            const request = get.call(this, key);
            if (key === keyToDelay) request.addEventListener('success', event => {
                event.stopImmediatePropagation();
                w.releaseOldSegmentationRead = () => { IDBObjectStore.prototype.get = get; request.dispatchEvent(new Event('success')); };
            }, { once: true });
            return request;
        };
        w.fixtureEmitPlayback({ currentSong: w.segmentationOriginalSong });
    });
    await expect.poll(() => page.evaluate(() => typeof (window as any).releaseOldSegmentationRead)).toBe('function');
    await page.evaluate(() => {
        const w = window as any;
        w.fixtureEmitPlayback({ currentSong: { ...w.segmentationOriginalSong, sourceRef: { kind: 'local', mediaId: 'other' } } });
    });
    await openEditor(page);
    await expect(dialog(page).getByText('默认分词', { exact: true })).toBeVisible();
    await page.evaluate(() => (window as any).releaseOldSegmentationRead());
    await expect(dialog(page).getByText('默认分词', { exact: true })).toBeVisible();
    expect(await copyCurrent(page)).not.toBe(edited);
});

test('saved boundaries reach the original Partita renderer and reset restores its default layout', async ({ page }, info) => {
    await start(page);
    const defaultSplit = (await copyCurrent(page)).split('\n')[0].split('/');
    await (await input(page)).fill(edited);
    await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
    await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
    await dialog(page).getByRole('button', { name: '关闭', exact: true }).tap();
    await page.getByRole('dialog', { name: '歌词', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
    await page.getByRole('button', { name: '歌词与动效', exact: true }).tap();
    await page.getByLabel('歌词动画', { exact: true }).selectOption('partita');
    await page.locator('.visual-settings > header').getByRole('button', { name: '关闭', exact: true }).tap();
    const words = page.locator('.lyric-stage [data-partita-fit-word] > span.relative.z-10');
    // Partita groups layout chunks but deliberately keeps each parser word's timing inside them.
    const chunks = () => page.locator('.lyric-stage [data-partita-fit-chunk]').evaluateAll(elements =>
        elements.map(element => Array.from(element.querySelectorAll('[data-partita-fit-word] > span.relative.z-10'))
            .map(word => word.textContent).join('')));
    await expect(words).toHaveText(['第', '一', '句', '歌', '词']);
    await expect.poll(chunks).toEqual(['第', '一句', '歌词']);
    await page.screenshot({ animations: 'disabled', path: '.mobile-test-results/segmentation-renderer-' + info.project.name + '.png' });
    await openEditor(page); await dialog(page).getByRole('button', { name: '恢复默认' }).tap();
    await expect(dialog(page).getByText('默认分词', { exact: true })).toBeVisible();
    await dialog(page).getByRole('button', { name: '关闭', exact: true }).tap();
    await page.getByRole('dialog', { name: '歌词', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
    await expect.poll(chunks).toEqual(defaultSplit);
    await expect(words).toHaveText(['第', '一', '句', '歌', '词']);
    expect(await page.evaluate(() => (window as any).fixturePlayback.position)).toBe(5);
});

test('short viewports keep touch editing, saving and closing reachable', async ({ page }, info) => {
    test.skip(info.project.name !== 'phone');
    await start(page);
    for (const viewport of [{ width: 844, height: 390 }, { width: 390, height: 400 }]) {
        await page.setViewportSize(viewport);
        const box = await input(page); await box.fill(edited);
        await dialog(page).getByRole('button', { name: '保存分词', exact: true }).tap();
        await expect(dialog(page).getByText('手动分词 · 2 行', { exact: true })).toBeVisible();
        expect(await dialog(page).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
        await page.screenshot({ path: `.mobile-test-results/segmentation-short-${viewport.width}.png` });
        await dialog(page).getByRole('button', { name: '关闭', exact: true }).tap();
        await page.getByRole('dialog', { name: '歌词', exact: true }).getByRole('button', { name: '关闭', exact: true }).tap();
        await openEditor(page);
    }
});

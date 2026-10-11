import { test, expect } from './fixtures';

// local-folders.spec.ts — UI transport fixtures; actual filesystem/import acceptance is tested separately in XCTest and the picker.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
    const songs = ['First', 'Second', 'Third'].map((name, n) => ({ id: id(n), name, artists: [], album: { id: '', name: '' }, durationMs: 180000,
      sourceRef: { kind: 'local', mediaId: id(n) } }));
    const root = { id: id(100), name: '我的音乐', ignoredPaths: [], directories: [{ path: 'Album', ignored: false }],
      tracks: [{ id: id(0), path: 'First.wav' }, { id: id(1), path: 'Album/Second.wav' }, { id: id(2), path: 'Album/Third.wav' }] };
    win.fixtureFolders = { revision: '1', roots: [] };
    win.fixtureFolderCalls = [];
    let token = '', progress: any;
    win.fixtureFolderBridge = async (method: string, options: any) => {
      win.fixtureFolderCalls.push({ method, options });
      if (method === 'beginFolderImport') {
        if (win.fixtureFolderError) throw Error(win.fixtureFolderError);
        token = options.token;
        progress = { token, rootID: root.id, name: root.name, total: 1, completed: 0, reused: 0, path: 'First.wav' };
        if (options.ignoredPaths) root.ignoredPaths = options.ignoredPaths;
        return progress;
      }
      if (method === 'readFolderImport') {
        if (win.fixtureFolderReadWait) return new Promise(resolve => { win.fixtureFolderReadRelease = () => resolve({}); });
        return { lyric: { data: btoa('[00:00]Test'), fileName: 'First.lrc' } };
      }
      if (method === 'prepareFolderImport') return { ...progress, completed: 1, path: undefined };
      if (method === 'finishFolderImport') {
        win.fixtureFolders = { revision: String(Date.now()), roots: [{ ...root,
          directories: [{ path: 'Album', ignored: root.ignoredPaths.includes('Album' as never) }],
          tracks: root.ignoredPaths.length ? root.tracks.slice(0, 1) : root.tracks }] };
        win.fixtureSetLocalSongs(root.ignoredPaths.length ? songs.slice(0, 1) : songs);
        return { rootID: root.id, count: root.ignoredPaths.length ? 1 : 3, warnings: [] };
      }
      if (method === 'removeLocalFolder') { win.fixtureFolders = { revision: 'removed', roots: [] }; win.fixtureSetLocalSongs([]); }
      return {};
    };
  });
  await page.goto('/mobile.html');
  await page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name: '文件夹', exact: true }).click();
});
test('import, scope playback, rotate, ignore, restore and remove use existing library controls', async ({ page }) => {
  const allSongs = page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name: '全部歌曲', exact: true });
  expect(await allSongs.evaluate(element => {
    const range = document.createRange(); range.selectNodeContents(element); return range.getClientRects().length;
  })).toBe(1);
  await page.getByRole('button', { name: '导入文件夹', exact: true }).click();
  await expect(page.getByText('此文件夹共有 3 首歌曲')).toBeVisible();
  await page.getByRole('button', { name: '我的音乐 3 首歌曲' }).click();
  await page.getByRole('button', { name: 'Album 2 首歌曲' }).click();
  await expect(page.getByRole('button', { name: '播放 First', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '播放 Second', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).fixturePlayback.queue.map((song: any) => song.name))).toEqual(['Second', 'Third']);
  await page.getByRole('button', { name: '返回音乐库', exact: true }).click();
  const size = page.viewportSize()!;
  await page.setViewportSize({ width: size.height, height: size.width });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize(size);
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '忽略此文件夹' }).click();
  await expect(page.getByRole('button', { name: '恢复并重新扫描' })).toBeEnabled();
  await page.getByRole('button', { name: '恢复并重新扫描' }).click();
  await expect(page.getByRole('button', { name: '播放 Second', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '上一级文件夹' }).click();
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('button', { name: '移除根目录' }).click();
  await expect(page.getByText('导入音乐文件夹后，可浏览歌曲与子目录。')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureFolderCalls.filter((call: any) => call.method === 'finishFolderImport').length)).toBe(3);
});
test('cancel while reading never commits and errors leave the import action usable', async ({ page }) => {
  await page.evaluate(() => { (window as any).fixtureFolderReadWait = true; });
  await page.getByRole('button', { name: '导入文件夹', exact: true }).click();
  await expect(page.getByRole('progressbar', { name: '文件夹导入进度' })).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => (window as any).fixtureFolderReadRelease());
  await expect(page.getByRole('button', { name: '导入文件夹', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => (window as any).fixtureFolderCalls.some((call: any) => call.method === 'finishFolderImport'))).toBe(false);
  await page.evaluate(() => { (window as any).fixtureFolderError = 'folder-file-changed'; });
  await page.getByRole('button', { name: '导入文件夹', exact: true }).click();
  await expect(page.getByRole('alert').filter({ hasText: '已保留原曲库' })).toBeVisible();
  await expect(page.getByRole('button', { name: '导入文件夹', exact: true })).toBeEnabled();
  await page.screenshot({ path: test.info().outputPath('folder-error.png') });
});

import { test, expect } from './fixtures';

// local-folder-rescan.spec.ts — touch layout and partial-result UI using the existing native transport fixture.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    const win = window as any;
    win.fixtureNoServer = true;
    const roots = ['First', 'Second', 'Third'].map((name, index) => ({ id: `root-${index}`, name,
      ignoredPaths: [], directories: [], tracks: [] }));
    win.fixtureFolders = { revision: '1', roots };
    win.fixtureBatchCalls = [];
    let active: any;
    win.fixtureFolderBridge = async (method: string, options: any) => {
      win.fixtureBatchCalls.push({ method, options });
      if (method === 'beginFolderImport') {
        const root = roots.find(root => root.id === options.rootID)!;
        if (win.fixtureFailedRoot === root.id) throw Error('folder-access-required');
        active = { token: options.token, rootID: root.id, name: root.name, total: 1, completed: 0, reused: 0 };
        return active;
      }
      if (method === 'readFolderImport') {
        if (win.fixtureWaitingRoot === active.rootID) return new Promise(resolve => { win.fixtureBatchRelease = () => resolve({}); });
        return {};
      }
      if (method === 'prepareFolderImport') return { ...active, completed: 1 };
      if (method === 'finishFolderImport') return { rootID: active.rootID, count: 0, warnings: [] };
      return {};
    };
  });
  await page.goto('/mobile.html');
  await page.getByRole('navigation', { name: '浏览本地音乐库' }).getByRole('button', { name: '文件夹', exact: true }).click();
});
test('rescans all roots once and prevents overlapping import or duplicate starts', async ({ page }) => {
  await page.evaluate(() => { (window as any).fixtureWaitingRoot = 'root-0'; });
  const all = page.getByRole('button', { name: '重新扫描全部文件夹', exact: true });
  await all.click();
  await expect(page.getByText('正在扫描 1 / 3：First')).toBeVisible();
  await expect(all).toBeDisabled();
  await expect(page.getByRole('button', { name: '导入文件夹', exact: true })).toBeDisabled();
  await page.evaluate(() => (window as any).fixtureBatchRelease());
  await expect(page.getByText('已重新扫描 3 / 3 个文件夹')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureBatchCalls.filter((call: any) => call.method === 'beginFolderImport').map((call: any) => call.options.rootID))).toEqual(['root-0', 'root-1', 'root-2']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: test.info().outputPath('folder-rescan-complete.png') });
});
test('failure names the inaccessible root, keeps previous commits and offers explicit reauthorization', async ({ page }) => {
  await page.evaluate(() => { (window as any).fixtureFailedRoot = 'root-1'; });
  await page.getByRole('button', { name: '重新扫描全部文件夹', exact: true }).click();
  await expect(page.getByText('已停止，完成 1 / 3 个文件夹')).toBeVisible();
  await expect(page.getByRole('alert').filter({ hasText: 'Second' })).toContainText('目录访问权限已失效');
  await expect(page.getByText('已完成的文件夹已保存，其余文件夹保留原曲库。')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureBatchCalls.filter((call: any) => call.method === 'finishFolderImport').length)).toBe(1);
  await page.evaluate(() => { (window as any).fixtureFailedRoot = undefined; });
  await page.getByRole('button', { name: '重新选择此文件夹' }).click();
  await expect(page.getByText('此文件夹共有 0 首歌曲')).toBeVisible();
  expect(await page.evaluate(() => (window as any).fixtureBatchCalls.filter((call: any) => call.method === 'beginFolderImport').at(-1).options)).toMatchObject({ rootID: 'root-1', pick: true });
});
test('cancellation during the second root leaves the first saved and does not scan the third', async ({ page }) => {
  await page.evaluate(() => { (window as any).fixtureWaitingRoot = 'root-1'; });
  await page.getByRole('button', { name: '重新扫描全部文件夹', exact: true }).click();
  await expect(page.getByText('正在扫描 2 / 3：Second')).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.evaluate(() => (window as any).fixtureBatchRelease());
  await expect(page.getByText('已停止，完成 1 / 3 个文件夹')).toBeVisible();
  await expect(page.getByRole('button', { name: '重新扫描全部文件夹', exact: true })).toBeEnabled();
  const calls = await page.evaluate(() => (window as any).fixtureBatchCalls);
  expect(calls.filter((call: any) => call.method === 'beginFolderImport').length).toBe(2);
  expect(calls.filter((call: any) => call.method === 'finishFolderImport').length).toBe(1);
});
test('hiding the document cancels the batch before another root is started', async ({ page }) => {
  await page.evaluate(() => { (window as any).fixtureWaitingRoot = 'root-1'; });
  await page.getByRole('button', { name: '重新扫描全部文件夹', exact: true }).click();
  await expect(page.getByText('正在扫描 2 / 3：Second')).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, value: true });
    document.dispatchEvent(new Event('visibilitychange'));
    (window as any).fixtureBatchRelease();
    delete (document as any).hidden;
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.getByText('已停止，完成 1 / 3 个文件夹')).toBeVisible();
  const calls = await page.evaluate(() => (window as any).fixtureBatchCalls);
  expect(calls.filter((call: any) => call.method === 'beginFolderImport').length).toBe(2);
  expect(calls.filter((call: any) => call.method === 'finishFolderImport').length).toBe(1);
});

import type { Page } from '@playwright/test';

// folder-rescan-fixture.ts — shared controlled roots and cancellable native folder import transactions.
export async function folderRescanFixture(page: Page) {
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
}

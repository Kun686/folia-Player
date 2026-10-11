import { describe, expect, it, vi } from 'vitest';
import { rescanLocalFolders } from '@/mobile/localFolderRescan';
import type { NativeFolderBatchProgress, NativeFolderImportOptions } from '@/types/nativeFolder';

// localFolderRescan.test.ts — partial commits, cancellation boundaries and fresh root snapshots through the actual import protocol.
function fixture() {
  const roots = ['a', 'b', 'c'].map(id => ({ id, name: `Music ${id}`, ignoredPaths: [], directories: [], tracks: [] }));
  let active: NativeFolderImportOptions | undefined;
  const controller = new AbortController(), progress = vi.fn<(value: NativeFolderBatchProgress) => void>();
  const bridge = {
    readLocalFolders: vi.fn(async () => ({ revision: '1', roots })),
    beginFolderImport: vi.fn(async (options: NativeFolderImportOptions) => {
      expect(active).toBeUndefined(); active = options;
      return { token: options.token, rootID: options.rootID!, name: `Music ${options.rootID}`, total: 0, completed: 0, reused: 2 };
    }),
    readFolderImport: vi.fn(async () => ({})),
    prepareFolderImport: vi.fn(async () => { throw Error('unexpected preparation'); }),
    finishFolderImport: vi.fn(async () => {
      const rootID = active!.rootID!; active = undefined;
      return { rootID, count: 2, warnings: [{ path: 'song.lrc', code: 'sidecar-unavailable' }] };
    }),
    cancelFolderImport: vi.fn(async () => { active = undefined; }),
  };
  return { bridge, roots, controller, progress };
}
describe('rescan all imported roots', () => {
  it('reads current roots including empty roots, deduplicates identities and commits serially', async () => {
    const { bridge, roots, controller, progress } = fixture(); roots.push(roots[0]);
    const result = await rescanLocalFolders(bridge, ['lrc', 'krc'], controller.signal, progress);
    expect(result).toMatchObject({ total: 3, status: 'complete', completed: [{ rootID: 'a', name: 'Music a' }, { rootID: 'b' }, { rootID: 'c' }] });
    expect(bridge.beginFolderImport.mock.calls.map(([options]) => options.rootID)).toEqual(['a', 'b', 'c']);
    const tokens = bridge.beginFolderImport.mock.calls.map(([options]) => options.token);
    expect(new Set(tokens).size).toBe(3);
    for (const [options] of bridge.beginFolderImport.mock.calls) expect(options).toMatchObject({ pick: false, order: ['lrc', 'krc'] });
    for (let n = 1; n < 3; n++) expect(bridge.beginFolderImport.mock.invocationCallOrder[n]).toBeGreaterThan(bridge.finishFolderImport.mock.invocationCallOrder[n - 1]);
    expect(progress.mock.calls.filter(([value]) => !value.track).map(([value]) => value.completed)).toEqual([0, 1, 2]);
    expect(result.completed[0].warnings).toHaveLength(1);
  });
  it('stops at an inaccessible root and retains the preceding committed result', async () => {
    const { bridge, controller, progress } = fixture();
    bridge.beginFolderImport.mockImplementationOnce(async options => ({ token: options.token, rootID: 'a', name: 'Music a', total: 0, completed: 0, reused: 0 }));
    bridge.finishFolderImport.mockResolvedValueOnce({ rootID: 'a', count: 0, warnings: [] });
    bridge.beginFolderImport.mockRejectedValueOnce(Error('folder-access-required'));
    const result = await rescanLocalFolders(bridge, [], controller.signal, progress);
    expect(result).toMatchObject({ total: 3, status: 'failed', completed: [{ rootID: 'a', count: 0 }], failed: { id: 'b', name: 'Music b', code: 'folder-access-required' } });
    expect(bridge.beginFolderImport).toHaveBeenCalledTimes(2);
    expect(bridge.cancelFolderImport).toHaveBeenCalledOnce();
  });
  it('keeps a commit that wins cancellation and never begins the next root', async () => {
    const { bridge, controller, progress } = fixture();
    bridge.finishFolderImport.mockImplementationOnce(async () => { controller.abort(); return { rootID: 'a', count: 1, warnings: [] }; });
    const result = await rescanLocalFolders(bridge, [], controller.signal, progress);
    expect(result).toMatchObject({ total: 3, status: 'cancelled', completed: [{ rootID: 'a' }] });
    expect(bridge.beginFolderImport).toHaveBeenCalledOnce();
  });
  it('reports all roots complete when cancellation races the final successful commit', async () => {
    const { bridge, roots, controller, progress } = fixture(); roots.splice(1);
    bridge.finishFolderImport.mockImplementationOnce(async () => { controller.abort(); return { rootID: 'a', count: 0, warnings: [] }; });
    expect(await rescanLocalFolders(bridge, [], controller.signal, progress)).toMatchObject({ total: 1, status: 'complete' });
  });
  it('stops on native background cancellation without reporting a failure or continuing', async () => {
    const { bridge, controller, progress } = fixture();
    bridge.beginFolderImport.mockRejectedValueOnce(Error('folder-cancelled'));
    const result = await rescanLocalFolders(bridge, [], controller.signal, progress);
    expect(result).toEqual({ total: 3, completed: [], status: 'cancelled' });
    expect(bridge.beginFolderImport).toHaveBeenCalledOnce();
  });
  it('does not begin work if cancelled during catalog reading', async () => {
    const { bridge, roots, controller, progress } = fixture();
    bridge.readLocalFolders.mockImplementationOnce(async () => { controller.abort(); return { revision: '2', roots }; });
    await expect(rescanLocalFolders(bridge, [], controller.signal, progress)).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.beginFolderImport).not.toHaveBeenCalled();
  });
  it('does not turn a catalog failure into a successful empty scan', async () => {
    const { bridge, controller, progress } = fixture();
    bridge.readLocalFolders.mockRejectedValueOnce(Error('local-library-unavailable'));
    await expect(rescanLocalFolders(bridge, [], controller.signal, progress)).rejects.toThrow('local-library-unavailable');
    expect(bridge.beginFolderImport).not.toHaveBeenCalled();
    bridge.readLocalFolders.mockResolvedValue({ revision: 'empty', roots: [] });
    expect(await rescanLocalFolders(bridge, [], controller.signal, progress)).toEqual({ total: 0, completed: [], status: 'complete' });
  });
});

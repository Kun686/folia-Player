import { describe, expect, it, vi } from 'vitest';
import { importLocalFolder } from '@/mobile/localFolderImport';
import { localFolderView, parentFolderScope } from '@/mobile/localFolderBrowser';
import type { NativeFolderCatalog } from '@/types/nativeFolder';
import type { SongResult } from '@/types';
import type { NativeFolderLyricFiles } from '@/mobile/nativeFolderLyrics';

// localFolderImport.test.ts — batch ordering, optional decoder errors, commit races and bounded directory projections.
const options = { token: 'test-token' };
function fixture(total = 2) {
  const progress = (completed: number) => ({ token: options.token, rootID: 'root', name: 'Music', completed, total, reused: 0 });
  const bridge = {
    beginFolderImport: vi.fn(async () => progress(0)),
    readFolderImport: vi.fn(async (): Promise<NativeFolderLyricFiles> => ({ lyric: { data: btoa('[00:00.00]Original'), fileName: 'song.lrc' } })),
    prepareFolderImport: vi.fn(async ({ index }: { index: number }) => progress(index + 1)),
    finishFolderImport: vi.fn(async () => ({ rootID: 'root', count: total, warnings: [] })),
    cancelFolderImport: vi.fn(async () => {}),
  };
  return { bridge, controller: new AbortController(), progress: vi.fn(), state: progress };
}
describe('folder import protocol', () => {
  it('decodes and stages one track at a time, then commits exactly once', async () => {
    const { bridge, controller, progress } = fixture();
    const result = await importLocalFolder(bridge, options, controller.signal, progress);
    expect(result?.count).toBe(2);
    expect(bridge.prepareFolderImport).toHaveBeenNthCalledWith(1, { token: options.token, index: 0, contents: { lyric: '[00:00.00]Original' }, skipped: [] });
    expect(bridge.readFolderImport.mock.invocationCallOrder[1]).toBeGreaterThan(bridge.prepareFolderImport.mock.invocationCallOrder[0]);
    expect(bridge.finishFolderImport).toHaveBeenCalledOnce(); expect(bridge.cancelFolderImport).not.toHaveBeenCalled();
    expect(progress.mock.calls.map(([value]) => value.completed)).toEqual([0, 1, 2]);
  });
  it('reports optional undecodable lyrics but still commits playable audio', async () => {
    const { bridge, controller, progress } = fixture(1);
    bridge.readFolderImport.mockResolvedValue({ lyric: { data: '%', fileName: 'song.lrc' } });
    await importLocalFolder(bridge, options, controller.signal, progress);
    expect(bridge.prepareFolderImport).toHaveBeenCalledWith({ token: options.token, index: 0, contents: {}, skipped: ['lyric'] });
    expect(bridge.finishFolderImport).toHaveBeenCalledOnce();
  });
  it('cancels native ownership and never commits after cancellation during a read', async () => {
    const { bridge, controller, progress } = fixture();
    bridge.readFolderImport.mockImplementation(async () => { controller.abort(); return {}; });
    await expect(importLocalFolder(bridge, options, controller.signal, progress)).rejects.toMatchObject({ name: 'AbortError' });
    expect(bridge.prepareFolderImport).not.toHaveBeenCalled(); expect(bridge.finishFolderImport).not.toHaveBeenCalled();
    expect(bridge.cancelFolderImport).toHaveBeenCalledWith(options);
  });
  it('rejects stale progress and discards stages after a bridge read error', async () => {
    for (const failure of ['read', 'token', 'index']) {
      const { bridge, controller, progress, state } = fixture();
      if (failure === 'read') bridge.readFolderImport.mockRejectedValue(new Error('folder-file-changed'));
      else bridge.prepareFolderImport.mockResolvedValue(failure === 'token' ? { ...state(1), token: 'old' } : state(2));
      await expect(importLocalFolder(bridge, options, controller.signal, progress)).rejects.toThrow();
      expect(bridge.finishFolderImport).not.toHaveBeenCalled(); expect(bridge.cancelFolderImport).toHaveBeenCalled();
    }
  });
  it('accepts an authoritative committed result if cancellation races final publication', async () => {
    const { bridge, controller, progress } = fixture(0);
    bridge.finishFolderImport.mockImplementation(async () => { controller.abort(); return { rootID: 'root', count: 0, warnings: [] }; });
    expect(await importLocalFolder(bridge, options, controller.signal, progress)).toMatchObject({ rootID: 'root', count: 0 });
  });
  it('always releases a system-picker cancellation and rejects malformed total counts', async () => {
    const { bridge, controller, progress } = fixture();
    const cancelled = { ...bridge, beginFolderImport: vi.fn(async () => ({ cancelled: true as const })) };
    expect(await importLocalFolder(cancelled, options, controller.signal, progress)).toBeNull();
    expect(bridge.readFolderImport).not.toHaveBeenCalled(); expect(bridge.cancelFolderImport).toHaveBeenCalledOnce();
    bridge.beginFolderImport.mockResolvedValue({ token: options.token, rootID: 'root', name: '', completed: 0, total: Infinity, reused: 0 });
    await expect(importLocalFolder(bridge, options, controller.signal, progress)).rejects.toThrow('folder-progress-changed');
  });
});
describe('folder scope projection', () => {
  const catalog: NativeFolderCatalog = { revision: '1', roots: [{ id: 'root', name: 'Music', ignoredPaths: ['Gone'], directories: [
    { path: 'A', ignored: false }, { path: 'AB', ignored: false }, { path: 'A/deep', ignored: false },
  ], tracks: [{ id: '1', path: 'A/one.wav' }, { id: '2', path: 'A/deep/two.wav' }, { id: '3', path: 'AB/three.wav' }] }] };
  const songs = [1, 2, 3].map(id => ({ id: String(id), sourceRef: { kind: 'local', mediaId: String(id) } } as SongResult));
  it('counts subtrees, excludes similarly prefixed siblings and resolves current songs', () => {
    const view = localFolderView(catalog, songs, { rootID: 'root', path: '' });
    expect(view.choices.map(item => [item.path, item.count, item.ignored])).toEqual([['A', 2, false], ['AB', 1, false], ['Gone', 0, true]]);
    const selected = localFolderView(catalog, songs.slice(1), { rootID: 'root', path: 'A' });
    expect(selected.songs.map(song => song.id)).toEqual(['2']); expect(selected.choices.map(item => item.path)).toEqual(['A/deep']);
    expect(localFolderView(catalog, songs, { rootID: 'missing', path: '' }).songs).toEqual([]);
    expect(parentFolderScope({ rootID: 'root', path: 'A/deep' })).toEqual({ rootID: 'root', path: 'A' });
    expect(parentFolderScope({ rootID: 'root', path: '' })).toBeNull();
  });
});

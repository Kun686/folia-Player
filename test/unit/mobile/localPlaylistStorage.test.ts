import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SongResult } from '../../../src/types';
import { MobilePlaylistDatabase, createMobilePlaylistStorage } from '../../../src/mobile/localPlaylistStorage';

// localPlaylistStorage.test.ts — real IndexedDB transactions, original normalization, and native identity boundaries.
const song = (id: string): SongResult => ({ id: 'display-' + id, name: id, artists: [], album: { id: '', name: '' },
  durationMs: 1000, sourceRef: { kind: 'local', mediaId: id } });
let db: MobilePlaylistDatabase;
let songs: SongResult[];
let catalog: ReturnType<typeof vi.fn<() => Promise<SongResult[]>>>;
let store: ReturnType<typeof createMobilePlaylistStorage>;
beforeEach(() => {
  db = new MobilePlaylistDatabase('playlist-test-' + crypto.randomUUID());
  songs = [song('a'), song('b'), song('c')];
  catalog = vi.fn(async () => songs);
  store = createMobilePlaylistStorage(db, catalog);
});
afterEach(async () => { vi.restoreAllMocks(); await db.delete(); });

describe('native local playlists', () => {
  it('creates once, deduplicates native IDs and survives closing/reopening the database', async () => {
    const created = await store.create(' Mix ', [songs[1], songs[0], songs[1]]);
    expect(created.name).toBe('Mix');
    expect(created.songIds).toEqual(['b', 'a']);
    db.close(); await db.open();
    const lists = await store.list();
    expect(lists.filter(list => list.isFavorite)).toHaveLength(1);
    expect(lists.find(list => list.id === created.id)?.songIds).toEqual(['b', 'a']);
  });
  it('concurrent clients keep every edit and only one favorites list', async () => {
    const other = createMobilePlaylistStorage(db, catalog);
    const [a, b] = await Promise.all([store.create('A'), other.create('B')]);
    await Promise.all([store.add(a.id, [songs[0]]), other.add(a.id, [songs[1]])]);
    const lists = await store.list();
    expect(lists.find(list => list.id === a.id)?.songIds).toEqual(['a', 'b']);
    expect(lists.some(list => list.id === b.id)).toBe(true);
    expect(lists.filter(list => list.isFavorite)).toHaveLength(1);
  });
  it('moves by identity, renames and removes membership without touching audio', async () => {
    const list = await store.create('List', songs);
    await store.move(list.id, 'c', -1);
    await store.remove(list.id, ['a']);
    await store.rename(list.id, 'New');
    expect((await store.list()).find(item => item.id === list.id)).toMatchObject({ name: 'New', songIds: ['c', 'b'] });
    expect(songs).toHaveLength(3);
    await store.delete(list.id);
    expect((await store.list()).some(item => item.id === list.id)).toBe(false);
  });
  it('favorites persist and cannot be deleted; removing an audio identity cleans every list', async () => {
    await store.favorite(songs[0], true);
    const list = await store.create('List', songs);
    const favorite = (await store.list()).find(item => item.isFavorite)!;
    await store.delete(favorite.id);
    expect((await store.list()).find(item => item.isFavorite)?.songIds).toEqual(['a']);
    songs = songs.slice(1);
    const lists = await store.list();
    expect(lists.find(item => item.isFavorite)?.songIds).toEqual([]);
    expect(lists.find(item => item.id === list.id)?.songIds).toEqual(['b', 'c']);
  });
  it('catalog failure preserves data and does not treat a failed read as an empty library', async () => {
    const list = await store.create('List', songs);
    const before = await db.lists.get('library');
    catalog.mockRejectedValueOnce(new Error('native-unavailable'));
    await expect(store.list()).rejects.toThrow('native-unavailable');
    expect(await db.lists.get('library')).toEqual(before);
    expect((await store.list()).find(item => item.id === list.id)?.songIds).toEqual(['a', 'b', 'c']);
  });
  it('serializes a delayed catalog read before a newer import and concurrent connection edit', async () => {
    const list = await store.create('List', songs);
    const otherDB = new MobilePlaylistDatabase(db.name);
    const other = createMobilePlaylistStorage(otherDB, async () => songs);
    let release!: (value: SongResult[]) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const previous = [...songs];
    catalog.mockImplementationOnce(() => { entered(); return new Promise(resolve => { release = resolve; }); });
    try {
      const oldRead = store.list();
      await started;
      songs = [...songs, song('new')];
      const addition = other.add(list.id, [songs[3]]);
      release(previous);
      await Promise.all([oldRead, addition]);
      expect((await store.list()).find(item => item.id === list.id)?.songIds).toEqual(['a', 'b', 'c', 'new']);
    } finally { otherDB.close(); }
  });
  it('a failed final write rolls back the initial favorites write and allows retry', async () => {
    const put = db.lists.put.bind(db.lists);
    const spy = vi.spyOn(db.lists, 'put').mockImplementationOnce(put).mockRejectedValueOnce(new Error('disk-full'));
    await expect(store.create('List', songs)).rejects.toThrow('disk-full');
    expect(await db.lists.count()).toBe(0);
    spy.mockRestore();
    await store.create('List', songs);
    expect(await store.list()).toHaveLength(2);
  });
  it('rejects unknown document versions without overwriting them, invalid names and missing destinations', async () => {
    expect(() => store.create('  ')).toThrow('invalid-playlist-name');
    expect(() => store.rename('absent', 'x'.repeat(257))).toThrow('invalid-playlist-name');
    await expect(store.rename('absent', 'Valid')).rejects.toThrow('playlist-missing');
    const future = { id: 'library', version: 2, playlists: [] };
    await db.lists.put(future as never);
    await expect(store.list()).rejects.toThrow('invalid-playlist-storage');
    expect(await db.lists.get('library')).toEqual(future);
  });
  it('keeps online tracks out of local lists and drops deleted IDs on save', async () => {
    const remote: SongResult = { ...song('remote'), sourceRef: { kind: 'online', providerId: 'qq', mediaId: 'a' } };
    const list = await store.create('Local only', [songs[0], remote]);
    expect(list.songIds).toEqual(['a']);
    await expect(store.favorite(remote, true)).rejects.toThrow('local-song-required');
    await expect(store.add('absent', songs)).rejects.toThrow('playlist-missing');
    await store.add(list.id, [song('removed')]);
    expect((await store.list()).find(item => item.id === list.id)?.songIds).toEqual(['a']);
  });
});

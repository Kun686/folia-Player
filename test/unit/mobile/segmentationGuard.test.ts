import 'fake-indexeddb/auto';
import { beforeEach, afterEach, expect, it } from 'vitest';
import { appDatabase } from '../../../src/services/appDatabase';
import { saveSongSegmentation, loadSongSegmentation } from '../../../src/services/lyricSegmentation';
import { createLyricSegmentationRecord } from '../../../src/utils/lyrics/lyricSegmentationRecord';
import type { SongResult } from '../../../src/types';

// segmentationGuard.test.ts — real transactions must roll back a late result while retaining existing user work.
const song: SongResult = { id: 42, name: 'Test', durationMs: 1000, artists: [], album: { id: 0, name: '' },
  sourceRef: { kind: 'online', providerId: 'qq', mediaId: '42' } };
const old = createLyricSegmentationRecord('online:qq:42', 'manual', { '0|第一句歌词': ['第一句', '歌词'] });
const next = createLyricSegmentationRecord('online:qq:42', 'ai', { '0|第一句歌词': ['第', '一句', '歌词'] });
beforeEach(async () => { await appDatabase.delete(); await appDatabase.open(); await saveSongSegmentation(song, old, { strict: true }); });
afterEach(async () => { await appDatabase.delete(); });
it('aborts a save when cancellation arrives while IndexedDB yields', async () => {
  let checks = 0;
  await expect(saveSongSegmentation(song, next, { isCurrent: () => ++checks === 1 })).rejects.toMatchObject({ name: 'AbortError' });
  expect(await loadSongSegmentation(song, { strict: true })).toEqual(old);
});
it('does not write already stale work and permits a later current result', async () => {
  await expect(saveSongSegmentation(song, next, { isCurrent: () => false })).rejects.toMatchObject({ name: 'AbortError' });
  expect(await loadSongSegmentation(song, { strict: true })).toEqual(old);
  await saveSongSegmentation(song, next, { isCurrent: () => true });
  expect(await loadSongSegmentation(song, { strict: true })).toEqual(next);
});

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { parseBlob } from 'music-metadata';
import type { TFunction } from 'i18next';
import type { SongResult } from '@/types';
import { projectMobileLocalSongs } from '@/mobile/localSongProjection';
import { sortMobileLocalTracks } from '@/mobile/localTrackSorting';
import { buildMobileLocalGroups } from '@/mobile/localLibraryGroups';
import { trackOrderJSON } from '@/utils/lyrics/nativeTrackOrder';
import { flacTags } from '@/utils/lyrics/nativeFlacRuntime';
import { CommonTagMapper } from '../../../node_modules/music-metadata/lib/common/GenericTagMapper.js';

// localTrackSorting.test.ts — original comparator, source identity and desktop numeric normalization.
const song = (id: string, name: string, trackNumber?: number, discNumber?: number) => ({
  id, name, importedFileName: name + '.m4a', trackNumber, discNumber,
  artists: [{ id: '', name: 'Artist' }], album: { id: '', name: 'Album', entityId: 'album-a' },
  durationMs: 180000, sourceRef: { kind: 'local' as const, mediaId: id },
});
const t = ((key: string) => key) as TFunction;
const golden: { cases: { extension: string; audioBase64: string; expected: { trackNumber: number; discNumber: number } }[] } =
  JSON.parse(readFileSync(new URL('../../../ios/App/NativeTests/LocalTrackOrderReference.json', import.meta.url), 'utf8'));
describe('local track metadata and ordering', () => {
  it.each(golden.cases)('real $extension tags match the desktop parser and native fixture', async sample => {
    const bytes = Buffer.from(sample.audioBase64, 'base64');
    const { common } = await parseBlob(new Blob([new Uint8Array(bytes)]));
    expect({ trackNumber: common.track.no, discNumber: common.disk.no }).toEqual(sample.expected);
    if (sample.extension === 'flac') {
      const result = await new Promise(resolve => flacTags(bytes.length,
        (position, length) => bytes.subarray(position, position + length).toString('base64'), text => resolve(JSON.parse(text))));
      expect(result).toEqual(sample.expected);
    }
  });
  it('preserves file identity, dates and disc/track fields in the native library projection', () => {
    const a = { ...song('a', 'same', 12, 2), fileLastModified: 1000, fileSize: 4096,
      folderRootID: 'root', folderRelativePath: 'A/same.m4a' };
    expect(projectMobileLocalSongs([a])[0]).toMatchObject({ id: 'a', trackNumber: 12, discNumber: 2,
      fileLastModified: 1000, fileSize: 4096, filePath: 'root/A/same.m4a' });
    const invalid = { ...a, trackNumber: NaN, discNumber: 0 };
    expect(projectMobileLocalSongs([invalid])[0]).toMatchObject({ trackNumber: undefined, discNumber: undefined });
  });
  it('album groups use disc then track before title and keep unnumbered tracks at the end', () => {
    const songs = [song('a', 'A', 2, 2), song('b', 'B'), song('c', 'Z', 10, 1), song('d', 'Y', 2, 1)];
    const sorted = buildMobileLocalGroups(songs, t).albums[0].songs;
    expect(sorted.map(s => s.id)).toEqual(['d', 'c', 'a', 'b']);
    expect(sorted[0]).toBe(songs[3]);
    expect(songs.map(s => s.id)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('file and modified ordering use natural ties without changing queue objects', () => {
    const songs = [{ ...song('a', 'Track 10'), fileLastModified: 1 }, { ...song('b', 'Track 2'), fileLastModified: 2 }];
    expect(sortMobileLocalTracks(songs, undefined, 'fileName', 'asc')).toEqual([songs[1], songs[0]]);
    expect(sortMobileLocalTracks(songs, undefined, 'fileLastModified', 'asc')).toEqual(songs);
    expect(sortMobileLocalTracks(songs, undefined, 'fileLastModified', 'desc')).toEqual([songs[1], songs[0]]);
  });
  it('album-number sorting follows renamed and same-named distinct entity groups; missing numbers remain last both ways', () => {
    const songs: SongResult[] = [song('a', 'A', 2), song('b', 'B', 1), song('c', 'C', 1), song('d', 'D')];
    songs[1].album = { id: '', name: 'Renamed', entityId: 'album-b' };
    songs[2].album = { id: '', name: 'Album', entityId: 'album-c' };
    expect(sortMobileLocalTracks(songs, undefined, 'albumTrack', 'asc').map(s => s.id)).toEqual(['a', 'c', 'b', 'd']);
    expect(sortMobileLocalTracks(songs, undefined, 'albumTrack', 'desc').map(s => s.id)).toEqual(['b', 'c', 'a', 'd']);
  });
  it.each(['02/12', '3', '0', '', '-1', ' 12 / 20', '3text'])('system text normalization matches original music-metadata: %s', value => {
    const result = JSON.parse(trackOrderJSON(JSON.stringify({ version: 1, tags: [{ field: 'trackNumber', format: 'text', value }] })));
    expect(result.trackNumber).toBe(CommonTagMapper.normalizeTrack(value).no ?? undefined);
  });
  it('iTunes conversion matches the installed parser and rejects malformed or excessive payloads', () => {
    const value = Buffer.from([0, 0, 1, 44, 0, 50, 0, 0]).toString('base64');
    expect(JSON.parse(trackOrderJSON(JSON.stringify({ version: 1, tags: [{ field: 'trackNumber', format: 'itunes', value }] })))).toEqual({ trackNumber: 44 });
    for (const tag of [{ field: 'bad', format: 'text', value: '1' }, { field: 'trackNumber', format: 'itunes', value: 'AA==' },
      { field: 'trackNumber', format: 'text', value: '9'.repeat(1025) }, { field: 'trackNumber', format: 'text', value: '999999999999999999' }])
      expect(() => trackOrderJSON(JSON.stringify({ version: 1, tags: [tag] }))).toThrow();
  });
});

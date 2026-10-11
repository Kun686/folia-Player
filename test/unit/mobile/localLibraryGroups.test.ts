import { describe, expect, it } from 'vitest';
import type { TFunction } from 'i18next';
import type { SongResult } from '../../../src/types';
import { buildMobileLocalGroups, filterMobileLocalSongs } from '../../../src/mobile/localLibraryGroups';

// localLibraryGroups.test.ts — native identities and selected metadata must survive the original home-model projection.
const t = ((key: string) => key === 'localMusic.unknownAlbum' ? 'Unknown album' : 'Unknown artist') as TFunction;
const track = (id: string, name: string, album = 'Album', artist = 'Artist'): SongResult => ({
  id, name, album: { id: '', name: album }, artists: [{ id: '', name: artist }], durationMs: 1000,
  sourceRef: { kind: 'local', mediaId: id },
});
describe('native local collection projection', () => {
  it('uses original natural album ordering and retains the exact native queue objects', () => {
    const songs = [track('10', 'Track 10'), track('2', 'Track 2'), track('1', 'Track 1')];
    const groups = buildMobileLocalGroups(songs, t);
    expect(groups.albums[0].songs.map(song => song.id)).toEqual(['1', '2', '10']);
    expect(groups.albums[0].songs[0]).toBe(songs[2]);
    expect(songs.map(song => song.id)).toEqual(['10', '2', '1']);
  });
  it('splits original slash and semicolon credits, deduplicates normalized names per song', () => {
    const groups = buildMobileLocalGroups([track('1', 'A', ' Album ', 'Ａlice / Bob；Alice'),
      track('2', 'B', 'Album', 'Alice')], t);
    expect(groups.albums).toHaveLength(1);
    expect(groups.artists.map(group => [group.name, group.songs.length])).toEqual([['Alice', 2], ['Bob', 1]]);
  });
  it('keeps unknown metadata separate from an artist or album literally named Unknown', () => {
    const groups = buildMobileLocalGroups([track('1', 'A', '', ''), track('2', 'B', 'Unknown album', 'Unknown artist')], t);
    expect(groups.albums).toHaveLength(2);
    expect(new Set(groups.albums.map(group => group.id)).size).toBe(2);
    expect(groups.artists).toHaveLength(2);
  });
  it('handles object property names and separator characters as literal user metadata', () => {
    const groups = buildMobileLocalGroups([track('1', 'A', '__proto__', 'constructor'), track('2', 'B', 'toString', '__proto__')], t);
    expect(groups.albums.map(group => group.name).sort()).toEqual(['__proto__', 'toString']);
    expect(groups.artists).toHaveLength(2);
  });
  it('excludes online tracks and deduplicates by native media identity', () => {
    const song = track('1', 'A');
    const groups = buildMobileLocalGroups([song, { ...song, id: 'other-display-id' }, {
      ...track('2', 'Online'), sourceRef: { kind: 'online', providerId: 'qq', mediaId: '2' },
    }], t);
    expect(groups.albums[0].songs).toEqual([song]);
  });
  it('keeps browse identity across reordering and removes obsolete groups after metadata edits', () => {
    const a = track('1', 'A', 'First'), b = track('2', 'B', 'Second');
    expect(buildMobileLocalGroups([a, b], t).albums.map(x => x.id))
      .toEqual(buildMobileLocalGroups([b, a], t).albums.map(x => x.id));
    expect(buildMobileLocalGroups([{ ...a, album: b.album }, b], t).albums.map(x => x.name)).toEqual(['Second']);
    expect(buildMobileLocalGroups([], t)).toEqual({ albums: [], artists: [] });
  });
  it('searches current title, artist and album with the shared Unicode normalization', () => {
    const songs = [track('1', 'Title', 'Ａlbum', 'Artist'), track('2', 'Other', 'Else', 'Someone')];
    expect(filterMobileLocalSongs(songs, ' album ')).toEqual([songs[0]]);
    expect(filterMobileLocalSongs(songs, 'ARTIST')).toEqual([songs[0]]);
    expect(filterMobileLocalSongs(songs, 'other')).toEqual([songs[1]]);
    expect(filterMobileLocalSongs(songs, 'absent')).toEqual([]);
    expect(filterMobileLocalSongs(songs, '')).toBe(songs);
  });
});

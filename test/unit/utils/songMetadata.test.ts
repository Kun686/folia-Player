import { describe, expect, it } from 'vitest';
import { createProviderSongMetadata, formatSongInfoText, getSongAlbumCoverUrl } from '../../../src/utils/songMetadata';

// Keeps provider-normalized album covers canonical.

describe('songMetadata', () => {
    it('preserves the original cover-panel copy format with multiple artists and a page link', () => {
        expect(formatSongInfoText('Song', { artists: [{ id: 1, name: 'A' }, { id: 2, name: 'B' }],
            album: { id: 3, name: 'Album' } }, 'https://music.163.com/#/song?id=42'))
            .toBe('Song - A, B - Album\nhttps://music.163.com/#/song?id=42');
    });

    it('preserves empty metadata and plain text without adding a missing link line', () => {
        expect(formatSongInfoText('<Song> & 曲名', { artists: [], album: { id: 0, name: '' } }))
            .toBe('<Song> & 曲名 -  - ');
    });

    it('reads the canonical album cover', () => {
        expect(getSongAlbumCoverUrl({ album: { id: 1, name: 'Album', coverUrl: 'canonical.jpg' } }))
            .toBe('canonical.jpg');
    });

    it('copies canonical cover fields into provider metadata', () => {
        const metadata = createProviderSongMetadata({
            id: 1,
            name: 'Song',
            artists: [{ id: 2, name: 'Artist' }],
            album: { id: 3, name: 'Album', coverUrl: 'qq.jpg' },
            durationMs: 1000,
        });

        expect(metadata.coverUrl).toBe('qq.jpg');
        expect(metadata.album.coverUrl).toBe('qq.jpg');
    });
});

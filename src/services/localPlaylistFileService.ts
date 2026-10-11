import type { LocalPlaylist, LocalSong } from '../types';
import { createSafeObjectUrl } from '../utils/blobGuards';
import { sanitizeDownloadFileName } from '../utils/downloadFileName';
import { createLocalPlaylist } from './localPlaylistService';
import { parseM3uPlaylist, getPlaylistNameFromFile, serializeLocalPlaylistToM3u8, type LocalPlaylistImportResult } from './localPlaylistM3u';
import { matchM3uPathsToLocalSongs } from './localPlaylistM3uPaths';

// src/services/localPlaylistFileService.ts
// Parses, matches, imports, and exports portable M3U playlists for the indexed local library.
// Desktop facade; mobile shares the pure format and matching rules.
export { parseM3uPlaylist, serializeLocalPlaylistToM3u8, type ParsedM3uPlaylist, type LocalPlaylistImportResult } from './localPlaylistM3u';
export { normalizeM3uPath, matchM3uPathsToLocalSongs } from './localPlaylistM3uPaths';

export const importLocalPlaylistFile = async (
    file: File,
    localSongs: LocalSong[],
): Promise<LocalPlaylistImportResult> => {
    const parsed = parseM3uPlaylist(await file.text());
    const matched = matchM3uPathsToLocalSongs(parsed.paths, localSongs);
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const matchedSongs = matched.matchedSongIds
        .map(songId => songsById.get(songId))
        .filter((song): song is LocalSong => Boolean(song));
    const playlist = matchedSongs.length > 0
        ? await createLocalPlaylist(parsed.name?.trim() || getPlaylistNameFromFile(file.name), matchedSongs)
        : null;

    return { playlist, ...matched };
};

export const downloadLocalPlaylistM3u8 = (playlist: LocalPlaylist, localSongs: LocalSong[]): void => {
    const content = serializeLocalPlaylistToM3u8(playlist, localSongs);
    const blob = new Blob([content], { type: 'application/vnd.apple.mpegurl;charset=utf-8' });
    const url = createSafeObjectUrl(blob);
    if (!url) throw new Error('Failed to create playlist download');

    const link = document.createElement('a');
    link.href = url;
    link.download = `${sanitizeDownloadFileName(playlist.name, 'playlist')}.m3u8`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
};

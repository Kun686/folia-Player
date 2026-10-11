import type { LocalPlaylist, LocalSong } from '../types';
import { normalizeM3uPath } from './localPlaylistM3uPaths';

// localPlaylistM3u.ts — original portable M3U text format, independent of desktop storage.
export interface ParsedM3uPlaylist {
    name?: string;
    paths: string[];
}

export interface LocalPlaylistImportResult {
    playlist: LocalPlaylist | null;
    matchedSongIds: string[];
    unmatchedPaths: string[];
    ambiguousPaths: string[];
}

const M3U_COMMENT_PREFIX = '#';
const M3U_PLAYLIST_NAME_PREFIX = '#PLAYLIST:';

const sanitizeM3uText = (value: string): string => value.replace(/[\r\n]+/g, ' ').trim();

export const parseM3uPlaylist = (text: string): ParsedM3uPlaylist => {
    let name: string | undefined;
    const paths: string[] = [];

    text.replace(/^\uFEFF/, '').split(/\r?\n/).forEach(rawLine => {
        const line = rawLine.trim();
        if (!line) return;
        if (line.toUpperCase().startsWith(M3U_PLAYLIST_NAME_PREFIX)) {
            const candidate = line.slice(M3U_PLAYLIST_NAME_PREFIX.length).trim();
            if (candidate) name = candidate;
            return;
        }
        if (!line.startsWith(M3U_COMMENT_PREFIX)) {
            paths.push(line);
        }
    });

    return { name, paths };
};

export const getPlaylistNameFromFile = (fileName: string): string => (
    fileName.replace(/\.m3u8?$/i, '').trim() || 'Imported Playlist'
);

const getExportPath = (song: LocalSong, sharedRoot: string | null): string => {
    const path = normalizeM3uPath(song.filePath) || song.filePath.replace(/\\/g, '/');
    return sharedRoot && path.startsWith(`${sharedRoot}/`)
        ? path.slice(sharedRoot.length + 1)
        : path;
};

export const serializeLocalPlaylistToM3u8 = (
    playlist: LocalPlaylist,
    localSongs: LocalSong[],
): string => {
    const songsById = new Map(localSongs.map(song => [song.id, song]));
    const songs = playlist.songIds
        .map(songId => songsById.get(songId))
        .filter((song): song is LocalSong => Boolean(song));
    const roots = new Set(songs.map(song => normalizeM3uPath(song.filePath)?.split('/')[0]).filter(Boolean));
    const sharedRoot = roots.size === 1 ? Array.from(roots)[0] || null : null;
    const lines = ['#EXTM3U', `#PLAYLIST:${sanitizeM3uText(playlist.name)}`];

    songs.forEach(song => {
        const onlineArtists = song.onlineMetadata?.artists.map(artist => artist.name).filter(Boolean) || [];
        const artists = onlineArtists.length > 0 ? onlineArtists : song.importedMetadata.artistNames;
        const displayName = sanitizeM3uText([artists.join(', '), song.title].filter(Boolean).join(' - '));
        lines.push(`#EXTINF:${Math.max(0, Math.round(song.duration / 1000))},${displayName}`);
        const path = getExportPath(song, sharedRoot).replace(/[\r\n]/g, char => encodeURIComponent(char));
        // A filename beginning with # is a track, not an M3U directive; newlines cannot create extra entries.
        lines.push(path.startsWith('#') ? `./${path}` : path);
    });

    return `${lines.join('\r\n')}\r\n`;
};


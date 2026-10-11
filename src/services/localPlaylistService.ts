import { getFromCache, getLocalSongs, saveToCache } from './db';
import { createLocalPlaylistService } from './localPlaylistStore';

// localPlaylistService.ts — preserve the desktop API and cache location; mobile injects its own transaction.
export { buildCanonicalLocalSongIdIndex, resolveCanonicalLocalSongId } from './localPlaylistIdentity';
export const canDeleteLocalPlaylist = (playlist: import('../types').LocalPlaylist | null | undefined): boolean =>
    Boolean(playlist && !playlist.isFavorite);
const service = createLocalPlaylistService(work => work({
    read: () => getFromCache('local_playlists'),
    write: playlists => saveToCache('local_playlists', playlists),
    songs: getLocalSongs,
}));
export const { getLocalPlaylists, saveLocalPlaylists, createLocalPlaylist, updateLocalPlaylist, deleteLocalPlaylist,
    addSongsToLocalPlaylist, removeSongsFromLocalPlaylist, reorderLocalPlaylistSongs,
    getFavoriteLocalPlaylist, setLocalSongFavorite } = service;

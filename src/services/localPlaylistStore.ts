import type { LocalPlaylist, LocalSong } from '../types';
import { buildDuplicateImportCanonicalSongIds, repairPlaylistSongIds, resolveCanonicalLocalSongId } from './localPlaylistIdentity';
import { createPlaylistId, dedupeSongIds, FAVORITE_PLAYLIST_NAME, normalizePlaylist, playlistNeedsNormalization,
    type LegacyLocalPlaylist } from './localPlaylistModel';

// localPlaylistStore.ts — original playlist behavior over an injected storage transaction, without a second catalog.
export interface LocalPlaylistStore {
    read(): Promise<unknown>;
    write(playlists: LocalPlaylist[]): Promise<void>;
    songs(): Promise<LocalSong[]>;
}
export type LocalPlaylistTransaction = <T>(work: (store: LocalPlaylistStore) => Promise<T>) => Promise<T>;

export function createLocalPlaylistService(transaction: LocalPlaylistTransaction) {
    const persist = (store: LocalPlaylistStore, playlists: LocalPlaylist[]) => store.write(playlists.map(normalizePlaylist));
    // Repair only against a successfully loaded catalog; a storage/catalog failure must propagate before any write.
    const load = async (store: LocalPlaylistStore): Promise<LocalPlaylist[]> => {
        const cached = await store.read();
        const records: LegacyLocalPlaylist[] = Array.isArray(cached) ? cached : [];
        const songs = await store.songs();
        const valid = new Map(songs.map(song => [song.id, song]));
        const canonical = buildDuplicateImportCanonicalSongIds(songs);
        let changed = records.some(playlistNeedsNormalization);
        const playlists = records.map(normalizePlaylist).map(playlist => {
            const repaired = repairPlaylistSongIds(playlist.songIds, valid, canonical);
            if (!repaired.changed) return playlist;
            changed = true;
            return { ...playlist, songIds: repaired.songIds };
        });
        if (!playlists.some(playlist => playlist.isFavorite)) {
            playlists.unshift({ id: createPlaylistId(), name: FAVORITE_PLAYLIST_NAME, songIds: [],
                createdAt: Date.now(), updatedAt: Date.now(), isFavorite: true });
            changed = true;
        }
        if (changed) await persist(store, playlists);
        return playlists;
    };
    const update = async (store: LocalPlaylistStore, id: string, updater: (playlist: LocalPlaylist) => LocalPlaylist) => {
        const playlists = await load(store);
        let result: LocalPlaylist | null = null;
        const next = playlists.map(playlist => {
            if (playlist.id !== id) return playlist;
            result = normalizePlaylist({ ...updater(playlist), updatedAt: Date.now() });
            return result;
        });
        if (result) await persist(store, next);
        return result;
    };
    const add = (store: LocalPlaylistStore, id: string, ids: string[]) => update(store, id, playlist => ({
        ...playlist, songIds: dedupeSongIds([...playlist.songIds, ...ids]),
    }));
    return {
        getLocalPlaylists: () => transaction(load),
        saveLocalPlaylists: (playlists: LocalPlaylist[]) => transaction(async store => {
            const normalized = playlists.map(normalizePlaylist);
            await persist(store, normalized);
            return normalized;
        }),
        createLocalPlaylist: (name: string, songs: LocalSong[] = []) => transaction(async store => {
            const playlists = await load(store), now = Date.now();
            const playlist: LocalPlaylist = { id: createPlaylistId(), name: name.trim(),
                songIds: dedupeSongIds(songs.map(song => song.id)), createdAt: now, updatedAt: now };
            await persist(store, [...playlists, playlist]);
            return playlist;
        }),
        updateLocalPlaylist: (id: string, updater: (playlist: LocalPlaylist) => LocalPlaylist) =>
            transaction(store => update(store, id, updater)),
        deleteLocalPlaylist: (id: string) => transaction(async store => {
            const playlists = await load(store), target = playlists.find(playlist => playlist.id === id);
            if (target && !target.isFavorite) await persist(store, playlists.filter(playlist => playlist.id !== id));
        }),
        addSongsToLocalPlaylist: (id: string, songs: LocalSong[]) => transaction(store => add(store, id, songs.map(song => song.id))),
        removeSongsFromLocalPlaylist: (id: string, ids: string[]) => transaction(store => {
            const removing = new Set(ids);
            return update(store, id, playlist => ({ ...playlist, songIds: playlist.songIds.filter(songId => !removing.has(songId)) }));
        }),
        reorderLocalPlaylistSongs: (id: string, ids: string[]) => transaction(store =>
            update(store, id, playlist => ({ ...playlist, songIds: dedupeSongIds(ids) }))),
        getFavoriteLocalPlaylist: () => transaction(async store => (await load(store)).find(playlist => playlist.isFavorite)!),
        setLocalSongFavorite: (song: LocalSong, shouldFavorite: boolean) => transaction(async store => {
            const favorite = (await load(store)).find(playlist => playlist.isFavorite)!;
            const id = resolveCanonicalLocalSongId(song.id, await store.songs());
            return update(store, favorite.id, playlist => ({ ...playlist, songIds: shouldFavorite
                ? dedupeSongIds([...playlist.songIds, id]) : playlist.songIds.filter(songId => songId !== id) }));
        }),
    };
}

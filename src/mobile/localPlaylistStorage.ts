import Dexie, { type Table } from 'dexie';
import type { LocalPlaylist, SongResult } from '../types';
import { createLocalPlaylistService } from '../services/localPlaylistStore';
import { projectMobileLocalSongs } from './localSongProjection';

// localPlaylistStorage.ts — user-authored lists are separate from disposable caches; writes share one IndexedDB transaction.
interface Record { id: string; version: 1; playlists: LocalPlaylist[] }
export class MobilePlaylistDatabase extends Dexie {
  lists!: Table<Record, string>;
  constructor(name = 'FoliaMobileLibrary') {
    super(name);
    this.version(1).stores({ lists: 'id' });
    this.on('versionchange', () => this.close());
  }
}

export function createMobilePlaylistStorage(database: MobilePlaylistDatabase, catalog: () => Promise<SongResult[]>) {
  const service = createLocalPlaylistService(work => database.transaction('rw!', database.lists, async () => {
    // Wait for IndexedDB to grant the write lock before starting the native snapshot.
    // A transaction callback can run while another connection still owns that lock.
    await database.lists.get('library');
    // Serialize the catalog snapshot with the edit: an older read must not prune a newer imported song.
    // Dexie's bounded keep-alive permits this short native call without IndexedDB auto-committing.
    const songs = projectMobileLocalSongs(await Dexie.waitFor(catalog(), 10_000));
    const validIds = new Set(songs.map(song => song.id));
    return work({
      songs: async () => songs,
      read: async () => {
        const record = await database.lists.get('library');
        if (!record) return null;
        if (record.version !== 1 || !Array.isArray(record.playlists) || record.playlists.some(playlist =>
          !playlist || typeof playlist.id !== 'string' || typeof playlist.name !== 'string'
          || !Array.isArray(playlist.songIds) || playlist.songIds.some(id => typeof id !== 'string'))) {
          throw new Error('invalid-playlist-storage');
        }
        return record.playlists;
      },
      write: async playlists => {
        await database.lists.put({ id: 'library', version: 1,
          playlists: playlists.map(playlist => ({ ...playlist, songIds: playlist.songIds.filter(id => validIds.has(id)) })) });
      },
    });
  }));
  const name = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed || trimmed.length > 256) throw new Error('invalid-playlist-name');
    return trimmed;
  };
  const required = async (work: Promise<LocalPlaylist | null>) => {
    const playlist = await work;
    if (!playlist) throw new Error('playlist-missing');
    return playlist;
  };
  return {
    list: service.getLocalPlaylists,
    create: (title: string, songs: SongResult[] = []) => service.createLocalPlaylist(name(title), projectMobileLocalSongs(songs)),
    rename: (id: string, title: string) => {
      const nextName = name(title);
      return required(service.updateLocalPlaylist(id, playlist => ({ ...playlist, name: nextName })));
    },
    delete: service.deleteLocalPlaylist,
    add: (id: string, songs: SongResult[]) => required(service.addSongsToLocalPlaylist(id, projectMobileLocalSongs(songs))),
    remove: (id: string, songIds: string[]) => required(service.removeSongsFromLocalPlaylist(id, songIds)),
    move: (id: string, songId: string, direction: -1 | 1) => required(service.updateLocalPlaylist(id, playlist => {
      const ids = [...playlist.songIds], index = ids.indexOf(songId), target = index + direction;
      if (index >= 0 && target >= 0 && target < ids.length) [ids[index], ids[target]] = [ids[target], ids[index]];
      return { ...playlist, songIds: ids };
    })),
    favorite: (song: SongResult, value: boolean) => {
      const local = projectMobileLocalSongs([song])[0];
      if (!local) return Promise.reject(new Error('local-song-required'));
      return required(service.setLocalSongFavorite(local, value));
    },
  };
}

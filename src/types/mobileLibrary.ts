import type { SongResult } from '../types';

// mobileLibrary.ts — native catalog collections with optional canonical editable entity identity.
export type MobileLocalSection = 'songs' | 'albums' | 'artists' | 'playlists';
export interface MobileLocalCollection {
  id: string;
  name: string;
  type: 'album' | 'artist' | 'playlist';
  playlistId?: string;
  entityId?: string;
  songs: SongResult[];
}

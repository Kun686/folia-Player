import type { SongResult } from '../types';

// mobileLibrary.ts — read-only native catalog projections; these IDs are not editable library entities.
export type MobileLocalSection = 'songs' | 'albums' | 'artists' | 'playlists';
export interface MobileLocalCollection {
  id: string;
  name: string;
  type: 'album' | 'artist' | 'playlist';
  playlistId?: string;
  songs: SongResult[];
}

import type { SubsonicResponse } from '../types/navidrome';

// nativeNavidrome.ts — public connection checkpoint; password is write-only and never restored into JavaScript.
export interface NativeNavidromeSettings {
  enabled: boolean; baseURL: string; username: string; hasPassword: boolean; scope: string; revision: number;
}
export interface NativeNavidromeSettingsEdit { enabled?: boolean; baseURL?: string; username?: string; password?: string }
export type NativeNavidromeOperation = 'ping' | 'getOpenSubsonicExtensions' | 'getUser' | 'getMusicFolders'
  | 'getLicense' | 'getAlbumList2' | 'getAlbum' | 'getPlaylists' | 'getPlaylist' | 'getRandomSongs'
  | 'getStarred2' | 'getArtists' | 'getArtist' | 'getSong' | 'getLyrics' | 'getLyricsBySongId' | 'search3';
export interface NativeNavidromeResponse {
  scope: string; revision: number; response: SubsonicResponse<Record<string, unknown>>;
}

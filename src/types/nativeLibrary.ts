import type { LocalLibraryArtistAssignmentMode, LocalLibraryAssignment, LocalLibraryAssignmentOrigin,
  LocalLibraryEntity, LocalLibrarySplitTarget } from './localLibrary';

// nativeLibrary.ts — versioned native-owned entity document; no audio, credentials, or WebView storage.
export interface NativeLibraryInput {
  songId: string;
  artistNames: string[];
  albumName?: string;
  origin: Extract<LocalLibraryAssignmentOrigin, 'import' | 'auto-match' | 'manual-match'>;
  metadataRevision: string;
  artistRevision?: string;
  albumRevision?: string;
  artistOrigin?: NativeLibraryInput['origin'];
  albumOrigin?: NativeLibraryInput['origin'];
}
export interface NativeLibraryRecord {
  version: 1;
  entities: LocalLibraryEntity[];
  assignments: LocalLibraryAssignment[];
  sources: Array<{ songId: string; key: string }>;
}
export type NativeLibraryOperation =
  | { type: 'rename'; entityId: string; displayName: string }
  | { type: 'merge'; entityId: string; sourceIds: string[] }
  | { type: 'split'; entityId: string; songIds: string[]; displayName: string }
  | { type: 'move'; entityId: string; songIds: string[]; targetId: string }
  | { type: 'artists'; entityId: string; songIds: string[]; targets: LocalLibrarySplitTarget[]; mode: LocalLibraryArtistAssignmentMode };

export interface NativeLibrarySnapshot {
  revision: string;
  entities: LocalLibraryEntity[];
  assignments: LocalLibraryAssignment[];
  songs: import('../types').SongResult[];
  editorSongs: import('../types').LocalSong[];
}

import type { fetchLyricsForMatchSource, searchLyricsByMatchSource } from '../utils/lyrics/lyricMatchSources';
import type { LocalSong, SongResult } from '../types';
import type { LocalSongLyrics } from '../utils/lyrics/localSongLyricsSelection';
import type { LocalLyricSnapshot } from '../utils/lyrics/localLyricSnapshot';
import type { LocalLibraryAssignment } from './localLibrary';
import type { ApplyLocalSongMatchSelectionInput, ApplyLocalSongMatchSelectionResult } from '../utils/localSongMatchSelection';

// localSongMatch.ts — original dialog input and replaceable persistence; native stores only mutable match fields.
export type LocalSongMatchTarget = Pick<LocalSong, 'id' | 'fileName' | 'title' | 'titleOrigin' | 'importedMetadata' |
  'onlineMetadata' | 'duration' | 'localCoverAssetId' | 'useOnlineCover' | 'matchedLyricsSource' |
  'matchedLyricsProviderPlatform'> & LocalSongLyrics;
export type LocalMatchDocument = Pick<LocalSong, 'title' | 'titleOrigin' | 'onlineMetadata' | 'useOnlineCover' |
  'noAutoMatch' | 'matchedLyrics' | 'matchedIsPureMusic' | 'matchedLyricsSongId' | 'matchedLyricsSource' |
  'matchedLyricsProviderPlatform' | 'hasManualLyricSelection'> & { artistNames: string[]; albumName?: string };
export interface LocalMatchSnapshot {
  contextToken?: string;
  sessionToken?: string;
  hasLocalCover?: boolean;
  libraryRevision?: string;
  assignment?: LocalLibraryAssignment;
  base: SongResult;
  fileName: string;
  lyrics: LocalLyricSnapshot;
  document?: LocalMatchDocument;
  embeddedCover?: string;
}
export interface LocalSongMatchStorage {
  isCurrent(): boolean;
  apply(input: ApplyLocalSongMatchSelectionInput): Promise<ApplyLocalSongMatchSelectionResult>;
  assignment(id: string): Promise<LocalLibraryAssignment | undefined>;
}

export interface LocalMatchRequests { search: typeof searchLyricsByMatchSource; fetch: typeof fetchLyricsForMatchSource }

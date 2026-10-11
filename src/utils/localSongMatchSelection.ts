import type { AmllDbPlatform, LocalSong, LyricData, LyricProviderSource } from '../types';
import type { LocalLibraryAssignmentOrigin } from '../types/localLibrary';
import type { OnlineMetadataCandidate } from '../services/onlineMetadataSearchService';
import { sourceProvidesSongMetadata } from './lyrics/matchResult';

// localSongMatchSelection.ts — original selection contract and patch rules, without browser persistence.
export type LocalSongMetadataSelection = 'online' | 'imported' | 'keep';
export type LocalSongCoverSelection = 'online' | 'embedded' | 'keep';
export type LocalSongLyricsSelection = 'online' | 'local' | 'embedded' | 'automatic' | 'keep';

export interface LocalSongOnlineLyricsSelection {
  lyrics: LyricData;
  songId: number | string;
  source: LyricProviderSource;
  providerPlatform?: AmllDbPlatform;
  isPureMusic: boolean;
}

export interface ApplyLocalSongMatchSelectionInput {
  songId: string;
  candidate?: OnlineMetadataCandidate;
  metadata: LocalSongMetadataSelection;
  cover: LocalSongCoverSelection;
  lyrics: LocalSongLyricsSelection;
  onlineLyrics?: LocalSongOnlineLyricsSelection;
  setNoAutoMatch?: boolean;
  lyricsFailed?: boolean;
  matchMode?: 'automatic' | 'manual';
  protectOrigins?: LocalLibraryAssignmentOrigin[];
}

export interface ApplyLocalSongMatchSelectionResult {
  coverAttempted: boolean;
  coverCached: boolean;
  lyricsApplied: boolean;
  partialLyricsFailure: boolean;
}

// 歌词匹配弹窗确认时，按来源和开关决定元数据与封面怎么处理。
// 不提供元数据的来源（AMLL）只写歌词：不传候选，元数据和封面保持原样，
// 否则别名会被当成多位歌手写进本地库，没有封面的候选还会清掉已缓存的在线封面。
export const resolveLyricMatchMetadataSelection = (
  source: LyricProviderSource,
  candidate: OnlineMetadataCandidate,
  toggles: { useOnlineMetadata: boolean; useOnlineCover: boolean },
): Pick<ApplyLocalSongMatchSelectionInput, 'candidate' | 'metadata' | 'cover'> => {
  if (!sourceProvidesSongMetadata(source)) {
    return { candidate: undefined, metadata: 'keep', cover: 'keep' };
  }
  return {
    candidate,
    metadata: toggles.useOnlineMetadata ? 'online' : 'imported',
    cover: toggles.useOnlineCover && candidate.coverUrl ? 'online' : 'embedded',
  };
};

export const buildLocalSongMatchPatch = (input: ApplyLocalSongMatchSelectionInput) => {
  const patch: Partial<LocalSong> = {};
  if (input.setNoAutoMatch !== undefined) patch.noAutoMatch = input.setNoAutoMatch;
  if (input.cover === 'online') {
    patch.useOnlineCover = Boolean(input.candidate?.coverUrl);
    if (input.candidate?.coverUrl && input.metadata === 'imported') {
      patch.onlineMetadata = {
        source: input.candidate.source,
        songId: input.candidate.songId,
        albumId: input.candidate.album?.id,
        title: input.candidate.title,
        artists: input.candidate.artists,
        album: input.candidate.album,
        coverUrl: input.candidate.coverUrl,
        matchMode: 'manual',
        matchedAt: Date.now(),
      };
    }
  }
  if (input.cover === 'embedded') patch.useOnlineCover = false;
  if (input.lyrics === 'online' && input.onlineLyrics) {
    patch.matchedLyrics = input.onlineLyrics.lyrics;
    patch.matchedIsPureMusic = input.onlineLyrics.isPureMusic;
    patch.matchedLyricsSongId = input.onlineLyrics.songId;
    patch.matchedLyricsSource = input.onlineLyrics.source;
    patch.matchedLyricsProviderPlatform = input.onlineLyrics.providerPlatform;
    patch.lyricsSource = 'online';
    patch.hasManualLyricSelection = true;
  } else if (input.lyrics === 'local' || input.lyrics === 'embedded') {
    patch.lyricsSource = input.lyrics;
    patch.hasManualLyricSelection = true;
  } else if (input.lyrics === 'automatic') {
    patch.lyricsSource = undefined;
    patch.hasManualLyricSelection = false;
  }
  return patch;
};

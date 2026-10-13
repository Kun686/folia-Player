import type { SongResult } from '../types';
import { getPlaybackSongKey, isLocalPlaybackSong, isNavidromePlaybackSong } from './appPlaybackGuards';

// queueSongReplacement.ts — original unavailable-song queue transform shared by desktop and native touch playback.
export function buildReplacementQueue(queue: SongResult[], original: SongResult, replacement: SongResult,
  unavailable: (song: SongResult) => boolean): SongResult[] {
  const next = (queue.length ? queue : [original]).flatMap(song => {
    if (isLocalPlaybackSong(song) || isNavidromePlaybackSong(song)) return [song];
    if (getPlaybackSongKey(song) === getPlaybackSongKey(original)) return [replacement];
    return unavailable(song) ? [] : [song];
  });
  if (!next.some(song => getPlaybackSongKey(song) === getPlaybackSongKey(replacement))) next.push(replacement);
  return next;
}

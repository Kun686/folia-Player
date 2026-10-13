import type { SongResult } from '../types';
import { omni } from '../services/onlineMusic/omni';
import { isSongUnavailable } from '../services/onlineMusic/songAvailability';
import { getPlaybackSourceRef, getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { native } from './bridge';
import { captureProviderSession, flushSessions } from './runtime';

// mobileSongReplacement.ts — same-provider original replacement lookup, with no playback until explicit confirmation.
export interface PreparedSongReplacement {
  originalSong: SongResult; replacementSong: SongResult; label?: string;
  queue: SongResult[]; queueRevision: number; current: () => boolean;
}
export async function prepareMobileSongReplacement(queue: SongResult[], index: number, providers: string[], current: () => boolean): Promise<PreparedSongReplacement | null> {
  const originalSong = queue[index];
  if (!originalSong) throw new Error('invalid-queue');
  if (!isSongUnavailable(originalSong)) return null;
  const source = getPlaybackSourceRef(originalSong);
  if (source.kind !== 'online' || !providers.includes(source.providerId)) throw new Error('replacement-unsupported');
  const session = captureProviderSession(source.providerId), valid = () => current() && session();
  const check = () => { if (!valid()) throw new Error('queue-changed'); };
  check(); await flushSessions(); check();
  const state = await native.getState(); check();
  const replacement = await omni.getSongReplacement(originalSong); check();
  if (!replacement || isSongUnavailable(replacement.song)) throw new Error('song-unavailable');
  const next = getPlaybackSourceRef(replacement.song);
  if (next.kind !== 'online' || next.providerId !== source.providerId || getPlaybackSongKey(originalSong) === getPlaybackSongKey(replacement.song)) {
    throw new Error('song-unavailable');
  }
  return { originalSong, replacementSong: replacement.song, label: replacement.label,
    queue: [...queue], queueRevision: state.queueRevision, current: valid };
}

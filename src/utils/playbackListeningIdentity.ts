import type { SongResult } from '../types';
import { neteaseListeningMediaId } from '../../shared/mobile/listeningIdentity';
import { getPlaybackSongKey, getPlaybackSourceRef } from './appPlaybackGuards';

// playbackListeningIdentity.ts — common desktop/native eligibility, independent of account storage.
/** Cloud uploads do not necessarily identify a real track in the provider's catalogue. */
export function resolveNeteaseListeningIdentity(song: SongResult | null) {
  if (!song) return null;
  const source = getPlaybackSourceRef(song);
  const mediaId = neteaseListeningMediaId(source);
  return mediaId ? { songKey: getPlaybackSongKey(song), mediaId } : null;
}

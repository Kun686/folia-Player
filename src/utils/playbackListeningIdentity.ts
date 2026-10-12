import type { SongResult } from '../types';
import { getPlaybackSongKey, getPlaybackSourceRef } from './appPlaybackGuards';

// playbackListeningIdentity.ts — common desktop/native eligibility, independent of account storage.
/** Cloud uploads do not necessarily identify a real track in the provider's catalogue. */
export function resolveNeteaseListeningIdentity(song: SongResult | null) {
  if (!song) return null;
  const source = getPlaybackSourceRef(song);
  if (source.kind !== 'online' || source.providerId !== 'netease' || source.variant === 'cloud') return null;
  if (!/^\d+$/.test(source.mediaId) || !Number.isSafeInteger(Number(source.mediaId)) || Number(source.mediaId) <= 0) return null;
  return { songKey: getPlaybackSongKey(song), mediaId: source.mediaId };
}

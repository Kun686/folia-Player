import type { SongResult } from '../../src/types';
import type { AudioQualityPreference, ProviderAudioSource } from '../../src/types/onlineMusic';
import type { ProviderRequest } from './playbackCommon.ts';
import { safePlaybackUrl } from './playbackCommon.ts';
import { toFiniteNumber } from '../../src/utils/replayGain.ts';

// shared/mobile/neteasePlayback.ts
export async function resolveNeteasePlayback(song: SongResult, quality: AudioQualityPreference, request: ProviderRequest): Promise<ProviderAudioSource | null> {
    const id = Number(song.sourceRef?.kind === 'online' ? song.sourceRef.mediaId : song.id);
    if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid NetEase song identity');
    const response = await request('song_url', { id, level: quality === 'high' ? 'exhigh' : quality });
    const raw = response?.data?.[0];
    const url = raw?.url && safePlaybackUrl(String(raw.url));
    if (!url) return null;
    const trackGain = toFiniteNumber(raw?.gain);
    return { url, fetchedAt: Date.now(), quality, ...(trackGain === undefined ? {} : { replayGain: { trackGain } }) };
}

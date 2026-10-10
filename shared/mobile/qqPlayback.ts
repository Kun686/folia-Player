import type { SongResult } from '../../src/types';
import type { AudioQualityPreference, ProviderAudioSource } from '../../src/types/onlineMusic';
import type { ProviderRequest } from './playbackCommon.ts';
import { safePlaybackUrl, isTerminalPlaybackError } from './playbackCommon.ts';

// shared/mobile/qqPlayback.ts
const QQ_QUALITY_FALLBACKS: Record<
    AudioQualityPreference,
    Array<{ apiQuality: '128' | '320' | 'flac'; resolvedQuality: AudioQualityPreference }>
> = {
    standard: [{ apiQuality: '128', resolvedQuality: 'standard' }],
    high: [
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
    lossless: [
        { apiQuality: 'flac', resolvedQuality: 'lossless' },
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
    // The current backend protocol exposes FLAC but no distinct Hi-Res tier.
    hires: [
        { apiQuality: 'flac', resolvedQuality: 'lossless' },
        { apiQuality: '320', resolvedQuality: 'high' },
        { apiQuality: '128', resolvedQuality: 'standard' },
    ],
};

const getQqSongMid = (song: SongResult): string => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    return String(song.qqMid || sourceRef?.providerData?.songMid || sourceRef?.mediaId || '').trim();
};

export const resolveQqPlayback = async (song: SongResult, quality: AudioQualityPreference, request: ProviderRequest): Promise<ProviderAudioSource | null> => {
    const songmid = getQqSongMid(song);
    if (!songmid) return null;
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'qq'
        ? song.sourceRef
        : undefined;
    const mediaId = String(sourceRef?.providerData?.mediaMid || '').trim();

    for (const candidate of QQ_QUALITY_FALLBACKS[quality]) {
        try {
            const response = await request('music_play', {
                songmid,
                ...(mediaId ? { mediaId } : {}),
                quality: candidate.apiQuality,
            });
            const direct = response?.data?.playUrl?.[songmid];
            const fallback = Object.values(response?.data?.playUrl ?? {})[0] as any;
            const url = safePlaybackUrl(String(direct?.url || fallback?.url || ''));
            if (url) {
                return {
                    url,
                    fetchedAt: Date.now(),
                    quality: candidate.resolvedQuality,
                };
            }
        } catch (error) {
            if (isTerminalPlaybackError(error)) throw error;
        }
    }
    return null;
};

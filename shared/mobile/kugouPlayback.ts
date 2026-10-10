import type { SongResult } from '../../src/types';
import type { AudioQualityPreference, ProviderAudioSource } from '../../src/types/onlineMusic';
import type { ProviderRequest } from './playbackCommon.ts';
import { dataOf, valueOf, isTerminalPlaybackError } from './playbackCommon.ts';
import { decibelsToLinearPeak, toFiniteNumber } from '../../src/utils/replayGain.ts';

// shared/mobile/kugouPlayback.ts
const audioUrlOf = (raw: unknown): string | undefined => {
    const values = Array.isArray(raw) ? raw : [raw];
    const candidates = values.flatMap(value => (
        typeof value === 'string' ? value.split(/,\s*(?=https?:\/\/)/i) : []
    ));

    return candidates.find(candidate => {
        try {
            const protocol = new URL(candidate.trim()).protocol;
            return protocol === 'http:' || protocol === 'https:';
        } catch {
            return false;
        }
    })?.trim();
};

const qualityValue = (quality: AudioQualityPreference): string => ({
    standard: '128', high: '320', lossless: 'flac', hires: 'high',
})[quality];

const QUALITY_FALLBACKS: Record<AudioQualityPreference, AudioQualityPreference[]> = {
    standard: ['standard'],
    high: ['high', 'standard'],
    lossless: ['lossless', 'high', 'standard'],
    hires: ['hires', 'lossless', 'high', 'standard'],
};

const qualityFallbacks = (quality: AudioQualityPreference): AudioQualityPreference[] => QUALITY_FALLBACKS[quality];

export async function resolveKugouPlayback(song: SongResult, quality: AudioQualityPreference, request: ProviderRequest, legacy?: (hash: string) => Promise<any>): Promise<ProviderAudioSource | null> {
    const sourceRef = song.sourceRef?.kind === 'online' ? song.sourceRef : null;
    const hash = String(sourceRef?.providerData?.hash || sourceRef?.mediaId || song.kgHash || song.id).toUpperCase();
    const qualities = sourceRef?.variant === 'cloud' ? [quality] : qualityFallbacks(quality);
    const albumId = String(sourceRef?.providerData?.albumId || '');
    const albumAudioId = String(sourceRef?.providerData?.albumAudioId || '');

    // Tries the preferred KuGou quality first and degrades until a playable URL is returned.
    for (const candidateQuality of qualities) {
        const requestVariants = sourceRef?.variant === 'cloud'
            ? [{ name: 'cloud', operation: 'user_cloud_url' as const, params: {
                hash, id: String(sourceRef.providerData?.fileId || ''),
            } }]
            : [
                { name: 'metadata', operation: 'song_url' as const, params: {
                    hash,
                    quality: qualityValue(candidateQuality),
                    album_id: albumId,
                    album_audio_id: albumAudioId,
                } },
                ...((albumId || albumAudioId) ? [{ name: 'hash-only', operation: 'song_url' as const, params: {
                    hash,
                    quality: qualityValue(candidateQuality),
                    album_id: '',
                    album_audio_id: '',
                } }] : []),
            ];

        // Search metadata can contain album IDs that do not belong to the returned hash, so retry the same quality by hash alone first.
        for (const requestVariant of requestVariants) {
            try {
                const response = await request(requestVariant.operation, requestVariant.params);
                const data = dataOf(response);
                const payload = Array.isArray(data) ? data[0] : data;
                const url = audioUrlOf(
                    valueOf(payload, 'play_url', 'playUrl', 'url')
                    ?? valueOf(data?.[0], 'url', 'play_url'),
                );
                if (url) {
                    const trackGain = toFiniteNumber(valueOf(payload, 'volume'));
                    const trackPeak = decibelsToLinearPeak(valueOf(payload, 'volume_peak'));
                    const replayGain = trackGain === undefined && trackPeak === undefined
                        ? undefined
                        : {
                            ...(trackGain === undefined ? {} : { trackGain }),
                            ...(trackPeak === undefined ? {} : { trackPeak }),
                        };
                    return {
                        // Preserve the upstream candidate here; the shared playback transport normalizes its scheme.
                        url,
                        fetchedAt: Date.now(),
                        quality: candidateQuality,
                        ...(replayGain ? { replayGain } : {}),
                    };
                }
            } catch (error) {
            if (isTerminalPlaybackError(error)) throw error;
            }
        }
    }

    // KuGou's current /song/url can mark certain hashes as unavailable (status: 3)
    // even though the same hash is still playable through the old mobile endpoint.
    // Only use this as a last resort after every quality and hash variant above has failed.
    if (legacy && sourceRef?.variant !== 'cloud') {
        try {
            const legacyResponse = await legacy(hash);
            const legacyUrl = audioUrlOf(valueOf(legacyResponse, 'url') ?? valueOf(dataOf(legacyResponse), 'url'))
                ?? audioUrlOf(valueOf(legacyResponse, 'backup_url') ?? valueOf(dataOf(legacyResponse), 'backup_url'));
            if (legacyUrl) {
                return {
                    url: legacyUrl,
                    fetchedAt: Date.now(),
                    quality: 'standard',
                };
            }
        } catch (error) {
            if (isTerminalPlaybackError(error)) throw error;
        }
    }
    return null;
}

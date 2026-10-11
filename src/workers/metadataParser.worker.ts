import { parseBlob } from 'music-metadata';
import { selectEmbeddedLyrics } from '../utils/lyrics/embeddedMetadataSelection';
import { repairFlacMetadata } from '../utils/flacMetadataRepair';
import { hasLegacyId3Tags, repairLatin1DecodedGbkText } from '../utils/legacyTagTextRepair';

interface EmbeddedMetadataResult {
    title?: string;
    artist?: string;
    artists?: string[];
    album?: string;
    trackNumber?: number;
    discNumber?: number;
    cover?: Blob;
    coverAssetId?: string;
    bitrate?: number;
    lyrics?: string;
    translationLyrics?: string;
    replayGain?: number;
    replayGainTrackGain?: number;
    replayGainTrackPeak?: number;
    replayGainAlbumGain?: number;
    replayGainAlbumPeak?: number;
    duration?: number;
}

const toHex = (bytes: Uint8Array): string => Array.from(bytes)
    .map(value => value.toString(16).padStart(2, '0'))
    .join('');

async function hashCoverBytes(bytes: BufferSource): Promise<string | undefined> {
    if (!crypto?.subtle) return undefined;
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return `sha256:${toHex(new Uint8Array(digest))}`;
}

function getDurationFromParsedMetadata(durationSeconds?: number): number {
    if (typeof durationSeconds !== 'number' || !isFinite(durationSeconds) || durationSeconds <= 0) {
        return 0;
    }

    return Math.round(durationSeconds * 1000);
}

async function extractEmbeddedMetadata(file: File, includeCover = false): Promise<EmbeddedMetadataResult> {
    const parsingInput = await repairFlacMetadata(file, includeCover);
    const parsed = await parseBlob(parsingInput, includeCover ? undefined : { skipCovers: true });

    const { lyrics: originalLyric, translationLyrics: translationLyric } = selectEmbeddedLyrics(parsed.common.lyrics || [], parsed.native || {});

    const replayGainTrackTag = parsed.common.replaygain_track_gain;
    const replayGainTrackPeakTag = parsed.common.replaygain_track_peak;
    const replayGainAlbumTag = parsed.common.replaygain_album_gain;
    const replayGainAlbumPeakTag = parsed.common.replaygain_album_peak;

    const replayGainTrackDb = typeof replayGainTrackTag?.dB === 'number'
        ? replayGainTrackTag.dB
        : parsed.format.trackGain;
    const replayGainTrackPeak = typeof replayGainTrackPeakTag?.ratio === 'number'
        ? replayGainTrackPeakTag.ratio
        : parsed.format.trackPeakLevel;
    const replayGainAlbumDb = typeof replayGainAlbumTag?.dB === 'number'
        ? replayGainAlbumTag.dB
        : parsed.format.albumGain;
    const replayGainAlbumPeak = typeof replayGainAlbumPeakTag?.ratio === 'number'
        ? replayGainAlbumPeakTag.ratio
        : undefined;

    const picture = includeCover ? parsed.common.picture?.[0] : undefined;
    const cover = picture
        ? new Blob([picture.data as any], { type: picture.format })
        : undefined;
    const coverAssetId = picture ? await hashCoverBytes(Uint8Array.from(picture.data)) : undefined;

    const repairTagText = hasLegacyId3Tags(parsed.format.tagTypes)
        ? (text: string | undefined) => (text ? repairLatin1DecodedGbkText(text) : text)
        : (text: string | undefined) => text;

    return {
        title: repairTagText(parsed.common.title),
        artist: repairTagText(parsed.common.artist),
        artists: parsed.common.artists?.map(artist => repairTagText(artist) ?? artist),
        album: repairTagText(parsed.common.album),
        trackNumber: parsed.common.track.no ?? undefined,
        discNumber: parsed.common.disk.no ?? undefined,
        cover,
        coverAssetId,
        bitrate: parsed.format.bitrate,
        lyrics: originalLyric,
        translationLyrics: translationLyric,
        replayGain: replayGainTrackDb,
        replayGainTrackGain: replayGainTrackDb,
        replayGainTrackPeak,
        replayGainAlbumGain: replayGainAlbumDb,
        replayGainAlbumPeak,
        duration: getDurationFromParsedMetadata(parsed.format.duration)
    };
}

self.onmessage = async (e: MessageEvent) => {
    const { type, file, cover, includeCover, requestId } = e.data as {
        type: string;
        file?: File;
        cover?: Blob;
        includeCover?: boolean;
        requestId: string;
    };

    if (type !== 'parse-metadata' && type !== 'hash-cover') {
        self.postMessage({ type: 'error', message: 'Unknown message type', requestId });
        return;
    }

    try {
        if (type === 'hash-cover') {
            if (!(cover instanceof Blob) || cover.size === 0 || !cover.type.startsWith('image/')) {
                throw new Error('Invalid local cover payload');
            }
            const coverAssetId = await hashCoverBytes(await cover.arrayBuffer());
            if (!coverAssetId) throw new Error('Web Crypto SHA-256 is unavailable');
            self.postMessage({ type: 'result', data: { cover, coverAssetId }, requestId });
            return;
        }

        if (!(file instanceof File)) throw new Error('Missing metadata file');
        const data = await extractEmbeddedMetadata(file, Boolean(includeCover));
        self.postMessage({ type: 'result', data, requestId });
    } catch (err) {
        self.postMessage({ type: 'error', message: String(err), requestId });
    }
};

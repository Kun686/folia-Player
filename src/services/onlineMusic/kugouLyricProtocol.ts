import type { SongResult } from '../../types';
import type { ChorusRange, MediaId } from '../../types/onlineMusic';
import type { KugouOperation, KugouParams } from './kugouTransport';
import { parseLyricsByFormat } from '../../utils/lyrics/parserCore';
import { isPureMusicLyricText } from '../../utils/lyrics/pureMusic';
import { hasRenderableLyrics } from '../../utils/lyrics/validity';

// kugouLyricProtocol.ts — original candidate, decoded KRC and chorus flow with host-owned I/O.
export function createKugouLyricLoader(
    requestKugou: (operation: KugouOperation, params: KugouParams) => Promise<any>,
    getKugouChorusRanges: (songId: MediaId) => Promise<ChorusRange[]>,
) {
const getKugouLyricCandidate = async (song: SongResult): Promise<any | null> => {
    const sourceRef = song.sourceRef?.kind === 'online' && song.sourceRef.providerId === 'kugou'
        ? song.sourceRef
        : null;
    const albumAudioId = sourceRef?.providerData?.albumAudioId
        ?? sourceRef?.providerData?.mixSongId
        ?? sourceRef?.providerData?.catalogLookupId;
    const response = await requestKugou('search_lyric', {
        hash: String(song.kgHash ?? song.id).toUpperCase(),
        duration: song.durationMs,
        man: 'no',
        ...(albumAudioId !== undefined ? { album_audio_id: String(albumAudioId) } : {}),
    });
    const candidates = (response as any)?.candidates;
    return Array.isArray(candidates) ? candidates[0] ?? null : null;
};

// Fetches the server-decoded KRC payload exposed by the current KuGou provider API.
const getKugouLyrics = async (song: SongResult) => {
    const candidate = await getKugouLyricCandidate(song);
    if (!candidate?.id || !candidate?.accesskey) {
        return { lyrics: null, isPureMusic: false, chorusRanges: [] };
    }

    const response = await requestKugou('lyric', {
        id: String(candidate.id),
        accesskey: String(candidate.accesskey),
        fmt: 'krc',
        decode: true,
    });
    const lyricText = typeof (response as any)?.decodeContent === 'string'
        ? (response as any).decodeContent
        : '';
    if (isPureMusicLyricText(lyricText)) {
        return { lyrics: null, mainText: lyricText, wordByWordText: lyricText, isPureMusic: true, chorusRanges: [] };
    }
    const parsed = lyricText ? parseLyricsByFormat('krc', lyricText, '') : null;
    if (!hasRenderableLyrics(parsed)) {
        return { lyrics: null, mainText: lyricText || null, wordByWordText: lyricText || null, isPureMusic: false, chorusRanges: [] };
    }
    parsed.isWordByWord = true;
    const songId = song.kgHash ?? song.id;
    return {
        lyrics: parsed,
        mainText: lyricText,
        wordByWordText: lyricText,
        isPureMusic: false,
        chorusRanges: await getKugouChorusRanges(songId),
    };
};

    return getKugouLyrics;
}

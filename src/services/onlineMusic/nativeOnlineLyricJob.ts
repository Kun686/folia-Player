import type { SongResult, OnlineLyricsState } from '../../types';
import type { AutoMatchLyricPorts, AutoMatchBestLyricOptions } from '../../utils/lyrics/autoMatchBestLyricTypes';
import { createAutoMatchBestLyric } from '../../utils/lyrics/autoMatchBestLyricCore';
import { automaticOnlineLyricSelection } from '../../utils/onlineLyricsSelection';
import { cacheJSON } from '../../utils/lyrics/nativeCacheRuntime';

// nativeOnlineLyricJob.ts — deliver the owner's baseline before the original optional cross-source search.
export async function runOnlineLyricJob(input: {
    song: SongResult; title: string; artist: string; durationMs: number;
    autoUseBestLyric: boolean; options: AutoMatchBestLyricOptions;
}, ports: AutoMatchLyricPorts, baseline: (document: Record<string, unknown>) => void): Promise<{ state: OnlineLyricsState | null }> {
    const song = input.song, ref = song?.sourceRef;
    if (ref?.kind !== 'online' || !['netease', 'qq', 'kugou'].includes(ref.providerId)
        || typeof input.autoUseBestLyric !== 'boolean') throw new Error('invalid-lyric-job');
    const provider = ref.providerId as 'netease' | 'qq' | 'kugou';
    const lyricsResult = provider === 'qq'
        ? { lyrics: await ports.fetchQQ(song, {}), isPureMusic: false }
        : await ports.getLyrics(provider, song);
    if (!lyricsResult) throw new Error('lyric-unavailable');
    const document = JSON.parse(cacheJSON(JSON.stringify({ version: 1, payload: { lyrics: lyricsResult.lyrics } })));
    baseline(document);
    if (!input.autoUseBestLyric) return { state: null };
    const bestMatch = await createAutoMatchBestLyric(ports)(input.title, input.artist, input.durationMs, {
        ...input.options, providerCandidate: { providerId: provider, song, lyricsResult },
    });
    const state = automaticOnlineLyricSelection(null, provider, bestMatch);
    return { state: state ? JSON.parse(cacheJSON(JSON.stringify({ version: 1, payload: { state } }))).payload.state : null };
}

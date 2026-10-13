import { runOnlineLyricJob } from './nativeOnlineLyricJob';
import { Buffer } from 'buffer';
import { createAutoMatchBestLyric } from '../../utils/lyrics/autoMatchBestLyricCore';
import type { AutoMatchBestLyricOptions, AutoMatchBestLyricResult } from '../../utils/lyrics/autoMatchBestLyricTypes';
import { validateNativeLyricData } from '../../utils/lyrics/nativeCacheRuntime';
import { nativeLyricPorts } from './nativeLyricPorts';
import { NativeLyricRequests } from './nativeLyricRequests';

// nativeLyricMatchRuntime.ts — one isolated async matcher per native job; sessions live only in this job's memory.
export const protocolVersion = 1;
export function createJobJSON(text: string, inflate: (base64: string) => string | null) {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 3_000_000) throw new Error('invalid-lyric-job');
    const input = JSON.parse(text), options = (input.options ?? {}) as AutoMatchBestLyricOptions;
    const sessions = input.sessions ?? {};
    if (!sessions || typeof sessions !== 'object' || Array.isArray(sessions)
        || Object.keys(sessions).some(key => !['qq', 'netease', 'kugou'].includes(key))
        || Object.values(sessions).some((session: any) => !session || typeof session !== 'object' || Array.isArray(session)
            || Object.keys(session).length > 16 || Object.values(session).some(value => typeof value !== 'string' || value.length > 24000))) {
        throw new Error('invalid-session');
    }
    if (input.version !== 1 || typeof input.title !== 'string' || input.title.length > 1024
        || typeof input.artist !== 'string' || input.artist.length > 4096
        || !Number.isFinite(input.durationMs) || input.durationMs < 0 || input.durationMs > 86_400_000
        || (options.preferredSource != null && !['qq', 'netease', 'kugou', 'amll'].includes(options.preferredSource))
        || (options.album != null && (typeof options.album !== 'string' || options.album.length > 1024))) throw new Error('invalid-lyric-job');
    if (options.providerCandidate) {
        if (!['qq', 'netease', 'kugou'].includes(options.providerCandidate.providerId)
            || !options.providerCandidate.song || !options.providerCandidate.lyricsResult) throw new Error('invalid-lyric-job');
        options.providerCandidate.lyricsResult.lyrics = validateNativeLyricData(options.providerCandidate.lyricsResult.lyrics);
    }
    const requests = new NativeLyricRequests();
    let done = false, error: string | undefined, result: unknown = null;
    let updates: Record<string, unknown>[] = [];
    const finish = (value: AutoMatchBestLyricResult | Awaited<ReturnType<typeof runOnlineLyricJob>>) => {
        if (done) return;
        if (value && 'lyrics' in value) value.lyrics = validateNativeLyricData(value.lyrics)!;
        result = value; done = true; requests.stop();
    };
    const ports = nativeLyricPorts(requests, inflate, sessions);
    const operation = input.song
        ? runOnlineLyricJob({ ...input, options }, ports, document => { if (!done) updates.push(document); })
        : createAutoMatchBestLyric(ports)(input.title, input.artist, input.durationMs, options);
    operation.then(finish).catch(() => { if (!done) { error = 'lyric-match-failed'; done = true; requests.stop(); } });
    return {
        // The host drains after each reply; no polling, background JS timer or detached WebView is needed.
        stateJSON() { const pending = updates; updates = []; return JSON.stringify({ done, error, result, updates: pending, events: requests.drain() }); },
        replyJSON(reply: string) { requests.reply(reply); },
        cancel() { if (!done) { done = true; error = 'cancelled'; requests.stop(); } },
    };
}

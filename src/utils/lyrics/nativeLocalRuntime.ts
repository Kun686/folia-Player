import { Buffer } from 'buffer';
import { prepareLocalLyrics } from './localPreparation';
import { parseLyricsByFormat } from './parserCore';
import { resolveExplicitFileTimedLyricFormat } from './formatDetection';
import type { LyricData } from '../../types';
import { prepareEmbeddedLyrics } from './embeddedPreparation';
import { localLyricsFromSnapshot } from './localLyricSnapshot';
import { selectLocalSongLyricsSource } from './localSongLyricsSelection';

// nativeLocalRuntime.ts — original parsers on JavaScriptCore; only planner fields leave this host.
// This entry runs in its own native context. The original AWLRC/KRC decoders use Buffer when present.
// Browsers keep their existing Worker entry; Node tests retain their existing global.
if (typeof globalThis.Buffer === 'undefined') globalThis.Buffer = Buffer;
export const protocolVersion = 1;
export function sourcesJSON(text: string): string {
    if (typeof text !== 'string' || text.length > 24_300_000) throw new Error('invalid-local-lyrics');
    const raw = JSON.parse(text);
    if (raw?.version !== 1 || !raw.snapshot) throw new Error('invalid-local-lyrics');
    const snapshot = raw.snapshot;
    for (const key of ['content', 'embeddedContent']) {
        if (snapshot[key] !== undefined && (typeof snapshot[key] !== 'string' || snapshot[key].length > 2_000_000)) throw new Error('invalid-local-lyrics');
    }
    if (snapshot.fileName !== undefined && (typeof snapshot.fileName !== 'string' || snapshot.fileName.length > 1024)) throw new Error('invalid-local-lyrics');
    if (snapshot.lyricsSource !== undefined && !['local', 'embedded'].includes(snapshot.lyricsSource)) throw new Error('invalid-local-lyrics');
    const song = localLyricsFromSnapshot(snapshot), source = selectLocalSongLyricsSource(song, 'local');
    if (source === 'local') return parseJSON(JSON.stringify({ version: 1, content: snapshot.content, fileName: snapshot.fileName }));
    if (source !== 'embedded') return 'null';
    const args = prepareEmbeddedLyrics({ type: 'embedded', textContent: snapshot.embeddedContent });
    return plannerLinesJSON(args ? parseLyricsByFormat(...args) : null);
}
export function parseJSON(text: string): string {
    const invalid = () => { throw new Error('invalid-local-lyrics'); };
    if (typeof text !== 'string' || text.length > 12_100_000) invalid();
    const request = JSON.parse(text);
    if (!request || request.version !== protocolVersion || typeof request.content !== 'string'
        || request.content.length > 2_000_000
        || (request.fileName !== undefined && (typeof request.fileName !== 'string' || request.fileName.length > 1024))) invalid();
    const prepared = prepareLocalLyrics({ type: 'local', lrcContent: request.content,
        formatHint: resolveExplicitFileTimedLyricFormat(request.fileName) });
    const lyrics = prepared.kind === 'parsed' ? prepared.lyrics : parseLyricsByFormat(...prepared.args);
    return plannerLinesJSON(lyrics);
}

export function plannerLinesJSON(lyrics: LyricData | null): string {
    const invalid = () => { throw new Error('invalid-local-lyrics'); };
    if (!lyrics) return 'null';
    if (lyrics.lines.length > 2000) invalid();
    // The original planner reads these three fields. Words stay in the visual lyric parser,
    // so syllable/ruby/background-vocal trees never burden the native scheduling actor.
    const lines = lyrics.lines.map(line => {
        if (!Number.isFinite(line.startTime) || !Number.isFinite(line.endTime)
            || typeof line.fullText !== 'string' || line.fullText.length > 4096) invalid();
        return { startTime: line.startTime, endTime: line.endTime, fullText: line.fullText, words: [] };
    });
    const result = JSON.stringify(lines);
    if (result.length > 262144) invalid();
    return result;
}

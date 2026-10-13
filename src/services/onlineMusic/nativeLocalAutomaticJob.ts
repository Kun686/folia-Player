import { createProviderSongMetadata } from '../../utils/songMetadata';
import { createAutoMatchBestLyric } from '../../utils/lyrics/autoMatchBestLyricCore';
import type { AutoMatchLyricPorts } from '../../utils/lyrics/autoMatchBestLyricTypes';
import { matchLocalLyrics } from '../localAutomaticMatch';
import type { LocalAutomaticInput } from '../../utils/lyrics/localSongMatchContext';
import type { LocalAutomaticDecision } from './nativeLocalAutomaticMatch';

// nativeLocalAutomaticJob.ts — original matching policy runs only in the short-lived network job VM.
export async function runLocalAutomaticJob(input: LocalAutomaticInput, ports: AutoMatchLyricPorts): Promise<LocalAutomaticDecision | null> {
    if (!input?.context || !input.settings || !['local', 'online'].includes(input.settings.localLyricsPriority)
        || typeof input.settings.autoUseBestLyric !== 'boolean'
        || !['qq', 'netease', 'kugou', 'amll'].includes(input.settings.preferredAlternativeLyricSource ?? '')
        || ['hasFileLyrics', 'hasLocalCover', 'pureMusic', 'refreshFromMetadata'].some(key => typeof input[key as keyof LocalAutomaticInput] !== 'boolean')) {
        throw new Error('invalid-local-match');
    }
    const { context } = input, candidate = context.metadataCandidate;
    if (typeof context.title !== 'string' || context.title.length > 1024
        || typeof context.artist !== 'string' || context.artist.length > 4096
        || typeof context.album !== 'string' || context.album.length > 1024
        || !Number.isFinite(context.durationMs) || context.durationMs < 0 || context.durationMs > 86_400_000
        || (candidate && (!['netease', 'qq', 'kugou'].includes(candidate.source)
            || !['number', 'string'].includes(typeof candidate.songId) || String(candidate.songId).length > 128))) {
        throw new Error('invalid-local-match');
    }
    let decision: LocalAutomaticDecision | null = null;
    await matchLocalLyrics(input, {
        metadata: createProviderSongMetadata,
        match: createAutoMatchBestLyric(ports), search: (query, limit, offset) => ports.searchSongs('netease', query, limit, offset),
        lyrics: song => ports.getLyrics('netease', song),
        save: async (metadata, options) => {
            decision = { metadata, options, clearedFields: Object.keys(options.songPatch).filter(key =>
                options.songPatch[key as keyof typeof options.songPatch] === undefined) };
        },
    });
    return decision;
}


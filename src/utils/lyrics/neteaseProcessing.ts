export { parseNeteaseChorusRanges } from './neteaseChorus';
import { LyricData } from '../../types';
import type { NeteaseChorusRange } from './chorusEffects';
import { prepareNeteaseLyrics, type ExtractedNeteaseLyricPayload } from './neteasePayload';
export { extractNeteaseLyricPayload } from './neteasePayload';
export type { ExtractedNeteaseLyricPayload } from './neteasePayload';
import type { LyricProcessingOptions, RawNeteaseLyric } from './types';
import { parseLyricsAsync } from './workerClient';

export interface ProcessedNeteaseLyricsResult extends ExtractedNeteaseLyricPayload {
    lyrics: LyricData | null;
    chorusRanges?: NeteaseChorusRange[];
}

export const clearNeteaseChorusRangesCache = (): void => {
    // Kept as a compatibility no-op; chorus range caching is owned by the provider.
};

export const processNeteaseLyrics = async (
    source?: RawNeteaseLyric | null,
    options: LyricProcessingOptions = {}
): Promise<ProcessedNeteaseLyricsResult> => {
    const { payload, args } = prepareNeteaseLyrics(source, options);

    if (!args) {
        return {
            ...payload,
            lyrics: null,
            chorusRanges: []
        };
    }

    let lyrics = await parseLyricsAsync(...args);

    if (lyrics) {
        lyrics.isWordByWord = !!payload.yrcLrc;
    }

    return {
        ...payload,
        lyrics,
        chorusRanges: [],
    };
};

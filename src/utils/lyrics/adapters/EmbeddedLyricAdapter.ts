import { LyricData } from '../../../types';
import { LyricAdapter } from '../LyricAdapter';
import { LyricProcessingOptions, RawEmbeddedLyric } from '../types';
import { parseLyricsAsync } from '../workerClient';
import { prepareEmbeddedLyrics } from '../embeddedPreparation';

// EmbeddedLyricAdapter.ts — original preparation with the existing browser Worker transport.

export class EmbeddedLyricAdapter implements LyricAdapter<RawEmbeddedLyric> {
    async parse(source: RawEmbeddedLyric, options: LyricProcessingOptions = {}): Promise<LyricData | null> {
        const args = prepareEmbeddedLyrics(source, options);
        return args ? await parseLyricsAsync(...args) : null;
    }
}

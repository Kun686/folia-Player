import type { LyricData } from '../../../types';
import type { LyricAdapter } from '../LyricAdapter';
import type { LyricProcessingOptions, RawNavidromeLyric } from '../types';
import { parseLyricsAsync } from '../workerClient';
import { parseNavidromeLyrics } from './navidromeParsing';

// Navidrome v0.63+ exposes precise word timing through OpenSubsonic songLyrics v2 cue lines.
export class NavidromeLyricAdapter implements LyricAdapter<RawNavidromeLyric> {
    async parse(source: RawNavidromeLyric, options: LyricProcessingOptions = {}): Promise<LyricData | null> {
        return parseNavidromeLyrics(source, options, parseLyricsAsync);
    }
}

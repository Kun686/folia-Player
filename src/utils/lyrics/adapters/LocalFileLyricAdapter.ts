import { LyricData } from '../../../types';
import { LyricAdapter } from '../LyricAdapter';
import { LyricProcessingOptions, RawLocalFileLyric } from '../types';
import { parseLyricsAsync } from '../workerClient';
import { prepareLocalLyrics } from '../localPreparation';

// LocalFileLyricAdapter.ts — the shared preparation keeps the existing worker-backed frontend parser.
export class LocalFileLyricAdapter implements LyricAdapter<RawLocalFileLyric> {
    async parse(source: RawLocalFileLyric, options: LyricProcessingOptions = {}): Promise<LyricData | null> {
        const prepared = prepareLocalLyrics(source, options);
        return prepared.kind === 'parsed' ? prepared.lyrics : await parseLyricsAsync(...prepared.args);
    }
}

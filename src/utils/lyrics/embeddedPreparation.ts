import type { LyricProcessingOptions, RawEmbeddedLyric } from './types';
import type { parseLyricsAsync } from './workerClient';
import { detectTimedLyricFormat } from './formatDetection';
import { normalizeEmbeddedLrcText, normalizeEmbeddedUsltTags } from './embeddedLrcNormalization';
import { extractAwlrcContainer } from './awlrcContainer';

// embeddedPreparation.ts — original embedded-tag normalization and AWLRC precedence for both hosts.
export function prepareEmbeddedLyrics(source: RawEmbeddedLyric, options: LyricProcessingOptions = {}): Parameters<typeof parseLyricsAsync> | null {
    let mainLrc = '';
    let transLrc = '';
    let romanizationLrc = '';

    if (source.usltTags && source.usltTags.length > 0) {
        const normalized = normalizeEmbeddedUsltTags(source.usltTags);
        mainLrc = normalized.mainText;
        transLrc = normalized.translationText;
        romanizationLrc = normalized.romanizationText || '';
    } else if (source.textContent) {
        const normalized = normalizeEmbeddedLrcText(source.textContent, source.translationContent);
        mainLrc = normalized.mainText;
        transLrc = normalized.translationText;
        romanizationLrc = normalized.romanizationText || '';
    }

    if (!mainLrc) return null;

    // LX Music embeds the authoritative word-timed track in an `[awlrc:...]` container;
    // the repeated LRC body is only a fallback view and must not be parsed as one timeline.
    const container = extractAwlrcContainer(mainLrc);
    if (container?.awlrc || container?.lrc) {
        const translation = transLrc || container.tlrc || '';
        const romanization = container.rlrc || romanizationLrc;
        return container.awlrc
            ? ['awlrc', container.awlrc, translation, options, romanization]
            : ['lrc', container.lrc!, translation, options, romanization];
    }

    return [detectTimedLyricFormat(mainLrc), mainLrc, transLrc, options, romanizationLrc];
}

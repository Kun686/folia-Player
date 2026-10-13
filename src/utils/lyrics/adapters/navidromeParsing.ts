import { LyricData } from '../../../types';
import { LyricProcessingOptions, RawNavidromeLyric } from '../types';
import type { LyricParseFormat } from '../parserCore';
import { detectTimedLyricFormat } from '../formatDetection';
import { normalizeEmbeddedLrcText, normalizeEmbeddedStructuredLyrics } from '../embeddedLrcNormalization';
import {
    isNavidromeStructuredLyricCollection,
    parseNavidromeStructuredLyrics,
    parseNavidromeStructuredLyricsCollection,
    selectPreferredNavidromeStructuredLyric,
} from '../navidromeStructuredLyrics';


// navidromeParsing.ts — original adapter rules, with the execution environment supplying the parser.
export type NavidromeParser = (format: LyricParseFormat, content: string, translation?: string, options?: LyricProcessingOptions) => Promise<LyricData | null>;
export async function parseNavidromeLyrics(source: RawNavidromeLyric, options: LyricProcessingOptions, parse: NavidromeParser): Promise<LyricData | null> {
        if (source.structuredLyrics && isNavidromeStructuredLyricCollection(source.structuredLyrics)) {
            const parsedStructuredLyrics = parseNavidromeStructuredLyricsCollection(source.structuredLyrics, options);
            if (parsedStructuredLyrics) {
                return parsedStructuredLyrics;
            }

            const mainLyrics = selectPreferredNavidromeStructuredLyric(source.structuredLyrics);
            const translationLyrics = selectPreferredNavidromeStructuredLyric(source.structuredLyrics, 'translation');
            const normalizedMainLyrics = normalizeEmbeddedStructuredLyrics(mainLyrics?.line);
            const normalizedTranslationLyrics = translationLyrics
                ? normalizeEmbeddedStructuredLyrics(translationLyrics.line).mainText
                : normalizedMainLyrics.translationText;
            return await parse(
                detectTimedLyricFormat(normalizedMainLyrics.mainText),
                normalizedMainLyrics.mainText,
                normalizedTranslationLyrics,
                options
            );
        }

        if (source.structuredLyrics && !Array.isArray(source.structuredLyrics)) {
            const parsedStructuredLyrics = parseNavidromeStructuredLyrics(source.structuredLyrics, options);
            if (parsedStructuredLyrics) {
                return parsedStructuredLyrics;
            }

            const normalized = normalizeEmbeddedStructuredLyrics(source.structuredLyrics.line);
            return await parse(
                detectTimedLyricFormat(normalized.mainText),
                normalized.mainText,
                normalized.translationText,
                options
            );
        }

        if (source.structuredLyrics && source.structuredLyrics.length > 0) {
            const normalized = normalizeEmbeddedStructuredLyrics(source.structuredLyrics);
            return await parse(
                detectTimedLyricFormat(normalized.mainText),
                normalized.mainText,
                normalized.translationText,
                options
            );
        }

        if (source.plainLyrics) {
            const normalized = normalizeEmbeddedLrcText(source.plainLyrics);
            return await parse(
                detectTimedLyricFormat(normalized.mainText),
                normalized.mainText,
                normalized.translationText,
                options
            );
        }

        return null;

}

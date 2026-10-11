import type { LyricData } from '../../types';
import type { LyricProcessingOptions, RawLocalFileLyric } from './types';
import type { parseLyricsAsync } from './workerClient';
import { splitCombinedTimeline } from './timelineSplitter';
import { detectTimedLyricFormat } from './formatDetection';
import { extractAwlrcContainer } from './awlrcContainer';
import { parseFoliaLyricDocument } from './foliaLyricDocument';

// localPreparation.ts — original file precedence and track separation, shared by Worker and native hosts.
type PreparedLocalLyrics = { kind: 'parsed'; lyrics: LyricData | null }
    | { kind: 'parse'; args: Parameters<typeof parseLyricsAsync> };
export function prepareLocalLyrics(source: RawLocalFileLyric, options: LyricProcessingOptions = {}): PreparedLocalLyrics {
    if (!source.lrcContent) return { kind: 'parsed', lyrics: null };

    // Folia 自己导出的 `.fia` 已经是解析好的 LyricData，直接加载，不再过解析器。
    const foliaLyrics = parseFoliaLyricDocument(source.lrcContent);
    if (foliaLyrics) return { kind: 'parsed', lyrics: foliaLyrics };

    // 酷狗/洛雪导出的 LRC 把权威数据放在末尾的 `[awlrc:...]` 容器里，正文的分块布局只是冗余显示层。
    // 命中容器时直接取容器，跳过 splitCombinedTimeline 与格式嗅探。
    const container = extractAwlrcContainer(source.lrcContent);
    if (container?.awlrc || container?.lrc) {
        const translation = source.tLrcContent || container.tlrc || '';
        const romanization = source.rLrcContent || container.rlrc || '';
        return { kind: 'parse', args: container.awlrc
            ? ['awlrc', container.awlrc, translation, options, romanization]
            : ['lrc', container.lrc!, translation, options, romanization] };
    }

    let mainLrc = source.lrcContent;
    let transLrc = source.tLrcContent || '';
    let romanizationLrc = source.rLrcContent || '';
    let format = source.formatHint || detectTimedLyricFormat(mainLrc);

    if (format !== 'ttml') {
        const { main, trans, romanization } = splitCombinedTimeline(mainLrc);
        mainLrc = main;
        transLrc ||= trans;
        romanizationLrc ||= romanization;
        format = source.formatHint || detectTimedLyricFormat(mainLrc);
    }

    return { kind: 'parse', args: [format, mainLrc, transLrc, options, romanizationLrc] };
}

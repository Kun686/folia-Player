import type { RawNeteaseLyric } from './types';
import { hasNeteasePureMusicFlag, isPureMusicLyricText } from './pureMusic';
import { detectTimedLyricFormat } from './formatDetection';
import { resolveLyricProcessingOptions } from './filtering';
import type { LyricProcessingOptions } from './types';
import type { parseLyricsByFormat } from './parserCore';

// neteasePayload.ts — original response normalization and lyric track precedence without a transport.
export interface ExtractedNeteaseLyricPayload {
    mainLrc: string | null;
    yrcLrc: string | null;
    transLrc: string | null;
    romanizationLrc?: string | null;
    isPureMusic: boolean;
}

export const getProcessedLyricPayload = (response: any) => {
  if (!response) return { type: 'netease' as const };
  if (response.lrc || response.yrc || response.tlyric || response.ytlrc || response.romalrc || response.yromalrc) {
    return { type: 'netease' as const, ...response };
  }
  if (response.data && (response.data.lrc || response.data.yrc || response.data.tlyric || response.data.ytlrc || response.data.romalrc || response.data.yromalrc)) {
    return { type: 'netease' as const, ...response.data };
  }

  const lyricText = response.lyric || response.data?.lyric || response.data?.lrc || response.data?.lyrics;
  if (typeof lyricText === 'string') {
    return {
      type: 'netease' as const,
      lrc: { lyric: lyricText },
    };
  }

  return { type: 'netease' as const, ...response };
};

export const extractNeteaseLyricPayload = (source?: RawNeteaseLyric | null): ExtractedNeteaseLyricPayload => {
    const mainLrc = source?.lrc?.lyric || null;
    const yrcLrc = source?.yrc?.lyric || source?.lrc?.yrc?.lyric || null;
    const ytlrc = source?.ytlrc?.lyric || source?.lrc?.ytlrc?.lyric || null;
    const yromalrc = source?.yromalrc?.lyric || source?.lrc?.yromalrc?.lyric || null;
    const tlyric = source?.tlyric?.lyric || null;
    const romalrc = source?.romalrc?.lyric || source?.lrc?.romalrc?.lyric || null;
    const transLrc = (yrcLrc && ytlrc) ? ytlrc : tlyric;
    const romanizationLrc = (yrcLrc && yromalrc) ? yromalrc : romalrc;
    const isPureMusic = hasNeteasePureMusicFlag(source) || isPureMusicLyricText(mainLrc);

    return {
        mainLrc,
        yrcLrc,
        transLrc,
        romanizationLrc,
        isPureMusic
    };
};

export function prepareNeteaseLyrics(source?: RawNeteaseLyric | null, options: LyricProcessingOptions = {}) {
    const payload = extractNeteaseLyricPayload(source);
    const primaryLyrics = payload.yrcLrc || payload.mainLrc;
    const args: Parameters<typeof parseLyricsByFormat> | null = !primaryLyrics || payload.isPureMusic ? null : [
        payload.yrcLrc ? 'yrc' : detectTimedLyricFormat(payload.mainLrc || primaryLyrics),
        primaryLyrics, payload.transLrc || '', resolveLyricProcessingOptions(options), payload.romanizationLrc || '',
    ];
    return { payload, args };
}


export const extractCloudLyricText = (response: any): string => (
    response?.lrc || response?.data?.lrc || response?.lyric || response?.data?.lyric || ''
);

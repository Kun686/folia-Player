import { LyricParserFactory } from './lyrics/LyricParserFactory';
import type { LyricData } from '../types';
import type { NavidromeConfig, NavidromeSong } from '../types/navidrome';
import { navidromeApi } from '../services/navidromeService';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';
import { resolvePreferredNavidromeLyrics as resolveShared, hydrateNavidromeLyricPayload as hydrate } from './lyrics/navidromePayload';

// appNavidromeLyrics.ts — preserve the desktop adapter and its optional-lyrics fallback.
export { selectPreferredStructuredLyric } from './lyrics/navidromePayload';
export const resolvePreferredNavidromeLyrics = (song: Pick<NavidromeSong, 'cachedStructuredLyrics' | 'cachedPlainLyrics'>): Promise<LyricData | null> =>
    resolveShared(song, source => LyricParserFactory.parse(source));
export const hydrateNavidromeLyricPayload = (config: NavidromeConfig, song: NavidromeSong): Promise<void> =>
    hydrate(config, song, navidromeApi, error => console.warn('[App] Failed to fetch Navidrome lyrics:', error), getProviderSongMetadata);

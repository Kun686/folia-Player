import type { LocalMatchRequests } from '../types/localSongMatch';
import { omni } from '../services/onlineMusic/omni';
import { calculateMatchScore } from '../utils/lyrics/matchScore';
import { hasRenderableLyrics } from '../utils/lyrics/validity';
import { LYRIC_MATCH_SOURCES, fetchLyricsForMatchSource, searchAmllDbLyricCandidates } from '../utils/lyrics/lyricMatchSources';

// lyricMatchRequests.ts — reuse the original public AMLL catalog; music-provider calls retain Omni routing.
export const MOBILE_LYRIC_MATCH_SOURCES = LYRIC_MATCH_SOURCES.filter(source => source !== 'kugou');
export const mobileLocalMatchRequests: LocalMatchRequests = {
  search: async (source, query, target) => {
    if (source === 'amll') return searchAmllDbLyricCandidates(query, target);
    if (source !== 'netease' && source !== 'qq') throw new Error('unsupported');
    const page = await omni.searchProviderSongs(source, query, { limit: 50, offset: 0 });
    return [...page.items].sort((a, b) => calculateMatchScore(target, b) - calculateMatchScore(target, a));
  },
  fetch: async (source, song) => {
    if (source === 'amll') return fetchLyricsForMatchSource(source, song);
    if (song.sourceRef?.kind !== 'online' || song.sourceRef.providerId !== source) throw new Error('invalid-identity');
    const result = await omni.getLyrics(song);
    return { lyrics: hasRenderableLyrics(result.lyrics) ? result.lyrics : null, isPureMusic: result.isPureMusic };
  },
};

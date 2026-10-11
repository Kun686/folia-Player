import { useEffect, useRef, useState } from 'react';
import type { SongResult } from '../types';
import type { OnlineLyricsStorage } from '../services/onlineLyricsStorage';
import { getProviderSongMetadata } from '../services/onlineMusic/songMetadata';
import { loadOnlineLyricsState, saveOnlineLyricsState } from '../utils/onlineLyricsState';
import { matchOnlineLyricSelection } from '../utils/onlineLyricEdits';
import { buildLyricSearchQuery } from '../utils/lyrics/searchQuery';
import { fetchLyricsForMatchSource, searchLyricsByMatchSource } from '../utils/lyrics/lyricMatchSources';
import { hasRenderableLyrics } from '../utils/lyrics/validity';
import type { LyricMatchSource } from '../components/modal/lyricMatchResultHelpers';

// useOnlineLyricMatch.ts — original matching pipeline with per-dialog request ownership and injectable persistence.
export function useOnlineLyricMatch(song: SongResult, sources: readonly LyricMatchSource[], onMatch: () => void, storage?: OnlineLyricsStorage) {
  const [source, setSource] = useState<LyricMatchSource>(sources[0] ?? 'netease');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SongResult[]>([]);
  const [selectedResult, setSelectedResult] = useState<SongResult | null>(null);
  const [isSearching, setIsSearching] = useState(false), [isMatching, setIsMatching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0), mounted = useRef(true), matching = useRef(false);
  const key = JSON.stringify(song.sourceRef ?? song.id);
  const metadata = getProviderSongMetadata(song);
  const songInfo = { title: song.name || '', artist: metadata.artists.map(item => item.name).join(', '),
    album: metadata.album?.name || '', durationMs: metadata.durationMs };
  const isCurrent = (epoch: number) => mounted.current && epoch === request.current && (storage?.isCurrent() ?? true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, []);
  const handleSearch = async (query = searchQuery) => {
    if (matching.current || !query.trim()) return;
    const epoch = ++request.current;
    setIsSearching(true); setError(null); setSearchResults([]); setSelectedResult(null);
    try {
      const results = await searchLyricsByMatchSource(source, query.trim(), songInfo);
      if (!isCurrent(epoch)) return;
      setSearchResults(results); setSelectedResult(results[0] ?? null);
    } catch { if (isCurrent(epoch)) setError('localMusic.matchFailed'); }
    finally { if (mounted.current && epoch === request.current) setIsSearching(false); }
  };
  useEffect(() => {
    const query = buildLyricSearchQuery(songInfo.title, songInfo.artist, songInfo.album);
    setSearchQuery(query); void handleSearch(query);
    return () => { request.current++; };
  }, [key, source]);
  const handleConfirm = async () => {
    if (!selectedResult || matching.current || isSearching) return;
    const epoch = request.current;
    matching.current = true; setIsMatching(true); setError(null);
    try {
      const processed = await fetchLyricsForMatchSource(source, selectedResult);
      if (!isCurrent(epoch)) return;
      if (!processed || (!hasRenderableLyrics(processed.lyrics) && !processed.isPureMusic)) {
        setError('localMusic.noLyricsAvailable'); return;
      }
      const previous = await (storage ? storage.readState() : loadOnlineLyricsState(song));
      if (!isCurrent(epoch)) return;
      const next = matchOnlineLyricSelection(previous, processed, selectedResult.id, source);
      await (storage ? storage.writeState(next) : saveOnlineLyricsState(song, next));
      if (isCurrent(epoch)) onMatch();
    } catch { if (mounted.current && epoch === request.current) setError('localMusic.matchFailed'); }
    finally { matching.current = false; if (mounted.current) setIsMatching(false); }
  };
  const changeSource = (value: LyricMatchSource) => { if (value !== source) { request.current++; setSource(value); } };
  return { source, setSource: changeSource, searchQuery, setSearchQuery, searchResults, setSearchResults, selectedResult, setSelectedResult,
    isSearching, isMatching, error, handleSearch, handleConfirm };
}

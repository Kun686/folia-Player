import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import type { SongResult } from '../types';
import type { LocalSongMatchTarget, LocalSongMatchStorage, LocalMatchRequests } from '../types/localSongMatch';
import { applyLocalSongMatchSelection, resolveLyricMatchMetadataSelection } from '../services/localSongMatchSelectionService';
import { buildLocalSongMetadataSearchTarget, normalizeLyricMatchMetadataCandidate } from '../services/onlineMetadataSearchService';
import { getLocalLibraryAssignment } from '../services/localLibraryEntityRepository';
import { buildLyricSearchQuery } from '../utils/lyrics/searchQuery';
import { fetchLyricsForMatchSource, searchLyricsByMatchSource } from '../utils/lyrics/lyricMatchSources';
import type { LyricMatchSource } from '../components/modal/lyricMatchResultHelpers';
import { hasRenderableLyrics } from '../utils/lyrics/validity';

// useLocalLyricMatch.ts — original full selection flow with scoped asynchronous work and replaceable persistence.
export function useLocalLyricMatch(song: LocalSongMatchTarget, sources: readonly LyricMatchSource[], onMatch: () => void,
  storage?: LocalSongMatchStorage, requests?: LocalMatchRequests, localCoverAvailable = false) {
    const { t } = useTranslation();
    const mounted = useRef(true), locked = useRef(false);
    const [error, setError] = useState<string | null>(null);
    const current = (epoch: number) => mounted.current && epoch === searchRequestIdRef.current && (storage?.isCurrent() ?? true);
    const apply = storage?.apply ?? applyLocalSongMatchSelection;
    useEffect(() => { mounted.current = true; return () => { mounted.current = false; searchRequestIdRef.current++; }; }, []);
    // Search state
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<SongResult[]>([]);
    const [isSearching, setIsSearching] = useState(false);
    const [selectedResult, setSelectedResult] = useState<SongResult | null>(null);
    const [isMatching, setIsMatching] = useState(false);
    const searchRequestIdRef = useRef(0);

    const [source, setSource] = useState<LyricMatchSource>(sources[0] ?? 'netease');

    // Online data toggle state (dots)
    const [lyricsSource, setLyricsSource] = useState<'local' | 'embedded' | 'online' | undefined>(song.lyricsSource || 'online');
    const [useOnlineCover, setUseOnlineCover] = useState(song.useOnlineCover ?? !(song.localCoverAssetId || localCoverAvailable));
    const [useOnlineMetadata, setUseOnlineMetadata] = useState(song.titleOrigin !== 'import');

    // Derive song information for matching
    const songInfo = useMemo(() => {
        const title = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
        const artist = song.onlineMetadata?.artists.map(item => item.name).join(', ')
            || song.importedMetadata.artistNames.join(', ');
        const durationMs = song.duration || 0;
        const album = song.onlineMetadata?.album?.name || song.importedMetadata.albumName || '';
        return { title, artist, album, durationMs };
    }, [song]);

    // Selecting a result defaults lyrics to online while metadata remains an all-or-nothing bundle.
    useEffect(() => {
        if (selectedResult) {
            setLyricsSource('online');
        }
    }, [selectedResult]);

    const runSearch = async (query: string, activeSource: LyricMatchSource) => {
        const q = query.trim();
        if (!q || locked.current) return;

        const requestId = ++searchRequestIdRef.current;
        setIsSearching(true); setError(null);
        setSearchResults([]);
        setSelectedResult(null);

        try {
            const results = await (requests?.search ?? searchLyricsByMatchSource)(activeSource, q, songInfo);
            if (!current(requestId)) return;

            setSearchResults(results);
        } catch (error) {
            if (current(requestId)) setError('localMusic.matchFailed');
        } finally {
            if (current(requestId)) {
                setIsSearching(false);
            }
        }
    };

    // Initialize the query only when the target song changes.
    useEffect(() => {
        const title = song.title || song.fileName.replace(/\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i, '');
        const initialQuery = buildLyricSearchQuery(
            title,
            song.onlineMetadata?.artists.map(item => item.name).join(', ') || song.importedMetadata.artistNames.join(', '),
            song.onlineMetadata?.album?.name || song.importedMetadata.albumName || '',
        );
        setSearchQuery(initialQuery);
        void runSearch(initialQuery, source);
        return () => { searchRequestIdRef.current++; };
    }, [song]);

    // Source changes should reuse the user's current query instead of resetting it.
    useEffect(() => {
        void runSearch(searchQuery, source);
    }, [source]);

    const handleSearch = async (query?: string) => {
        await runSearch(query || searchQuery, source);
    };

    const handleConfirm = async () => {
        if (!selectedResult || locked.current || isSearching) return;
        const epoch = searchRequestIdRef.current;
        locked.current = true; setIsMatching(true); setError(null);
        try {
            const candidate = normalizeLyricMatchMetadataCandidate(
                source,
                selectedResult,
                buildLocalSongMetadataSearchTarget(song),
            );
            const selection = resolveLyricMatchMetadataSelection(source, candidate, { useOnlineMetadata, useOnlineCover });
            if (selection.metadata === 'online') {
                const assignment = await (storage?.assignment ?? getLocalLibraryAssignment)(song.id);
                if (!current(epoch)) return;
                const protectedOrigins = new Set(['manual', 'split']);
                const replacesProtectedArtist = Boolean(
                    candidate.artists.length
                    && assignment
                    && protectedOrigins.has(assignment.artistOrigin),
                );
                const replacesProtectedAlbum = Boolean(
                    candidate.album?.name
                    && assignment
                    && protectedOrigins.has(assignment.albumOrigin),
                );
                if ((replacesProtectedArtist || replacesProtectedAlbum)
                    && !window.confirm(t('localMusic.replaceProtectedEntityConfirm'))) return;
            }
            let processed = null;
            let lyricsFailed = false;
            if (lyricsSource === 'online') {
                try {
                    processed = await (requests?.fetch ?? fetchLyricsForMatchSource)(source, selectedResult);
                    lyricsFailed = !processed?.isPureMusic && !hasRenderableLyrics(processed?.lyrics);
                } catch (error) {
                    // A metadata/cover selection may succeed independently of the lyric fetch.
                    lyricsFailed = true;
                }
            }
            if (!current(epoch)) return;
            const applied = await apply({
                songId: song.id,
                ...selection,
                lyrics: lyricsSource || 'automatic',
                onlineLyrics: processed?.lyrics || processed?.isPureMusic ? {
                    lyrics: processed.lyrics ?? { lines: [] },
                    songId: selectedResult.id,
                    source,
                    providerPlatform: processed.matchedLyricsProviderPlatform,
                    isPureMusic: processed.isPureMusic,
                } : undefined,
                lyricsFailed,
            });
            if (!current(epoch)) return;
            onMatch();
            if (applied.partialLyricsFailure) alert(t('localMusic.lyricsNotAppliedOtherSaved'));
            else if (applied.coverAttempted && !applied.coverCached) alert(t('localMusic.coverCacheFailed'));
        } catch (error) {
            if (current(epoch)) setError('localMusic.matchFailed');
        } finally {
            locked.current = false; if (mounted.current) setIsMatching(false);
        }
    };

    const handleNoMatch = async () => {
        if (locked.current) return;
        const epoch = searchRequestIdRef.current; locked.current = true; setIsMatching(true); setError(null);
        try {
            if (!current(epoch)) return;
            await apply({
                songId: song.id,
                metadata: 'imported',
                cover: 'embedded',
                lyrics: 'automatic',
                setNoAutoMatch: true,
            });
            if (!current(epoch)) return;
            onMatch(); // Trigger refresh so the change applies
        } catch (error) {
            if (current(epoch)) setError('localMusic.matchFailed');
        } finally { locked.current = false; if (mounted.current) setIsMatching(false); }
    };

    const changeSource = (next: LyricMatchSource) => { if (!locked.current && source !== next) { searchRequestIdRef.current++; setSelectedResult(null); setSource(next); } };
    return { searchQuery, setSearchQuery, searchResults, isSearching, selectedResult, setSelectedResult, isMatching,
      source, setSource: changeSource, lyricsSource, setLyricsSource, useOnlineCover, setUseOnlineCover,
      useOnlineMetadata, setUseOnlineMetadata, songInfo, handleSearch, handleConfirm, handleNoMatch, error };
}

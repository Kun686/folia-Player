import type { LocalSong, LyricData, SongResult } from '../types';
import type { LocalLibraryAssignmentOrigin } from '../types/localLibrary';
import type { MatchedLocalMetadata } from '../utils/localMatchedMetadata';
import type { ProviderLyricsResult } from '../types/onlineMusic';
import type { AutoMatchBestLyricOptions, AutoMatchBestLyricResult } from '../utils/lyrics/autoMatchBestLyricTypes';
import { normalizeLyricMatchText } from '../utils/lyrics/matchScore';
import { buildLyricSearchQuery } from '../utils/lyrics/searchQuery';
import type { LocalAutomaticInput } from '../utils/lyrics/localSongMatchContext';
export { localAutomaticInput } from '../utils/lyrics/localSongMatchContext';
export type { LocalAutomaticInput, LocalAutomaticSettings } from '../utils/lyrics/localSongMatchContext';
import { normalizeLyricMatchMetadataCandidate, type MatchMetadataResolver } from '../utils/onlineMetadataCandidate';

// localAutomaticMatch.ts — original local matching flow with injected requests and atomic host persistence.
export interface LocalAutomaticPorts {
    metadata: MatchMetadataResolver;
    match(title: string, artist: string, durationMs: number, options: AutoMatchBestLyricOptions): Promise<AutoMatchBestLyricResult>;
    search(query: string, limit: number, offset: number): Promise<{ items: SongResult[] } | undefined>;
    lyrics(song: SongResult): Promise<ProviderLyricsResult | null | undefined>;
    save(metadata: MatchedLocalMetadata, options: { lyricsOnly?: boolean; songPatch: Partial<LocalSong>; protectOrigins?: LocalLibraryAssignmentOrigin[] }): Promise<void>;
}

// Helper function to normalize title for comparison
function normalizeTitle(title: string): string {
    return normalizeLyricMatchText(title).replace(/\s+/g, '');
}

// Helper function to check if two titles match
function isTitleMatch(localTitle: string, searchTitle: string): boolean {
    const normalizedLocal = normalizeTitle(localTitle);
    const normalizedSearch = normalizeTitle(searchTitle);

    // Check for exact match first
    if (normalizedLocal === normalizedSearch) {
        return true;
    }

    // Check if either title contains the other (for fuzzy matching)
    // This helps when local file is "Title-Artist" but search result is just "Title"
    if (normalizedLocal.includes(normalizedSearch) || normalizedSearch.includes(normalizedLocal)) {
        // Additional check: the shorter one should be at least 50% of the longer one
        // to avoid matching "a" with "abc"
        const minLength = Math.min(normalizedLocal.length, normalizedSearch.length);
        const maxLength = Math.max(normalizedLocal.length, normalizedSearch.length);
        if (minLength / maxLength >= 0.5) {
            return true;
        }
    }

    return false;
}

// Match lyrics for a local song using search API, respecting the configured local/online priority.
export async function matchLocalLyrics(input: LocalAutomaticInput, ports: LocalAutomaticPorts): Promise<LyricData | null> {
    if (input.pureMusic && !input.refreshFromMetadata) return null;
    const song: Partial<LocalSong> = {};
    try {
        const matchContext = input.context, settingsLyricSettings = input.settings;
        const searchQuery = buildLyricSearchQuery(matchContext.title, matchContext.artist, matchContext.album);
        const hasLocalOrEmbeddedLyrics = input.hasFileLyrics;
        const onlineFirst = settingsLyricSettings.localLyricsPriority === 'online';

        console.log(`[LocalMusic] Searching lyrics for: "${searchQuery}"`);

        // A selected GridView metadata identity is authoritative and must not be replaced by lyric fallback metadata.
        if (!hasLocalOrEmbeddedLyrics || onlineFirst) {
            const shouldUseBestLyric = settingsLyricSettings.autoUseBestLyric;
            if (shouldUseBestLyric || matchContext.metadataCandidate) {
                const bestMatch = await ports.match(
                    matchContext.title,
                    matchContext.artist,
                    matchContext.durationMs,
                    {
                        album: matchContext.album,
                        preferredSource: shouldUseBestLyric ? settingsLyricSettings.preferredAlternativeLyricSource : undefined,
                        metadataCandidate: matchContext.metadataCandidate,
                        exactMatchOnly: Boolean(matchContext.metadataCandidate && !shouldUseBestLyric),
                    },
                );

                if (bestMatch && 'isPureMusic' in bestMatch) {
                    song.matchedIsPureMusic = true;
                    song.matchedLyrics = undefined;
                    song.matchedLyricsSongId = bestMatch.id ?? matchContext.metadataCandidate?.songId;
                    song.matchedLyricsSource = bestMatch.source ?? matchContext.metadataCandidate?.source;
                    await ports.save( {}, { lyricsOnly: true, songPatch: song });
                    return null;
                }

                if (bestMatch && 'lyrics' in bestMatch) {
                    song.matchedLyricsSongId = bestMatch.id;
                    song.matchedLyricsSource = bestMatch.source;
                    song.matchedLyricsProviderPlatform = bestMatch.matchedLyricsProviderPlatform;
                    song.matchedLyrics = bestMatch.lyrics;
                    song.matchedIsPureMusic = false;

                    if (matchContext.metadataCandidate) {
                        await ports.save( {}, { lyricsOnly: true, songPatch: song });
                        return bestMatch.lyrics;
                    }

                    const matchedMetadata = normalizeLyricMatchMetadataCandidate(
                        bestMatch.source,
                        bestMatch.song,
                        {
                            title: matchContext.title,
                            artist: matchContext.artist,
                            album: matchContext.album,
                            durationMs: matchContext.durationMs,
                        },
                        ports.metadata,
                    );
                    const coverUrl = matchedMetadata.coverUrl;
                    await ports.save( {
                        source: matchedMetadata.source,
                        songId: matchedMetadata.songId,
                        title: matchedMetadata.title,
                        artists: matchedMetadata.artists,
                        album: matchedMetadata.album,
                        coverUrl,
                    }, {
                        songPatch: {
                            ...song,
                            useOnlineCover: Boolean(coverUrl && !input.hasLocalCover),
                        },
                        protectOrigins: ['manual', 'manual-match', 'split'],
                    });
                    return bestMatch.lyrics;
                }
            }
        } else if (matchContext.metadataCandidate) {
            return null;
        }

        // Search on Netease
        const searchPage = await ports.search(searchQuery, 50, 0);

        if (!searchPage?.items?.length) {
            console.warn(`[LocalMusic] No search results for: "${searchQuery}"`);
            return null;
        }

        // Try to find a song with matching title
        const localTitle = matchContext.title;
        const matchedSong = searchPage.items.find(candidate => isTitleMatch(localTitle, candidate.name));

        // If no exact title match found, return null to trigger manual selection
        if (!matchedSong) {
            console.log(`[LocalMusic] No exact title match found for: "${localTitle}". Manual selection required.`);
            return null;
        }

        const matchedMetadata = ports.metadata(matchedSong, 'netease');
        console.log(`[LocalMusic] Found exact title match: ${matchedSong.name} by ${matchedMetadata.artists.map(artist => artist.name).join(', ')}`);

        // Preserve local and embedded lyrics when the configured priority keeps them first.
        if (!onlineFirst && hasLocalOrEmbeddedLyrics) {
            console.log(`[LocalMusic] Local/embedded lyrics exist, skipping online lyrics fetch. Only fetching cover/metadata.`);

            // Only update metadata and cover, preserve local lyrics
            const coverUrl = matchedMetadata.coverUrl;
            await ports.save( {
                source: 'netease',
                songId: matchedSong.id,
                title: matchedSong.name,
                artists: matchedMetadata.artists,
                album: matchedMetadata.album,
                coverUrl: coverUrl?.replace('http:', 'https:'),
            }, {
                songPatch: { ...song, useOnlineCover: Boolean(coverUrl && !input.hasLocalCover) },
                protectOrigins: ['manual', 'manual-match', 'split'],
            });

            // Return null to indicate no NEW lyrics were fetched (local lyrics are used)
            return null;
        }

        // Fetch lyrics (only when NO local lyrics)
        const processed = await ports.lyrics(matchedSong);
        if (!processed) return null;

        song.matchedLyricsSongId = matchedSong.id;
        song.matchedLyricsSource = 'netease';
        song.matchedLyrics = processed.lyrics || undefined;
        song.matchedIsPureMusic = processed.isPureMusic;

        if (matchContext.metadataCandidate) {
            await ports.save( {}, { lyricsOnly: true, songPatch: song });
            return processed.lyrics;
        }

        const coverUrl = matchedMetadata.coverUrl;
        await ports.save( {
            source: 'netease',
            songId: matchedSong.id,
            title: matchedSong.name,
            artists: matchedMetadata.artists,
            album: matchedMetadata.album,
            coverUrl: coverUrl?.replace('http:', 'https:'),
        }, {
            songPatch: { ...song, useOnlineCover: Boolean(coverUrl && !input.hasLocalCover) },
            protectOrigins: ['manual', 'manual-match', 'split'],
        });
        return processed.lyrics;
    } catch (error) {
        console.error('[LocalMusic] Failed to match lyrics:', error);
        return null;
    }
}


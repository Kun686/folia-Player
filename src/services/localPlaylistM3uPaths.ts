import type { LocalSong } from '../types';

// localPlaylistM3uPaths.ts — original M3U path normalization and unambiguous catalog matching.
export interface M3uMatchResult { matchedSongIds: string[]; unmatchedPaths: string[]; ambiguousPaths: string[] }

const stripWrappingQuotes = (value: string): string => {
    const trimmed = value.trim();
    if (trimmed.length >= 2 && (
        (trimmed.startsWith('"') && trimmed.endsWith('"'))
        || (trimmed.startsWith("'") && trimmed.endsWith("'"))
    )) {
        return trimmed.slice(1, -1).trim();
    }
    return trimmed;
};

const decodePath = (value: string): string => {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
};

// Converts file URLs, Windows paths, and relative paths into one slash-separated comparison form.
export const normalizeM3uPath = (rawPath: string): string | null => {
    let path = stripWrappingQuotes(rawPath).replace(/^\uFEFF/, '');
    if (!path) return null;

    if (/^file:\/\//i.test(path)) {
        try {
            path = new URL(path).pathname;
        } catch {
            path = path.replace(/^file:\/\/+?/i, '');
        }
    } else if (/^[a-z][a-z\d+.-]*:\/\//i.test(path)) {
        return null;
    }

    path = decodePath(path).replace(/\\/g, '/').replace(/^\/[a-z]:\//i, '').replace(/^[a-z]:\//i, '');
    const segments: string[] = [];
    path.split('/').forEach(segment => {
        const trimmed = segment.trim();
        if (!trimmed || trimmed === '.') return;
        if (trimmed === '..') {
            segments.pop();
            return;
        }
        segments.push(trimmed);
    });

    return segments.length > 0 ? segments.join('/') : null;
};

const getPathWithoutImportedRoot = (path: string): string => {
    const separatorIndex = path.indexOf('/');
    return separatorIndex >= 0 ? path.slice(separatorIndex + 1) : path;
};

const addCandidate = (map: Map<string, LocalSong[]>, path: string, song: LocalSong): void => {
    const key = path.toLocaleLowerCase();
    const current = map.get(key) || [];
    if (!current.some(candidate => candidate.id === song.id)) {
        map.set(key, [...current, song]);
    }
};

export const matchM3uPathsToLocalSongs = (
    paths: string[],
    localSongs: LocalSong[],
): M3uMatchResult => {
    const exactCandidates = new Map<string, LocalSong[]>();
    const normalizedSongs = localSongs.flatMap(song => {
        const fullPath = normalizeM3uPath(song.filePath);
        if (!fullPath) return [];
        const relativePath = getPathWithoutImportedRoot(fullPath);
        addCandidate(exactCandidates, fullPath, song);
        addCandidate(exactCandidates, relativePath, song);
        addCandidate(exactCandidates, fullPath.split('/').pop() || fullPath, song);
        return [{ song, fullPath, relativePath }];
    });
    const matchedSongIds: string[] = [];
    const matchedSongIdSet = new Set<string>();
    const unmatchedPaths: string[] = [];
    const ambiguousPaths: string[] = [];

    paths.forEach(rawPath => {
        const path = normalizeM3uPath(rawPath);
        if (!path) {
            unmatchedPaths.push(rawPath);
            return;
        }

        let candidates = exactCandidates.get(path.toLocaleLowerCase()) || [];
        if (candidates.length === 0 && path.includes('/')) {
            const foldedPath = path.toLocaleLowerCase();
            candidates = normalizedSongs
                .filter(({ fullPath, relativePath }) => {
                    const foldedFullPath = fullPath.toLocaleLowerCase();
                    const foldedRelativePath = relativePath.toLocaleLowerCase();
                    return foldedFullPath.endsWith(`/${foldedPath}`)
                        || foldedPath.endsWith(`/${foldedFullPath}`)
                        || foldedPath.endsWith(`/${foldedRelativePath}`);
                })
                .map(({ song }) => song);
        }

        const uniqueCandidates = Array.from(new Map(candidates.map(song => [song.id, song])).values());
        if (uniqueCandidates.length === 0) {
            unmatchedPaths.push(rawPath);
            return;
        }
        if (uniqueCandidates.length > 1) {
            ambiguousPaths.push(rawPath);
            return;
        }

        const songId = uniqueCandidates[0].id;
        if (!matchedSongIdSet.has(songId)) {
            matchedSongIdSet.add(songId);
            matchedSongIds.push(songId);
        }
    });

    return { matchedSongIds, unmatchedPaths, ambiguousPaths };
};


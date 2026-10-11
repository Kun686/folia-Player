import type { LocalSong } from '../types';

// localPlaylistIdentity.ts — original duplicate-import identities and reference repair shared by both hosts.
const DUPLICATE_IMPORT_ROOT_SUFFIX = /\s\(\d+\)$/;

const getRootFolderName = (song: LocalSong): string => {
    const pathLike = song.filePath || song.folderName || '';
    return pathLike.split('/')[0] || '';
};

const getDuplicateImportRootBase = (rootFolderName: string): string => (
    rootFolderName.replace(DUPLICATE_IMPORT_ROOT_SUFFIX, '')
);

const getRelativePathWithoutRoot = (song: LocalSong): string | null => {
    if (!song.filePath) {
        return null;
    }

    const rootFolderName = getRootFolderName(song);
    return rootFolderName && song.filePath.startsWith(`${rootFolderName}/`)
        ? song.filePath.slice(rootFolderName.length + 1)
        : song.filePath;
};

const getDuplicateImportSongKey = (song: LocalSong): string | null => {
    const relativePath = getRelativePathWithoutRoot(song);
    if (!relativePath || typeof song.fileSize !== 'number' || typeof song.fileLastModified !== 'number') {
        return null;
    }

    return `${getDuplicateImportRootBase(getRootFolderName(song))}::${relativePath}::${song.fileSize}::${song.fileLastModified}`;
};

const isPreferredDuplicateImportCanonical = (candidate: LocalSong, current: LocalSong): boolean => {
    const candidateRoot = getRootFolderName(candidate);
    const currentRoot = getRootFolderName(current);
    const candidateLooksDuplicated = DUPLICATE_IMPORT_ROOT_SUFFIX.test(candidateRoot);
    const currentLooksDuplicated = DUPLICATE_IMPORT_ROOT_SUFFIX.test(currentRoot);

    if (candidateLooksDuplicated !== currentLooksDuplicated) {
        return !candidateLooksDuplicated;
    }

    if ((candidate.addedAt || 0) !== (current.addedAt || 0)) {
        return (candidate.addedAt || 0) < (current.addedAt || 0);
    }

    return candidate.id.localeCompare(current.id) < 0;
};

export const buildDuplicateImportCanonicalSongIds = (songs: LocalSong[]): Map<string, string> => {
    const canonicalSongs = new Map<string, LocalSong>();

    songs.forEach(song => {
        const duplicateKey = getDuplicateImportSongKey(song);
        if (!duplicateKey) {
            return;
        }

        const currentCanonical = canonicalSongs.get(duplicateKey);
        if (!currentCanonical || isPreferredDuplicateImportCanonical(song, currentCanonical)) {
            canonicalSongs.set(duplicateKey, song);
        }
    });

    return new Map(Array.from(canonicalSongs.entries()).map(([duplicateKey, song]) => [duplicateKey, song.id]));
};

/**
 * 歌单里存的是"重复导入组"的 canonical id（见 repairPlaylistSongIds），而正在播放的可能是同一文件
 * 的另一份副本。判断收藏和写入收藏都必须先换算到同一把尺子，否则写进去的 id 和读出来的对不上。
 */
export const buildCanonicalLocalSongIdIndex = (songs: LocalSong[]): Map<string, string> => {
    const canonicalByDuplicateKey = buildDuplicateImportCanonicalSongIds(songs);
    const index = new Map<string, string>();

    songs.forEach(song => {
        const duplicateKey = getDuplicateImportSongKey(song);
        const canonicalSongId = duplicateKey ? canonicalByDuplicateKey.get(duplicateKey) : undefined;
        if (canonicalSongId && canonicalSongId !== song.id) {
            index.set(song.id, canonicalSongId);
        }
    });

    return index;
};

export const resolveCanonicalLocalSongId = (songId: string, songs: LocalSong[]): string => {
    const song = songs.find(candidate => candidate.id === songId);
    if (!song) {
        return songId;
    }

    const duplicateKey = getDuplicateImportSongKey(song);
    if (!duplicateKey) {
        return songId;
    }

    return buildDuplicateImportCanonicalSongIds(songs).get(duplicateKey) || songId;
};

export const repairPlaylistSongIds = (
    songIds: string[],
    validSongById: Map<string, LocalSong>,
    duplicateCanonicalSongIds: Map<string, string>
): { songIds: string[]; changed: boolean; } => {
    const seen = new Set<string>();
    const repairedSongIds: string[] = [];
    let changed = false;

    songIds.forEach(songId => {
        const song = validSongById.get(songId);
        if (!song) {
            changed = true;
            return;
        }

        const duplicateKey = getDuplicateImportSongKey(song);
        const canonicalSongId = duplicateKey ? duplicateCanonicalSongIds.get(duplicateKey) || songId : songId;
        if (canonicalSongId !== songId) {
            changed = true;
        }

        if (seen.has(canonicalSongId)) {
            changed = true;
            return;
        }

        seen.add(canonicalSongId);
        repairedSongIds.push(canonicalSongId);
    });

    return { songIds: repairedSongIds, changed };
};


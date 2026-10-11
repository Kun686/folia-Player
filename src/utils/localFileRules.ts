import type { LocalLibrarySnapshotFile } from '../types';

// localFileRules.ts — original file classification and sidecar naming, shared by desktop and native scanning.
export const BROWSER_AUDIO_EXTENSIONS = /\.(mp3|flac|m4a|wav|ogg|opus|aac)$/i;
export const ELECTRON_FALLBACK_AUDIO_EXTENSIONS = /\.(alac|ape|wv|tta|wma|aif|aiff|caf)$/i;
export const KNOWN_AUDIO_EXTENSIONS = /\.(mp3|flac|m4a|wav|ogg|opus|aac|alac|ape|wv|tta|wma|aif|aiff|caf)$/i;
export const LYRIC_EXTENSIONS = /\.(lrc|vtt|ttml|qrc|yrc|krc|fia)$/i;
export const TRANSLATION_LYRIC_EXTENSIONS = /\.t\.(lrc|vtt)$/i;
const PREFERRED_FOLDER_COVER_FILES = ['cover.png', 'cover.jpg', 'cover.jpeg'];

export function getFolderCoverPriority(fileName: string): number {
    return PREFERRED_FOLDER_COVER_FILES.indexOf(fileName.toLowerCase());
}

export function getParentRelativePath(relativePath: string): string {
    const lastSlashIndex = relativePath.lastIndexOf('/');
    return lastSlashIndex === -1 ? '' : relativePath.slice(0, lastSlashIndex);
}

export function getAudioBasePath(relativePath: string, additionalAudioExtensions?: RegExp): string {
    const path = relativePath.replace(KNOWN_AUDIO_EXTENSIONS, '');
    return additionalAudioExtensions ? path.replace(additionalAudioExtensions, '') : path;
}

export function getSidecarLyricBasePath(relativePath: string, kind: 'lyric' | 'translationLyric', additionalAudioExtensions?: RegExp): string {
    const withoutLyricSuffix = kind === 'translationLyric'
        ? relativePath.replace(/\.t\.(lrc|vtt)$/i, '')
        : relativePath.replace(/\.(lrc|vtt|ttml|qrc|yrc|krc|fia)$/i, '');

    // Support both "track.lrc" and "track.mp3.lrc" style sidecar lyrics.
    return getAudioBasePath(withoutLyricSuffix, additionalAudioExtensions);
}

export function classifyLocalFile(fileName: string, isAudio: (name: string) => boolean): LocalLibrarySnapshotFile['kind'] {
    const lowerName = fileName.toLowerCase();
    if (TRANSLATION_LYRIC_EXTENSIONS.test(lowerName)) {
        return 'translationLyric';
    }
    if (LYRIC_EXTENSIONS.test(lowerName)) {
        return 'lyric';
    }
    if (getFolderCoverPriority(lowerName) !== -1) {
        return 'cover';
    }
    if (isAudio(fileName)) {
        return 'audio';
    }
    return 'other';
}

import type { LocalLyricsPriority, SongResult } from '../types';
import { buildCurrentSongExportEntry, type RawLyrics } from '../services/lyricExport/currentSongExport';
import { buildLyricFileBaseName, buildLyricFileContent, LYRIC_EXPORT_EXTENSIONS } from '../services/lyricExport/lyricExportFiles';
import type { LyricExportFormat } from '../services/lyricExport/types';
import { getPlaybackSongKey } from '../utils/appPlaybackGuards';
import { resolveLocalSongLyrics } from '../utils/lyrics/localSongLyrics';
import { localLyricsFromSnapshot } from '../utils/lyrics/localLyricSnapshot';
import { isPureMusicLyricText } from '../utils/lyrics/pureMusic';
import { resolveOnlineLyrics, resolveOnlineLyricsPureMusic } from '../utils/onlineLyricsSelection';
import { native } from './bridge';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';

// lyricExport.ts — native storage supplies raw sources to the original export pipeline, fully offline.
async function readRawSource(song: SongResult, priority: LocalLyricsPriority): Promise<(RawLyrics & { localPath?: string }) | null> {
    if (song.sourceRef?.kind === 'local') {
        const snapshot = await native.readLocalLyrics({ id: song.sourceRef.mediaId });
        const selected = await resolveLocalSongLyrics(localLyricsFromSnapshot(snapshot), priority);
        if (!selected.lyrics || !selected.source) return null;
        const fileName = (song as SongResult & { importedFileName?: string }).importedFileName;
        return {
            lyrics: selected.lyrics, source: selected.source,
            ...(fileName ? { localPath: fileName.replace(/\.[^./]+$/, '') } : {}),
            isPureMusic: selected.source === 'online' && typeof snapshot.matched?.matchedIsPureMusic === 'boolean'
                ? () => snapshot.matched!.matchedIsPureMusic! : isPureMusicLyricText,
        };
    }
    if (song.sourceRef?.kind !== 'online' && song.sourceRef?.kind !== 'navidrome') throw new Error('unsupported-lyric-source');
    // Both fields come from one native snapshot, so a concurrent source change cannot mix them.
    const { payload } = await native.readLyricCache({ song });
    const state = payload.state ?? null;
    const lyrics = resolveOnlineLyrics(state, payload.lyrics ?? null);
    return lyrics ? {
        lyrics,
        source: state?.lyricsSource === 'imported' && state.importedLyrics ? 'imported' : 'online',
        isPureMusic: text => resolveOnlineLyricsPureMusic(state, text),
    } : null;
}

export async function exportMobileSongLyrics(song: SongResult, format: LyricExportFormat, isCurrent: () => boolean) {
    const priority = useLyricSettingsStore.getState().localLyricsPriority;
    const entry = await buildCurrentSongExportEntry({
        song, onScreenLyrics: null, activeLocalLyricsSource: null, localLyricsPriority: priority,
        readRawSource: current => readRawSource(current, priority), offsetKey: getPlaybackSongKey(song), strictStorage: true,
    });
    if (!isCurrent()) return 'cancelled';
    if (!entry) return 'empty';
    const content = buildLyricFileContent(entry, format, { includeTranslation: true, includeRomanization: true });
    const fileName = `${buildLyricFileBaseName(entry)}.${LYRIC_EXPORT_EXTENSIONS[format]}`;
    const result = await native.shareLyricFile({ fileName, content });
    return result.completed ? 'exported' : 'cancelled';
}

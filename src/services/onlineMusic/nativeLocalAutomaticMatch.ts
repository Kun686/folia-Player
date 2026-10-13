import type { LocalMatchDocument, LocalMatchSnapshot } from '../../types/localSongMatch';
import type { SongResult } from '../../types';
import { localMatchTarget } from '../../utils/localMatchTarget';
import { localMatchJSON } from '../../utils/lyrics/nativeLocalMatchRuntime';
import { shouldRunLocalSongAutomaticMatch, shouldRefreshLocalSongLyricsFromMetadata } from '../../utils/lyrics/localSongMatchContext';
import { applyMatchedSongFields } from '../../utils/localMatchedMetadata';
import { cleanLocalLibraryName } from '../../utils/localLibraryNames';
import { localAutomaticInput, type LocalAutomaticSettings } from '../../utils/lyrics/localSongMatchContext';
import type { LocalAutomaticPorts } from '../localAutomaticMatch';

// nativeLocalAutomaticMatch.ts — compact original local matching input and a guarded native commit document.
type Snapshot = LocalMatchSnapshot & { display?: SongResult; hasLocalCover?: boolean };
export type LocalAutomaticDecision = { metadata: Parameters<LocalAutomaticPorts['save']>[0]; options: Parameters<LocalAutomaticPorts['save']>[1]; clearedFields?: string[] };
function read(text: string): { snapshot: Snapshot; settings: LocalAutomaticSettings } {
    if (text.length > 37_000_000) throw new Error('invalid-local-match');
    const input = JSON.parse(text);
    if (input.version !== 1 || input.snapshot?.base?.sourceRef?.kind !== 'local'
        || !input.snapshot.lyrics || !['local', 'online'].includes(input.settings?.localLyricsPriority)
        || typeof input.settings.autoUseBestLyric !== 'boolean'
        || !['qq', 'netease', 'kugou', 'amll'].includes(input.settings.preferredAlternativeLyricSource)) throw new Error('invalid-local-match');
    if (input.snapshot.document) input.snapshot.document = JSON.parse(localMatchJSON(JSON.stringify(input.snapshot.document)));
    return input;
}

// Files and cover bytes stay in the parser actor; the network job receives only matching facts.
export function localAutomaticInputJSON(text: string): string {
    const { snapshot, settings } = read(text), song = { ...localMatchTarget(snapshot), ...snapshot.document };
    const hasCover = Boolean(snapshot.hasLocalCover || snapshot.embeddedCover);
    const needsLyrics = (settings.localLyricsPriority === 'online' || (!song.hasLocalLyrics && !song.hasEmbeddedLyrics))
        && ((!song.matchedLyrics && !song.matchedIsPureMusic) || shouldRefreshLocalSongLyricsFromMetadata(song));
    const needsCover = !hasCover && !song.onlineMetadata?.coverUrl;
    if ((!needsLyrics && !needsCover) || !shouldRunLocalSongAutomaticMatch(song)) return 'null';
    const display = snapshot.display ?? snapshot.base;
    const input = localAutomaticInput(song, { artistNames: display.artists.map(x => x.name), albumName: display.album?.name }, settings);
    input.hasLocalCover = hasCover;
    return JSON.stringify(input);
}

export function localAutomaticResultJSON(text: string): string {
    const { snapshot } = read(text), decision = JSON.parse(text).decision as LocalAutomaticDecision;
    if (!decision?.metadata || !decision.options?.songPatch) throw new Error('invalid-local-match');
    const target = localMatchTarget(snapshot), previous: LocalMatchDocument = snapshot.document ?? {
        title: target.title, titleOrigin: target.titleOrigin, artistNames: target.importedMetadata.artistNames,
        albumName: target.importedMetadata.albumName,
    };
    const { metadata, options } = decision;
    const patch = { ...previous, ...options.songPatch };
    for (const key of decision.clearedFields ?? []) {
        if (!['matchedLyrics', 'matchedLyricsSongId', 'matchedLyricsSource', 'matchedLyricsProviderPlatform'].includes(key)) throw new Error('invalid-local-match');
        delete patch[key as keyof LocalMatchDocument];
    }
    let document = applyMatchedSongFields(patch, metadata, options.lyricsOnly);
    if (!options.lyricsOnly) {
        if (metadata.artists?.length) document.artistNames = metadata.artists.flatMap(artist => {
            const name = cleanLocalLibraryName(artist.name); return name ? [name] : [];
        });
        if (cleanLocalLibraryName(metadata.album?.name)) document.albumName = cleanLocalLibraryName(metadata.album?.name);
    }
    document = JSON.parse(localMatchJSON(JSON.stringify(document)));
    return JSON.stringify({ document, source: snapshot.lyrics.lyricsSource ?? null,
        metadata: options.lyricsOnly ? 'keep' : 'online', updateArtists: Boolean(metadata.artists?.length),
        updateAlbum: Boolean(metadata.album?.name?.trim()), protectOrigins: options.protectOrigins ?? [],
        cacheCover: document.useOnlineCover === true && Boolean(document.onlineMetadata?.coverUrl) });
}

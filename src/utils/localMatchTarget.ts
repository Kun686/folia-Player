import type { LocalMatchSnapshot, LocalSongMatchTarget } from '../types/localSongMatch';
import { buildImportedMetadataSnapshot } from './localSongMetadata';
import { localLyricsFromSnapshot } from './lyrics/localLyricSnapshot';

// localMatchTarget.ts — original local match facts, independent of provider and browser state.
export function localMatchTarget(snapshot: LocalMatchSnapshot): LocalSongMatchTarget {
  const imported = buildImportedMetadataSnapshot({ fileName: snapshot.fileName, fallbackTitle: snapshot.base.name,
    embeddedArtists: snapshot.base.artists.map(x => x.name), fallbackAlbum: snapshot.base.album?.name });
  return { id: String(snapshot.base.id), fileName: snapshot.fileName, duration: snapshot.base.durationMs ?? 0,
    title: snapshot.document?.title ?? imported.title, titleOrigin: snapshot.document?.titleOrigin ?? 'import',
    importedMetadata: imported, ...snapshot.document, ...localLyricsFromSnapshot(snapshot.lyrics) };
}

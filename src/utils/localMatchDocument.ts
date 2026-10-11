import type { LocalMatchDocument, LocalMatchSnapshot, LocalSongMatchTarget } from '../types/localSongMatch';
import type { ApplyLocalSongMatchSelectionInput } from './localSongMatchSelection';
import { buildLocalSongMatchPatch } from './localSongMatchSelection';
import { applyMatchedSongFields } from './localMatchedMetadata';
import { buildImportedMetadataSnapshot } from './localSongMetadata';
import { cleanLocalLibraryName } from './localLibraryNames';
import { localLyricsFromSnapshot } from './lyrics/localLyricSnapshot';

// localMatchDocument.ts — native single-song storage of the original match selection and canonical metadata semantics.
export function localMatchTarget(snapshot: LocalMatchSnapshot): LocalSongMatchTarget {
  const imported = buildImportedMetadataSnapshot({ fileName: snapshot.fileName, fallbackTitle: snapshot.base.name,
    embeddedArtists: snapshot.base.artists.map(x => x.name), fallbackAlbum: snapshot.base.album?.name });
  return { id: String(snapshot.base.id), fileName: snapshot.fileName, duration: snapshot.base.durationMs ?? 0,
    title: snapshot.document?.title ?? imported.title, titleOrigin: snapshot.document?.titleOrigin ?? 'import',
    importedMetadata: imported, ...snapshot.document, ...localLyricsFromSnapshot(snapshot.lyrics) };
}
export function buildLocalMatchDocument(snapshot: LocalMatchSnapshot, input: ApplyLocalSongMatchSelectionInput) {
  const song = localMatchTarget(snapshot);
  if (input.songId !== song.id) throw new Error('invalid-local-identity');
  const prior = snapshot.document;
  let document: LocalMatchDocument = prior ? { ...prior } : { title: song.title, titleOrigin: song.titleOrigin,
    artistNames: song.importedMetadata.artistNames, albumName: song.importedMetadata.albumName };
  const patch = buildLocalSongMatchPatch(input);
  const { lyricsSource, ...fields } = patch;
  document = { ...document, ...fields };
  if (input.metadata === 'imported') {
    document.title = song.importedMetadata.title; document.titleOrigin = 'import';
    document.artistNames = song.importedMetadata.artistNames; document.albumName = song.importedMetadata.albumName;
  } else {
    const candidate = input.candidate;
    const metadata = candidate ? { source: candidate.source, songId: candidate.songId, title: candidate.title,
      artists: candidate.artists.length ? candidate.artists : undefined, album: candidate.album, coverUrl: candidate.coverUrl } : {};
    document = applyMatchedSongFields(document, metadata, input.metadata !== 'online',
      input.matchMode === 'automatic' ? 'auto-match' : 'manual-match');
    if (input.metadata === 'online' && candidate) {
      if (candidate.artists.length) document.artistNames = candidate.artists.flatMap(x => {
        const name = cleanLocalLibraryName(x.name); return name ? [name] : [];
      });
      if (cleanLocalLibraryName(candidate.album?.name)) document.albumName = cleanLocalLibraryName(candidate.album?.name);
    }
  }
  const source = 'lyricsSource' in patch ? lyricsSource : snapshot.lyrics.lyricsSource;
  return { document, source: source ?? null };
}

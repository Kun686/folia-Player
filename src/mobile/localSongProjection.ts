import type { LocalSong, SongResult } from '../types';
import { cleanLocalLibraryName, splitLocalLibraryArtistNames } from '../utils/localLibraryNames';

// localSongProjection.ts — temporary original-model metadata; native mediaId remains the sole persisted song identity.
export function projectMobileLocalSongs(songs: SongResult[]): LocalSong[] {
  const seen = new Set<string>();
  return songs.flatMap(song => {
    if (song.sourceRef?.kind !== 'local' || seen.has(song.sourceRef.mediaId)) return [];
    const id = song.sourceRef.mediaId;
    seen.add(id);
    const metadata = song as SongResult & { importedFileName?: string; folderRootID?: string; folderRelativePath?: string;
      trackNumber?: number; discNumber?: number; fileLastModified?: number; fileSize?: number };
    const importedName = metadata.importedFileName;
    const number = (value: number | undefined) => Number.isSafeInteger(value) && value !== 0 ? value : undefined;
    return [{ id, title: song.name, titleOrigin: 'import' as const, fileName: importedName || song.name,
      filePath: metadata.folderRelativePath ? (metadata.folderRootID ?? '') + '/' + metadata.folderRelativePath : importedName || id,
      trackNumber: number(metadata.trackNumber), discNumber: number(metadata.discNumber),
      fileLastModified: typeof metadata.fileLastModified === 'number' && Number.isFinite(metadata.fileLastModified) ? metadata.fileLastModified : undefined,
      duration: song.durationMs, fileSize: metadata.fileSize ?? 0, mimeType: '', addedAt: 0,
      importedMetadata: { title: song.name, titleSource: 'embedded' as const,
        artistNames: song.artists.flatMap(artist => splitLocalLibraryArtistNames(artist.name)),
        albumName: cleanLocalLibraryName(song.album.name) } }];
  });
}

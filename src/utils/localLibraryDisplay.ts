import type { SongResult, UnifiedSong } from '../types';
import type { LocalLibraryAssignment, LocalLibraryEntity } from '../types/localLibrary';
import { buildLocalLibraryIndex, followEntityRedirect, type LocalLibraryIndex } from './localLibraryIndex';

// localLibraryDisplay.ts — shared entity projection for desktop playback and native JavaScriptCore.
export type LocalLibraryDisplayCatalog = {
    entities: LocalLibraryEntity[];
    assignments: LocalLibraryAssignment[];
};

export type ResolvedLocalSongMetadata = {
    artists: Array<{ entityId: string; name: string }>;
    album?: { entityId: string; name: string };
};

// Resolves the canonical artist and album display from stable entity assignments only.
export const resolveLocalSongMetadata = (
    songId: string,
    catalog: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
): ResolvedLocalSongMetadata => {
    const index = preparedIndex || buildLocalLibraryIndex(catalog.entities, catalog.assignments);
    const assignment = index.assignmentsBySongId.get(songId);
    const artists = assignment?.artistEntityIds.flatMap(entityId => {
        const activeEntityId = followEntityRedirect(entityId, index.entitiesById);
        const entity = activeEntityId ? index.entitiesById.get(activeEntityId) : undefined;
        return entity?.kind === 'artist' ? [{ entityId: entity.id, name: entity.displayName }] : [];
    }) || [];
    const activeAlbumId = assignment?.albumEntityId
        ? followEntityRedirect(assignment.albumEntityId, index.entitiesById)
        : undefined;
    const albumEntity = activeAlbumId ? index.entitiesById.get(activeAlbumId) : undefined;
    return {
        artists,
        album: albumEntity?.kind === 'album'
            ? { entityId: albumEntity.id, name: albumEntity.displayName }
            : undefined,
    };
};

const resolveLocalLibraryDisplayArtists = (
    songId: string,
    catalog?: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
) => {
    if (!catalog) return [];

    const resolved = resolveLocalSongMetadata(songId, catalog, preparedIndex);
    const seenEntityIds = new Set<string>();
    return resolved.artists.flatMap(entity => {
        if (seenEntityIds.has(entity.entityId)) return [];
        seenEntityIds.add(entity.entityId);
        return [{ id: 0, entityId: entity.entityId, name: entity.name }];
    });
};

// Replaces legacy joined artist text with the song's stable local-library artist entities.
export const applyLocalLibraryArtistDisplay = <T extends SongResult>(
    song: T,
    catalog?: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
): T => {
    const songId = (song as UnifiedSong).localRef?.songId;
    if (!songId) return song;

    const artists = resolveLocalLibraryDisplayArtists(songId, catalog, preparedIndex);
    if (artists.length === 0) return song;

    return {
        ...song,
        artists,
    };
};

// Maps a local song's album assignment onto both album fields used by GridView and player surfaces.
const applyLocalLibraryAlbumDisplay = <T extends SongResult>(
    song: T,
    catalog?: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
): T => {
    const songId = (song as UnifiedSong).localRef?.songId;
    if (!songId || !catalog) return song;

    const entity = resolveLocalSongMetadata(songId, catalog, preparedIndex).album;
    if (!entity) return song;

    return {
        ...song,
        album: {
            ...song.album,
            entityId: entity.entityId,
            name: entity.name,
        },
    };
};

// Applies the complete local entity display model used by cards, queues, and CoverTab.
export const applyLocalLibraryEntityDisplay = <T extends SongResult>(
    song: T,
    catalog?: LocalLibraryDisplayCatalog,
    preparedIndex?: LocalLibraryIndex,
): T => applyLocalLibraryAlbumDisplay(
    applyLocalLibraryArtistDisplay(song, catalog, preparedIndex),
    catalog,
    preparedIndex,
);

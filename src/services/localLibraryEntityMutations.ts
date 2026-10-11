import type { LocalLibraryArtistAssignmentMode, LocalLibraryAssignment, LocalLibrarySplitTarget } from '../types/localLibrary';
import { appDatabase } from './appDatabase';
import { mergeLibraryEntities, moveLibraryEntityMembers, renameLibraryEntity, splitLibraryEntity,
  type LocalLibraryEntityChange, type LocalLibraryEntitySnapshot } from './localLibraryEntityOperations';
import { splitLibraryArtistTargets } from './localLibraryArtistSplit';

// src/services/localLibraryEntityMutations.ts
// Implements merge, split, and display-name changes without mixing them into metadata application.
// Storage remains a single desktop Dexie transaction; the shared rules do not import the desktop database.
const mutate = <T>(operation: (snapshot: LocalLibraryEntitySnapshot) => LocalLibraryEntityChange<T>, songIds?: string[]): Promise<T> => (
  appDatabase.transaction('rw', [appDatabase.local_library_entities, appDatabase.local_library_assignments], async () => {
    const change = operation({ entities: await appDatabase.local_library_entities.toArray(),
      assignments: songIds
        ? (await appDatabase.local_library_assignments.bulkGet([...new Set(songIds)]))
          .filter((assignment): assignment is LocalLibraryAssignment => Boolean(assignment))
        : await appDatabase.local_library_assignments.toArray() });
    await Promise.all([
      change.entities.length ? appDatabase.local_library_entities.bulkPut(change.entities) : Promise.resolve(),
      change.assignments.length ? appDatabase.local_library_assignments.bulkPut(change.assignments) : Promise.resolve(),
    ]);
    return change.result;
  })
);

export const mergeEntities = (targetEntityId: string, sourceEntityIds: string[]) =>
  mutate(snapshot => mergeLibraryEntities(snapshot, targetEntityId, sourceEntityIds));

export const splitEntity = (entityId: string, songIds: string[], displayName: string) =>
  mutate(snapshot => splitLibraryEntity(snapshot, entityId, songIds, displayName), songIds);

// Reassigns only the selected members while leaving both existing entities active.
export const moveEntityMembersToExistingEntity = (sourceEntityId: string, targetEntityId: string, songIds: string[]) =>
  mutate(snapshot => moveLibraryEntityMembers(snapshot, sourceEntityId, targetEntityId, songIds), songIds);

// Applies multiple existing or newly named artists using explicit append/replace semantics.
export const splitArtistEntityToTargets = (sourceEntityId: string, songIds: string[],
  destinations: LocalLibrarySplitTarget[], mode: LocalLibraryArtistAssignmentMode) =>
  mutate(snapshot => splitLibraryArtistTargets(snapshot, sourceEntityId, songIds, destinations, mode), songIds);

export const setEntityDisplayName = (entityId: string, displayName: string): Promise<void> => (
  appDatabase.transaction('rw', appDatabase.local_library_entities, async () => {
    const change = renameLibraryEntity({ entities: await appDatabase.local_library_entities.toArray(), assignments: [] }, entityId, displayName);
    await appDatabase.local_library_entities.bulkPut(change.entities);
  })
);

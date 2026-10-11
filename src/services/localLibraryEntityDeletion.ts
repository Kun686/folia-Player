import type { LocalLibraryAssignment, LocalLibraryEntity } from '../types/localLibrary';
import { buildLocalLibraryIndex, followEntityRedirect } from '../utils/localLibraryIndex';

// localLibraryEntityDeletion.ts — shared original cleanup of entity families affected by deleted songs.
const getAssignmentEntityIds = (assignment: LocalLibraryAssignment): string[] => [
  ...assignment.artistEntityIds, ...(assignment.albumEntityId ? [assignment.albumEntityId] : []),
];
export const collectOrphanedEntityIds = (deletedAssignments: LocalLibraryAssignment[],
  remainingAssignments: LocalLibraryAssignment[], entities: LocalLibraryEntity[]): string[] => {
  const { entitiesById } = buildLocalLibraryIndex(entities);
  const resolveEntityId = (entityId: string) => followEntityRedirect(entityId, entitiesById) || entityId;
  const affectedEntityIds = new Set(deletedAssignments.flatMap(getAssignmentEntityIds).map(resolveEntityId));
  const referencedEntityIds = new Set(remainingAssignments.flatMap(getAssignmentEntityIds).map(resolveEntityId));
  return entities.filter(entity => {
    const resolvedId = resolveEntityId(entity.id);
    return affectedEntityIds.has(resolvedId) && !referencedEntityIds.has(resolvedId);
  }).map(entity => entity.id);
};

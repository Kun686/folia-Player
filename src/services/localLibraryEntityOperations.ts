import type { LocalLibraryAssignment, LocalLibraryEntity } from '../types/localLibrary';
import { buildLocalLibraryIndex, followEntityRedirect } from '../utils/localLibraryIndex';
import { cleanLocalLibraryName, normalizeLocalLibraryName } from '../utils/localLibraryNames';
import { appendUnique, createLocalLibraryEntityId } from './localLibraryCatalogInternals';

// localLibraryEntityOperations.ts — original entity rules over an isolated snapshot, shared by desktop and native storage.
export interface LocalLibraryEntitySnapshot {
  entities: LocalLibraryEntity[];
  assignments: LocalLibraryAssignment[];
}
export interface LocalLibraryEntityChange<T> extends LocalLibraryEntitySnapshot { result: T }
export interface LocalLibraryEntityClock { now: number; createId(): string }
export const entityClock = (): LocalLibraryEntityClock => ({ now: Date.now(), createId: createLocalLibraryEntityId });

export function requireLibraryEntity(snapshot: LocalLibraryEntitySnapshot, id: string,
  byId = buildLocalLibraryIndex(snapshot.entities).entitiesById) {
  const resolved = followEntityRedirect(id, byId);
  const entity = resolved && byId.get(resolved);
  if (!entity || entity.mergedInto) throw new Error('Local library entity not found');
  return entity;
}

export function renameLibraryEntity(snapshot: LocalLibraryEntitySnapshot, id: string, name: string,
  clock = entityClock()): LocalLibraryEntityChange<void> {
  const cleaned = cleanLocalLibraryName(name);
  if (!cleaned) throw new Error('Entity display name cannot be empty');
  const entity = requireLibraryEntity(snapshot, id);
  return { assignments: [], result: undefined, entities: [{ ...entity, displayName: cleaned,
    aliases: appendUnique([...entity.aliases, cleaned]),
    normalizedAliases: appendUnique([...entity.normalizedAliases, normalizeLocalLibraryName(cleaned)]), updatedAt: clock.now }] };
}

export function mergeLibraryEntities(snapshot: LocalLibraryEntitySnapshot, targetId: string, sourceIds: string[],
  clock = entityClock()): LocalLibraryEntityChange<void> {
  const byId = buildLocalLibraryIndex(snapshot.entities).entitiesById;
  const target = requireLibraryEntity(snapshot, targetId, byId);
  const sources = [...new Map(sourceIds.map(id => requireLibraryEntity(snapshot, id, byId))
    .filter(source => source.id !== target.id).map(source => [source.id, source])).values()];
  if (sources.some(source => source.kind !== target.kind)) throw new Error('Cannot merge different entity kinds');
  const sourceSet = new Set(sources.map(source => source.id));
  const assignments = snapshot.assignments.flatMap(assignment => {
    if (target.kind === 'artist') {
      const replaced = assignment.artistEntityIds.map(id => sourceSet.has(id) ? target.id : id);
      if (!replaced.some((id, position) => id !== assignment.artistEntityIds[position])) return [];
      return [{ ...assignment, artistEntityIds: appendUnique(replaced), updatedAt: clock.now }];
    }
    if (!assignment.albumEntityId || !sourceSet.has(assignment.albumEntityId)) return [];
    return [{ ...assignment, albumEntityId: target.id, updatedAt: clock.now }];
  });
  return { result: undefined, assignments, entities: [{ ...target,
    aliases: appendUnique([...target.aliases, ...sources.flatMap(source => source.aliases)]),
    normalizedAliases: appendUnique([...target.normalizedAliases, ...sources.flatMap(source => source.normalizedAliases)]),
    updatedAt: clock.now }, ...sources.map(source => ({ ...source, mergedInto: target.id, updatedAt: clock.now }))] };
}

// Select only current members; stale selections cannot create empty entities or alter another collection.
export function selectedEntityMembers(snapshot: LocalLibraryEntitySnapshot, source: LocalLibraryEntity, songIds: string[]) {
  const selected = new Set(songIds);
  const assignments = snapshot.assignments.filter(assignment => selected.has(assignment.songId)
    && (source.kind === 'artist' ? assignment.artistEntityIds.includes(source.id) : assignment.albumEntityId === source.id));
  if (!assignments.length) throw new Error('No selected members belong to the source entity');
  return assignments;
}

export function splitLibraryEntity(snapshot: LocalLibraryEntitySnapshot, id: string, songIds: string[], name: string,
  clock = entityClock()): LocalLibraryEntityChange<LocalLibraryEntity> {
  const source = requireLibraryEntity(snapshot, id), cleaned = cleanLocalLibraryName(name);
  if (!cleaned) throw new Error('Cannot split an unnamed entity');
  const members = selectedEntityMembers(snapshot, source, songIds);
  const entity: LocalLibraryEntity = { id: clock.createId(), kind: source.kind, displayName: cleaned,
    aliases: [cleaned], normalizedAliases: [normalizeLocalLibraryName(cleaned)], createdAt: clock.now, updatedAt: clock.now };
  const assignments = members.map(assignment => source.kind === 'artist'
    ? { ...assignment, artistEntityIds: assignment.artistEntityIds.map(value => value === source.id ? entity.id : value),
      artistOrigin: 'split' as const, updatedAt: clock.now }
    : { ...assignment, albumEntityId: entity.id, albumOrigin: 'split' as const, updatedAt: clock.now });
  return { entities: [entity], assignments, result: entity };
}

// Reassigns only the selected members while leaving both existing entities active.
export function moveLibraryEntityMembers(snapshot: LocalLibraryEntitySnapshot, sourceId: string, targetId: string,
  songIds: string[], clock = entityClock()): LocalLibraryEntityChange<LocalLibraryEntity> {
  const source = requireLibraryEntity(snapshot, sourceId), target = requireLibraryEntity(snapshot, targetId);
  if (source.id === target.id) throw new Error('Cannot move members into the same entity');
  if (source.kind !== target.kind) throw new Error('Cannot move members between different entity kinds');
  const assignments = selectedEntityMembers(snapshot, source, songIds).map(assignment => source.kind === 'artist'
    ? { ...assignment, artistEntityIds: appendUnique(assignment.artistEntityIds.map(id => id === source.id ? target.id : id)),
      artistOrigin: 'split' as const, updatedAt: clock.now }
    : { ...assignment, albumEntityId: target.id, albumOrigin: 'split' as const, updatedAt: clock.now });
  return { entities: [], assignments, result: target };
}

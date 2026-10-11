import type { NativeLibraryInput, NativeLibraryRecord } from '../types/nativeLibrary';
import type { LocalLibraryAssignment, LocalLibraryEntityKind } from '../types/localLibrary';
import { normalizeLocalLibraryName } from '../utils/localLibraryNames';
import { resolveLocalLibraryEntity } from '../utils/localLibraryResolver';
import { collectOrphanedEntityIds } from '../services/localLibraryEntityDeletion';

// nativeLibraryCatalog.ts — replay current import/match metadata over durable manual relationships.
// Reads need not write: deterministic initial IDs remain stable until the first atomic native edit.
export function reconcileNativeLibrary(record: NativeLibraryRecord, inputs: NativeLibraryInput[]): NativeLibraryRecord {
  const liveIds = new Set(inputs.map(input => input.songId));
  const kept = record.assignments.filter(assignment => liveIds.has(assignment.songId));
  const removed = record.assignments.filter(assignment => !liveIds.has(assignment.songId));
  const orphaned = new Set(collectOrphanedEntityIds(removed, kept, record.entities));
  const entities = record.entities.filter(entity => !orphaned.has(entity.id));
  const assignments = new Map(kept.map(assignment => [assignment.songId, assignment]));
  const sources = new Map(record.sources.map(source => [source.songId, source.key]));
  const entityIds = new Set(entities.map(entity => entity.id));
  const resolve = (kind: LocalLibraryEntityKind, names: string[], preferredEntityIds: string[]) => [...new Set(names.flatMap(name => {
    const resolved = resolveLocalLibraryEntity({ entities, kind, name, preferredEntityIds, now: 0, createId: () => {
      const prefix = `mobile-entity:${JSON.stringify([kind, normalizeLocalLibraryName(name)])}`;
      let id = prefix, suffix = 0;
      while (entityIds.has(id)) id = `${prefix}:${++suffix}`;
      entityIds.add(id); return id;
    } });
    if (!resolved) return [];
    if (resolved.created) entities.push(resolved.entity);
    return [resolved.entity.id];
  }))];
  const nextSources = inputs.map(input => {
    const key = JSON.stringify([input.artistNames, input.albumName ?? '', input.origin, input.metadataRevision]);
    const current = assignments.get(input.songId);
    if (!current || sources.get(input.songId) !== key) {
      // A new metadata revision is an explicit match/restore, already protected by native revision checks.
      const next: LocalLibraryAssignment = { songId: input.songId,
        artistEntityIds: resolve('artist', input.artistNames, current?.artistEntityIds ?? []),
        albumEntityId: input.albumName ? resolve('album', [input.albumName], current?.albumEntityId ? [current.albumEntityId] : [])[0] : undefined,
        artistOrigin: input.origin, albumOrigin: input.origin, updatedAt: 0 };
      assignments.set(input.songId, next);
    }
    return { songId: input.songId, key };
  });
  return { version: 1, entities, assignments: [...assignments.values()], sources: nextSources };
}

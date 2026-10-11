import type { LocalLibraryArtistAssignmentMode, LocalLibraryEntity, LocalLibrarySplitTarget } from '../types/localLibrary';
import { cleanLocalLibraryName, normalizeLocalLibraryName } from '../utils/localLibraryNames';
import { buildLocalLibraryIndex } from '../utils/localLibraryIndex';
import { appendUnique } from './localLibraryCatalogInternals';
import { entityClock, requireLibraryEntity, selectedEntityMembers,
  type LocalLibraryEntityChange, type LocalLibraryEntitySnapshot } from './localLibraryEntityOperations';

// localLibraryArtistSplit.ts — original multi-artist append/replace semantics shared by all storage adapters.
// Applies multiple existing or newly named artists using explicit append/replace semantics.
export function splitLibraryArtistTargets(snapshot: LocalLibraryEntitySnapshot, sourceId: string, songIds: string[],
  destinations: LocalLibrarySplitTarget[], mode: LocalLibraryArtistAssignmentMode,
  clock = entityClock()): LocalLibraryEntityChange<LocalLibraryEntity[]> {
  const byId = buildLocalLibraryIndex(snapshot.entities).entitiesById;
  const source = requireLibraryEntity(snapshot, sourceId, byId);
  if (source.kind !== 'artist') throw new Error('Cannot split a non-artist entity');
  if (mode !== 'append' && mode !== 'replace') throw new Error('Invalid artist assignment mode');
  const members = selectedEntityMembers(snapshot, source, songIds);
  const selectedTargets: LocalLibraryEntity[] = [], newEntities: LocalLibraryEntity[] = [];
  const selectedTargetIds = new Set<string>(), selectedNames = new Set<string>();
  destinations.forEach(destination => {
    if (destination.entityId) {
      const existing = requireLibraryEntity(snapshot, destination.entityId, byId);
      if (existing.kind !== 'artist' || existing.id === source.id) throw new Error('Cannot split into an invalid artist entity');
      if (!selectedTargetIds.has(existing.id)) {
        selectedTargets.push(existing); selectedTargetIds.add(existing.id);
        selectedNames.add(normalizeLocalLibraryName(existing.displayName));
      }
      return;
    }
    const cleaned = cleanLocalLibraryName(destination.displayName);
    if (!cleaned) return;
    const normalized = normalizeLocalLibraryName(cleaned);
    if (!normalized || selectedNames.has(normalized)) return;
    const entity: LocalLibraryEntity = { id: clock.createId(), kind: 'artist', displayName: cleaned,
      aliases: [cleaned], normalizedAliases: [normalized], createdAt: clock.now, updatedAt: clock.now };
    selectedTargets.push(entity); newEntities.push(entity);
    selectedTargetIds.add(entity.id); selectedNames.add(normalized);
  });
  if (!selectedTargets.length) throw new Error('At least one artist destination is required');
  const targetIds = selectedTargets.map(entity => entity.id);
  const assignments = members.map(assignment => ({ ...assignment,
    artistEntityIds: mode === 'append' ? appendUnique([...assignment.artistEntityIds, ...targetIds]) : [...targetIds],
    artistOrigin: 'split' as const, updatedAt: clock.now }));
  return { entities: newEntities, assignments, result: selectedTargets };
}

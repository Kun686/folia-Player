import type { NativeLibraryRecord } from '../types/nativeLibrary';
import { mergeLibraryEntities, moveLibraryEntityMembers, renameLibraryEntity, splitLibraryEntity,
  type LocalLibraryEntityChange } from '../services/localLibraryEntityOperations';
import { splitLibraryArtistTargets } from '../services/localLibraryArtistSplit';
import { reconcileNativeLibrary } from './nativeLibraryCatalog';
import { object, readNativeLibraryInputs, readNativeLibraryOperation, readNativeLibraryRecord } from './nativeLibraryValidation';

// nativeLibraryRuntime.ts — bundled original entity rules executed by JavaScriptCore, independent of React/WKWebView.
export const protocolVersion = 1;
function read(request: string) {
  if (request.length > 32_000_000) throw new Error('local-library-too-large');
  const value = object(JSON.parse(request));
  if (value.version !== 1) throw new Error('invalid-local-library');
  return { value, state: reconcileNativeLibrary(readNativeLibraryRecord(value.record), readNativeLibraryInputs(value.inputs)) };
}
export function snapshotJSON(request: string): string { return JSON.stringify(read(request).state); }

// Apply a complete patch only after all source/target checks; caller persists the returned document atomically.
export function mutateJSON(request: string): string {
  const { value, state } = read(request), operation = readNativeLibraryOperation(value.operation);
  if (typeof value.idSeed !== 'string' || !/^[\da-f-]{36}$/i.test(value.idSeed)
    || typeof value.now !== 'number' || !Number.isFinite(value.now) || value.now < 0) throw new Error('invalid-local-library');
  let sequence = 0;
  const existingIds = new Set(state.entities.map(entity => entity.id));
  const clock = { now: value.now, createId: () => {
    let id: string;
    do { id = `mobile-entity:${value.idSeed}:${sequence++}`; } while (existingIds.has(id));
    existingIds.add(id); return id;
  } };
  let change: LocalLibraryEntityChange<unknown>;
  switch (operation.type) {
    case 'rename': change = renameLibraryEntity(state, operation.entityId, operation.displayName, clock); break;
    case 'merge': change = mergeLibraryEntities(state, operation.entityId, operation.sourceIds, clock); break;
    case 'split': change = splitLibraryEntity(state, operation.entityId, operation.songIds, operation.displayName, clock); break;
    case 'move': change = moveLibraryEntityMembers(state, operation.entityId, operation.targetId, operation.songIds, clock); break;
    case 'artists': change = splitLibraryArtistTargets(state, operation.entityId, operation.songIds, operation.targets, operation.mode, clock); break;
  }
  const entities = new Map(state.entities.map(entity => [entity.id, entity]));
  const assignments = new Map(state.assignments.map(assignment => [assignment.songId, assignment]));
  change.entities.forEach(entity => entities.set(entity.id, entity));
  change.assignments.forEach(assignment => assignments.set(assignment.songId, assignment));
  const result: NativeLibraryRecord = { ...state, entities: [...entities.values()], assignments: [...assignments.values()] };
  readNativeLibraryRecord(result);
  return JSON.stringify(result);
}

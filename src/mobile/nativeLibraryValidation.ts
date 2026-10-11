import type { NativeLibraryInput, NativeLibraryOperation, NativeLibraryRecord } from '../types/nativeLibrary';
import { followEntityRedirect } from '../utils/localLibraryIndex';
import { cleanLocalLibraryName, splitLocalLibraryArtistNames } from '../utils/localLibraryNames';

// nativeLibraryValidation.ts — fail closed for damaged native state and untrusted bridge operations.
const invalid = (): never => { throw new Error('invalid-local-library'); };
export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : invalid();
const list = (value: unknown, max = 50000): unknown[] => Array.isArray(value) && value.length <= max ? value : invalid();
const text = (value: unknown, max = 4096, empty = false): string => typeof value === 'string'
  && value.length <= max && (empty || value.trim().length > 0) && !value.includes('\0') ? value : invalid();
const strings = (value: unknown, max = 50000) => list(value, max).map(item => text(item));
const oneOf = (value: unknown, choices: string[]) => typeof value === 'string' && choices.includes(value) ? value : invalid();
const time = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : invalid();
const unique = (values: string[]) => { if (new Set(values).size !== values.length) invalid(); };
const songId = (value: unknown) => {
  const id = text(value, 36);
  if (!/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id)) invalid();
  return id;
};
const origins = ['import', 'auto-match', 'manual-match', 'manual', 'split'];

export function readNativeLibraryInputs(value: unknown): NativeLibraryInput[] {
  const result = list(value).map(item => {
    const input = object(item);
    songId(input.songId); list(input.artistNames, 128).forEach(name => text(name, 512, true));
    if (input.albumName !== undefined) text(input.albumName, 512, true);
    oneOf(input.origin, ['import', 'auto-match', 'manual-match']); text(input.metadataRevision, 128, true);
    const artistNames = [...new Set((input.artistNames as string[]).flatMap(name => input.origin === 'import'
      ? splitLocalLibraryArtistNames(name) : cleanLocalLibraryName(name) ? [cleanLocalLibraryName(name)!] : []))];
    if (artistNames.length > 128) invalid();
    return { songId: input.songId as string, artistNames, albumName: cleanLocalLibraryName(input.albumName as string | undefined),
      origin: input.origin as NativeLibraryInput['origin'], metadataRevision: input.metadataRevision as string };
  });
  unique(result.map(input => input.songId)); return result;
}

export function readNativeLibraryRecord(value: unknown): NativeLibraryRecord {
  if (value === null) return { version: 1, entities: [], assignments: [], sources: [] };
  const record = object(value);
  if (record.version !== 1) invalid();
  const entities = list(record.entities).map(item => {
    const entity = object(item);
    text(entity.id); oneOf(entity.kind, ['artist', 'album']); text(entity.displayName, 512);
    strings(entity.aliases); strings(entity.normalizedAliases); time(entity.createdAt); time(entity.updatedAt);
    if (entity.mergedInto !== undefined) text(entity.mergedInto);
    if (entity.needsReview !== undefined && typeof entity.needsReview !== 'boolean') invalid();
    return entity;
  });
  unique(entities.map(entity => entity.id as string));
  const result = record as unknown as NativeLibraryRecord;
  const byId = new Map(result.entities.map(entity => [entity.id, entity]));
  for (const entity of result.entities) {
    const resolved = followEntityRedirect(entity.id, byId), target = resolved && byId.get(resolved);
    if (!target || target.mergedInto || target.kind !== entity.kind) invalid();
  }
  const requireKind = (id: string, kind: string) => { if (byId.get(id)?.kind !== kind) invalid(); };
  const assignments = list(record.assignments).map(item => {
    const assignment = object(item); songId(assignment.songId);
    const ids = strings(assignment.artistEntityIds, 128); unique(ids); ids.forEach(id => requireKind(id, 'artist'));
    if (assignment.albumEntityId !== undefined) requireKind(text(assignment.albumEntityId), 'album');
    oneOf(assignment.artistOrigin, origins); oneOf(assignment.albumOrigin, origins); time(assignment.updatedAt);
    return assignment;
  });
  unique(assignments.map(assignment => assignment.songId as string));
  const sources = list(record.sources).map(item => {
    const source = object(item); songId(source.songId); text(source.key, 131072); return source;
  });
  unique(sources.map(source => source.songId as string));
  const sourceIds = new Set(sources.map(source => source.songId));
  if (sources.length !== assignments.length || assignments.some(item => !sourceIds.has(item.songId))) invalid();
  return result;
}

export function readNativeLibraryOperation(value: unknown): NativeLibraryOperation {
  const operation = object(value); text(operation.entityId);
  oneOf(operation.type, ['rename', 'merge', 'split', 'move', 'artists']);
  if (operation.type === 'rename' || operation.type === 'split') text(operation.displayName, 512);
  if (operation.type === 'merge') strings(operation.sourceIds);
  if (['split', 'move', 'artists'].includes(operation.type as string)) list(operation.songIds).forEach(songId);
  if (operation.type === 'move') text(operation.targetId);
  if (operation.type === 'artists') {
    oneOf(operation.mode, ['append', 'replace']);
    list(operation.targets, 128).forEach(item => {
      const target = object(item); text(target.displayName, 512);
      if (target.entityId !== undefined) text(target.entityId);
    });
  }
  return operation as NativeLibraryOperation;
}

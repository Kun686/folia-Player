import { describe, expect, it } from 'vitest';
import type { NativeLibraryInput, NativeLibraryOperation, NativeLibraryRecord } from '../../../src/types/nativeLibrary';
import { snapshotJSON, mutateJSON, projectJSON } from '../../../src/mobile/nativeLibraryRuntime';

// nativeLibraryRuntime.test.ts — durable identities, explicit metadata replacement, damaged-state rejection and original edit semantics.
const one = '00000000-0000-0000-0000-000000000001', two = '00000000-0000-0000-0000-000000000002';
const seed = '00000000-0000-0000-0000-000000000099';
const inputs: NativeLibraryInput[] = [one, two].map((songId, index) => ({ songId,
  artistNames: [index ? 'Artist B' : 'Artist A'], albumName: 'Album', origin: 'import', metadataRevision: '' }));
const read = (record: NativeLibraryRecord | null = null, songs = inputs): NativeLibraryRecord =>
  JSON.parse(snapshotJSON(JSON.stringify({ version: 1, record, inputs: songs })));
const edit = (record: NativeLibraryRecord, operation: NativeLibraryOperation, songs = inputs): NativeLibraryRecord =>
  JSON.parse(mutateJSON(JSON.stringify({ version: 1, record, inputs: songs, operation, idSeed: seed, now: 10 })));
const assignment = (record: NativeLibraryRecord, id: string) => record.assignments.find(item => item.songId === id)!;
const display = (record: NativeLibraryRecord, id: string) => record.entities.find(item => item.id === id)!;

describe('native local-library runtime', () => {
  it('uses original import name splitting while preserving structured online artist names and missing tags', () => {
    const imported = read(null, [{ ...inputs[0], artistNames: ['Singer A / Singer B', ''], albumName: '' }]);
    expect(assignment(imported, one).artistEntityIds.map(id => display(imported, id).displayName)).toEqual(['Singer A', 'Singer B']);
    expect(assignment(imported, one).albumEntityId).toBeUndefined();
    const matched = read(null, [{ ...inputs[0], artistNames: ['AC/DC'], origin: 'manual-match' }]);
    expect(assignment(matched, one).artistEntityIds).toHaveLength(1);
    expect(display(matched, assignment(matched, one).artistEntityIds[0]).displayName).toBe('AC/DC');
    expect(assignment(read(null, [{ ...inputs[0], artistNames: [''] }]), one).artistEntityIds).toEqual([]);
  });

  it('creates deterministic initial IDs without a write and does not mutate an input snapshot', () => {
    const initial = read(), before = structuredClone(initial);
    expect(read()).toEqual(initial);
    edit(initial, { type: 'rename', entityId: assignment(initial, one).artistEntityIds[0], displayName: 'Renamed' });
    expect(initial).toEqual(before);
  });

  it('preserves renamed identities and aliases after a restart or unrelated catalog import', () => {
    const initial = read(), id = assignment(initial, one).artistEntityIds[0];
    const renamed = edit(initial, { type: 'rename', entityId: id, displayName: 'Renamed' });
    const restored = read(renamed);
    expect(assignment(restored, one).artistEntityIds).toEqual([id]);
    expect(display(restored, id)).toMatchObject({ displayName: 'Renamed', aliases: ['Artist A', 'Renamed'] });
  });

  it('merges member references and preserves redirected aliases; renaming an old ID follows the redirect', () => {
    const initial = read(), source = assignment(initial, one).artistEntityIds[0], target = assignment(initial, two).artistEntityIds[0];
    const merged = edit(initial, { type: 'merge', entityId: target, sourceIds: [source] });
    expect(assignment(merged, one).artistEntityIds).toEqual([target]);
    expect(display(merged, source).mergedInto).toBe(target);
    const renamed = edit(merged, { type: 'rename', entityId: source, displayName: 'Together' });
    expect(display(renamed, target).displayName).toBe('Together');
    expect(display(renamed, target).aliases).toContain('Artist A');
  });

  it('splits and moves only selected album members, retaining all native song identities', () => {
    const initial = read(), album = assignment(initial, one).albumEntityId!;
    const split = edit(initial, { type: 'split', entityId: album, songIds: [one], displayName: 'Solo' });
    const destination = assignment(split, one).albumEntityId!;
    expect(destination).not.toBe(album);
    expect(assignment(split, one).albumOrigin).toBe('split');
    expect(assignment(split, two).albumEntityId).toBe(album);
    const moved = edit(split, { type: 'move', entityId: destination, targetId: album, songIds: [one] });
    expect(moved.assignments.map(item => item.songId)).toEqual([one, two]);
    expect(assignment(moved, one).albumEntityId).toBe(album);
  });

  it('implements multiple artist targets with explicit append and replace semantics', () => {
    const initial = read(), a = assignment(initial, one).artistEntityIds[0], b = assignment(initial, two).artistEntityIds[0];
    const appended = edit(initial, { type: 'artists', entityId: a, songIds: [one], mode: 'append',
      targets: [{ entityId: b, displayName: 'Artist B' }, { displayName: 'Artist C' }] });
    expect(assignment(appended, one).artistEntityIds.slice(0, 2)).toEqual([a, b]);
    expect(assignment(appended, one).artistEntityIds).toHaveLength(3);
    const replaced = edit(appended, { type: 'artists', entityId: a, songIds: [one], mode: 'replace', targets: [{ displayName: 'Artist D' }] });
    const ids = assignment(replaced, one).artistEntityIds;
    expect(ids).toHaveLength(1); expect(display(replaced, ids[0]).displayName).toBe('Artist D');
    expect(display(replaced, assignment(appended, one).artistEntityIds[2]).displayName).toBe('Artist C');
  });

  it('keeps manual relationships on reads and replays only an explicit changed metadata revision', () => {
    const initial = read(), artist = assignment(initial, one).artistEntityIds[0];
    const split = edit(initial, { type: 'artists', entityId: artist, songIds: [one], mode: 'replace', targets: [{ displayName: 'Solo' }] });
    expect(assignment(read(split), one).artistEntityIds).toEqual(assignment(split, one).artistEntityIds);
    const changed = read(split, inputs.map(input => input.songId === one ? { ...input, metadataRevision: 'restored-import' } : input));
    expect(assignment(changed, one).artistEntityIds).toEqual([artist]);
    expect(assignment(changed, two)).toEqual(assignment(split, two));
  });

  it('removes a deleted song and only its orphaned entity family', () => {
    const initial = read(), source = assignment(initial, one).artistEntityIds[0], target = assignment(initial, two).artistEntityIds[0];
    const merged = edit(initial, { type: 'merge', entityId: target, sourceIds: [source] });
    const kept = read(merged, [inputs[1]]);
    expect(kept.assignments.map(item => item.songId)).toEqual([two]);
    expect(display(kept, source).mergedInto).toBe(target);
    expect(read(kept, []).entities).toEqual([]);
  });

  it('rejects stale members, missing targets, invalid modes and cross-kind merges without changing state', () => {
    const initial = read(), artist = assignment(initial, one).artistEntityIds[0], album = assignment(initial, one).albumEntityId!;
    const before = structuredClone(initial);
    expect(() => edit(initial, { type: 'split', entityId: artist, songIds: [two], displayName: 'Wrong' })).toThrow();
    expect(() => edit(initial, { type: 'merge', entityId: artist, sourceIds: ['missing'] })).toThrow();
    expect(() => edit(initial, { type: 'merge', entityId: artist, sourceIds: [album] })).toThrow();
    expect(() => edit(initial, { type: 'artists', entityId: artist, songIds: [one], targets: [{ displayName: 'D' }], mode: 'invalid' as 'append' })).toThrow();
    expect(initial).toEqual(before);
  });

  it('updates one matched field without discarding the other manually split field', () => {
    const initial = read(), artist = assignment(initial, one).artistEntityIds[0], album = assignment(initial, one).albumEntityId!;
    const split = edit(edit(initial, { type: 'split', entityId: album, songIds: [one], displayName: 'Solo album' }),
      { type: 'artists', entityId: artist, songIds: [one], mode: 'replace', targets: [{ displayName: 'Solo singer' }] });
    const updated = inputs.map(input => input.songId === one ? { ...input, artistNames: ['AC/DC'],
      artistOrigin: 'manual-match' as const, artistRevision: 'artist-only' } : input);
    const changed = read(split, updated);
    expect(assignment(changed, one).albumEntityId).toBe(assignment(split, one).albumEntityId);
    expect(assignment(changed, one).albumOrigin).toBe('split');
    expect(display(changed, assignment(changed, one).artistEntityIds[0]).displayName).toBe('AC/DC');
    expect(assignment(changed, two)).toEqual(assignment(split, two));
    expect(read(changed, updated)).toEqual(changed);
  });

  it('projects renamed artist/album while retaining original tags, cover and native identity', () => {
    const initial = read(), artist = assignment(initial, one).artistEntityIds[0];
    const record = edit(initial, { type: 'rename', entityId: artist, displayName: 'Renamed' });
    const base = { id: one, name: 'Original', artists: [{ name: 'Artist A', id: '' }], album: { name: 'Album', id: '', coverUrl: 'cover' },
      durationMs: 1000, sourceRef: { kind: 'local', mediaId: one } };
    const projected = JSON.parse(projectJSON(JSON.stringify({ record, songs: [base], bases: [base], documents: {} })));
    expect(projected.songs[0]).toMatchObject({ id: one, artists: [{ name: 'Renamed', entityId: artist }],
      album: { name: 'Album', coverUrl: 'cover' }, sourceRef: base.sourceRef });
    expect(projected.songs[0].localRef).toBeUndefined();
    expect(projected.editorSongs[0].importedMetadata.artistNames).toEqual(['Artist A']);
  });

  it('rejects corrupt documents, redirect cycles and duplicate native IDs instead of recreating empty state', () => {
    const initial = read();
    expect(() => read({ ...initial, version: 2 } as unknown as NativeLibraryRecord)).toThrow();
    expect(() => read({ ...initial, sources: [] })).toThrow();
    expect(() => read(null, [inputs[0], inputs[0]])).toThrow();
    const cycle = structuredClone(initial), [a, b] = cycle.entities.filter(entity => entity.kind === 'artist');
    a.mergedInto = b.id; b.mergedInto = a.id;
    expect(() => read(cycle)).toThrow();
    expect(() => read({ ...initial, assignments: [{ ...initial.assignments[0], albumEntityId: 'missing' }] })).toThrow();
  });
});

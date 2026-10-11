import { describe, expect, it } from 'vitest';
import { directoryJSON, planJSON } from '../../../src/mobile/nativeFolderRuntime';
import type { NativeFolderPlan } from '../../../src/types/nativeFolder';

// nativeFolderRuntime.test.ts — original ignore and sidecar semantics survive the native JSON boundary.
const entry = (name: string, directory = false) => ({ name, directory });
const directory = (request: Record<string, unknown>) => JSON.parse(directoryJSON(JSON.stringify({
  path: '', entries: [], rules: [], ignoredPaths: [], ...request,
}))).entries as Array<{ path: string; ignored: boolean }>;
const file = (path: string, modified = 1) => ({ path, modified, size: 4 });
const plan = (paths: string[], extra = {}): NativeFolderPlan => JSON.parse(planJSON(JSON.stringify({ files: paths.map(path => file(path)), ...extra })));

describe('native folder scan rules', () => {
  it('inherits ignore rules, honors child negation and keeps only manually ignored nodes', () => {
    const rules = [{ path: '', content: 'cache/\n*.mp3\n' }, { path: 'disc', content: '!keep.mp3' }];
    expect(directory({ path: 'disc', rules, entries: [entry('keep.mp3'), entry('skip.mp3'), entry('cache', true),
      entry('removed', true), entry('cover.png'), entry('.foliaignore'), entry('notes.txt')], ignoredPaths: ['disc/removed'] }))
      .toEqual([{ name: 'cover.png', directory: false, path: 'disc/cover.png', ignored: false, kind: 'cover' },
        { name: 'keep.mp3', directory: false, path: 'disc/keep.mp3', ignored: false, kind: 'audio' },
        { name: 'removed', directory: true, path: 'disc/removed', ignored: true, kind: 'directory' }]);
  });
  it('keeps anchored and escaped patterns and rejects invalid or duplicate paths', () => {
    expect(directory({ rules: [{ path: '', content: '/root.mp3\n\\#hidden.mp3' }], entries: [entry('root.mp3'), entry('#hidden.mp3'), entry('nested', true)] })
      .map(item => item.path)).toEqual(['nested']);
    for (const name of ['../escape.mp3', '/escape.mp3', 'a\\b.mp3', '.', '', 'bad\0.mp3'])
      expect(() => directory({ entries: [entry(name)] })).toThrow();
    expect(() => directory({ entries: [entry('same'), entry('same', true)] })).toThrow();
    expect(() => directory({ path: 'a', rules: [{ path: 'b', content: '*' }] })).toThrow();
  });
  it('classifies original Ogg/Opus/fallback candidates without claiming decoder support', () => {
    expect(directory({ entries: ['song.OGG', 'song.opus', 'song.aiff', 'song.mp4'].map(name => entry(name)) })).toHaveLength(4);
  });
  it('selects FIA, translations, double extensions and the original folder cover priority', () => {
    const result = plan(['a/track.mp3', 'a/track.flac', 'a/track.lrc', 'a/track.mp3.fia', 'a/track.t.vtt',
      'a/cover.jpg', 'a/cover.png', 'b/track.mp4', 'b/track.mp4.lrc']);
    expect(result.tracks[0]).toMatchObject({ lyric: 'a/track.mp3.fia', translation: 'a/track.t.vtt', cover: 'a/cover.png' });
    expect(result.tracks[1]).toMatchObject({ lyric: 'a/track.mp3.fia', cover: 'a/cover.png' });
    expect(result.tracks[2]).toMatchObject({ lyric: 'b/track.mp4.lrc' });
    expect(result.changed).toHaveLength(3);
  });
  it('does not depend on JSON object key order after Foundation serialization', () => {
    const paths = ['song.mp3', 'song.lrc'];
    const first = plan(paths);
    const reordered = first.tracks.map(track => Object.fromEntries(Object.entries(track).reverse()));
    expect(plan(paths, { previous: reordered }).changed).toEqual([]);
  });
  it('ranks configured formats, retaining the unchanged sidecar bytes signature', () => {
    const paths = ['track.mp3', 'track.lrc', 'track.yrc'];
    const first = plan(paths), next = plan(paths, { previous: first.tracks, lyricFormatOrder: ['yrc', 'lrc'] });
    expect(next.changed).toEqual(['track.mp3']);
    expect(next.tracks[0].lyric).toBe('track.yrc');
    expect(next.tracks[0].sidecarSignature).toBe(first.tracks[0].sidecarSignature);
  });
  it('detects sidecar changes/removal and root-local audio removal without changing audio signatures', () => {
    const paths = ['a/song.mp3', 'a/song.lrc', 'b/song.mp3', 'b/cover.jpg'];
    const first = plan(paths);
    const next = plan([], { files: [file('a/song.mp3'), file('a/song.lrc', 2)], previous: first.tracks });
    expect(next.changed).toEqual(['a/song.mp3']); expect(next.removed).toEqual(['b/song.mp3']);
    expect(next.tracks[0].audioSignature).toBe(first.tracks[0].audioSignature);
    expect(plan(['a/song.mp3'], { previous: next.tracks }).changed).toEqual(['a/song.mp3']);
  });
  it('updates only songs in the directory whose winning cover changes', () => {
    const paths = ['a/song.mp3', 'a/cover.png', 'a/cover.jpg', 'b/song.mp3'];
    const first = plan(paths), next = plan(paths.filter(path => path !== 'a/cover.png'), { previous: first.tracks });
    expect(next.changed).toEqual(['a/song.mp3']); expect(next.tracks[0].cover).toBe('a/cover.jpg');
  });
  it('rejects incomplete, duplicate and invalid persisted input instead of returning deletions', () => {
    for (const files of [[file('../escape.mp3')], [file('a.mp3'), file('a.mp3')], [{ ...file('a.mp3'), size: -1 }]])
      expect(() => plan([], { files })).toThrow();
    expect(() => plan([], { previous: [{ path: 'lost.mp3' }] })).toThrow();
    expect(() => plan([], { files: undefined })).toThrow();
  });
});

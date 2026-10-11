import type { NativeFolderFile, NativeFolderPlan, NativeFolderTrack } from '../types/nativeFolder';
import { createFoliaIgnoreMatcher, isIgnoredByFoliaMatchers } from '../utils/foliaIgnore';
import { KNOWN_AUDIO_EXTENSIONS, classifyLocalFile, getAudioBasePath, getFolderCoverPriority,
  getParentRelativePath, getSidecarLyricBasePath } from '../utils/localFileRules';
import { getLocalLyricFilePriority, normalizeLocalLyricFormatOrder } from '../utils/lyrics/localLyricFormatOrder';
import { entries, files, invalid, list, object, path, previous, rules } from './nativeFolderValidation';

// nativeFolderRuntime.ts — original ignore, naming and priority rules, independent of DOM or directory permissions.
export const protocolVersion = 1;
const audio = (name: string) => KNOWN_AUDIO_EXTENSIONS.test(name) || /\.mp4$/i.test(name);
export function directoryJSON(request: string): string {
  const value = object(JSON.parse(request)), base = path(value.path, true);
  const inherited = rules(value.rules);
  if (inherited.some(rule => rule.path && base !== rule.path && !base.startsWith(rule.path + '/'))) invalid();
  const matchers = inherited.map(rule => createFoliaIgnoreMatcher(rule.content, rule.path));
  const ignored = list(value.ignoredPaths).map(item => path(item));
  const result = entries(value.entries).sort((a, b) => a.name.localeCompare(b.name)).flatMap(entry => {
    const relative = base ? base + '/' + entry.name : entry.name;
    if (entry.name === '.foliaignore') return [];
    // Manual removal takes precedence over on-disk negation and retains a restorable tree node.
    if (ignored.some(item => relative === item || relative.startsWith(item + '/'))) {
      return entry.directory ? [{ ...entry, path: relative, ignored: true, kind: 'directory' }] : [];
    }
    if (isIgnoredByFoliaMatchers(matchers, relative, entry.directory)) return [];
    const kind = entry.directory ? 'directory' : classifyLocalFile(entry.name, audio);
    return kind === 'other' ? [] : [{ ...entry, path: relative, ignored: false, kind }];
  });
  return JSON.stringify({ entries: result });
}

// Each media dependency has a separate signature: changing lyric priority must not overwrite uploaded lyrics.
export function planJSON(request: string): string {
  const value = object(JSON.parse(request)), order = normalizeLocalLyricFormatOrder(value.lyricFormatOrder);
  const input = files(value.files).sort((a, b) => a.path.localeCompare(b.path));
  const old = new Map(previous(value.previous).map(track => [track.path, track]));
  const lyrics = new Map<string, NativeFolderFile[]>(), translations = new Map<string, NativeFolderFile[]>();
  const covers = new Map<string, NativeFolderFile[]>(), tracks: NativeFolderTrack[] = [];
  const put = (map: Map<string, NativeFolderFile[]>, key: string, file: NativeFolderFile) => {
    const group = map.get(key) ?? []; group.push(file); map.set(key, group);
  };
  for (const file of input) {
    const kind = classifyLocalFile(file.path.split('/').at(-1)!, audio);
    if (kind === 'lyric' || kind === 'translationLyric') {
      put(kind === 'lyric' ? lyrics : translations, getSidecarLyricBasePath(file.path, kind, /\.mp4$/i), file);
    } else if (kind === 'cover') put(covers, getParentRelativePath(file.path), file);
  }
  const signature = (files: NativeFolderFile[]) => JSON.stringify(files.map(file => [file.path, file.size, file.modified]));
  const pick = (files: NativeFolderFile[]) => files.slice().sort((a, b) =>
    getLocalLyricFilePriority(a.path, order) - getLocalLyricFilePriority(b.path, order))[0]?.path;
  for (const file of input.filter(file => audio(file.path))) {
    const base = getAudioBasePath(file.path, /\.mp4$/i);
    const local = lyrics.get(base) ?? [], translated = translations.get(base) ?? [];
    const images = covers.get(getParentRelativePath(file.path)) ?? [];
    const cover = images.slice().sort((a, b) => getFolderCoverPriority(a.path.split('/').at(-1)!)
      - getFolderCoverPriority(b.path.split('/').at(-1)!))[0];
    tracks.push({ path: file.path, audioSignature: signature([file]),
      sidecarSignature: signature([...local, ...translated]), coverSignature: signature(cover ? [cover] : []),
      lyric: pick(local), translation: pick(translated), cover: cover?.path });
  }
  const current = new Set(tracks.map(track => track.path));
  const plan: NativeFolderPlan = { version: 1, tracks,
    changed: tracks.filter(track => {
      const prior = old.get(track.path);
      return !prior || (['audioSignature', 'sidecarSignature', 'coverSignature', 'lyric', 'translation', 'cover'] as const)
        .some(key => track[key] !== prior[key]);
    }).map(track => track.path),
    removed: [...old.keys()].filter(path => !current.has(path)) };
  return JSON.stringify(plan);
}

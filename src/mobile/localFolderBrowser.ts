import type { NativeFolderCatalog } from '../types/nativeFolder';
import type { SongResult } from '../types';

// localFolderBrowser.ts — compute only the selected scope; never allocate a song array for every ancestor directory.
export interface FolderScope { rootID: string; path: string }
export interface FolderChoice extends FolderScope { name: string; count: number; ignored: boolean }
const parent = (path: string) => path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
export function localFolderView(catalog: NativeFolderCatalog | undefined, allSongs: SongResult[], scope: FolderScope | null) {
  const roots = catalog?.roots ?? [], root = roots.find(item => item.id === scope?.rootID);
  const path = scope?.path ?? '';
  const rootChoices: FolderChoice[] = roots.map(root => ({ rootID: root.id, path: '', name: root.name, count: root.tracks.length, ignored: false }));
  if (!root) return { root: undefined, path: '', choices: rootChoices, songs: [], ignored: false };
  const counts = new Map<string, number>(), ids = new Set<string>();
  for (const track of root.tracks) {
    if (!path || track.path.startsWith(path + '/')) ids.add(track.id);
    let directory = parent(track.path);
    while (directory) { counts.set(directory, (counts.get(directory) ?? 0) + 1); directory = parent(directory); }
  }
  const directories = new Map(root.directories.map(node => [node.path, node]));
  // Keep manually ignored missing directories restorable even when the source no longer lists them.
  for (const ignored of root.ignoredPaths) {
    let directory = ignored;
    while (directory) {
      if (!directories.has(directory)) directories.set(directory, { path: directory, ignored: root.ignoredPaths.includes(directory) });
      directory = parent(directory);
    }
  }
  const choices: FolderChoice[] = [...directories.values()].filter(node => parent(node.path) === path).map(node => ({
    rootID: root.id, path: node.path, name: node.path.split('/').at(-1)!, count: counts.get(node.path) ?? 0, ignored: node.ignored,
  })).sort((a, b) => a.name.localeCompare(b.name));
  return { root, path, choices, songs: allSongs.filter(song => song.sourceRef?.kind === 'local' && ids.has(song.sourceRef.mediaId)),
    ignored: root.ignoredPaths.some(ignored => path === ignored || path.startsWith(ignored + '/')) };
}
export function parentFolderScope(scope: FolderScope): FolderScope | null {
  return scope.path ? { rootID: scope.rootID, path: parent(scope.path) } : null;
}

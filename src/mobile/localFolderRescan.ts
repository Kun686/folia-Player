import type { FoliaNativePlugin } from './bridge';
import type { NativeFolderBatchProgress, NativeFolderBatchResult, NativeFolderImportOptions } from '../types/nativeFolder';
import { importLocalFolder } from './localFolderImport';

// localFolderRescan.ts — original sequential all-root rescan, using the existing native transaction per root.
type Bridge = Parameters<typeof importLocalFolder>[0] & Pick<FoliaNativePlugin, 'readLocalFolders'>;
export async function rescanLocalFolders(bridge: Bridge, order: NativeFolderImportOptions['order'], signal: AbortSignal,
  progress: (value: NativeFolderBatchProgress) => void): Promise<NativeFolderBatchResult> {
  signal.throwIfAborted();
  const catalog = await bridge.readLocalFolders();
  signal.throwIfAborted();
  // Read roots rather than songs: empty and entirely ignored imported roots must also be rescanned.
  const roots = [...new Map(catalog.roots.map(root => [root.id, { id: root.id, name: root.name }])).values()];
  const result: NativeFolderBatchResult = { total: roots.length, completed: [], status: 'complete' };
  const formatOrder = order?.slice();
  for (const root of roots) {
    if (signal.aborted) { result.status = 'cancelled'; break; }
    const current = { total: roots.length, completed: result.completed.length, root };
    progress(current);
    try {
      const next = await importLocalFolder(bridge, { token: crypto.randomUUID(), rootID: root.id, pick: false, order: formatOrder },
        signal, track => progress({ ...current, track }));
      if (!next) { result.status = 'cancelled'; break; }
      result.completed.push({ ...next, name: root.name });
      // A completed native commit remains visible if cancellation arrives at the same instant.
      if (signal.aborted && result.completed.length < result.total) { result.status = 'cancelled'; break; }
    } catch (cause) {
      if (signal.aborted || (cause instanceof Error && (cause.name === 'AbortError' || cause.message === 'folder-cancelled'))) {
        result.status = 'cancelled';
      } else {
        result.status = 'failed';
        result.failed = { ...root, code: cause instanceof Error ? cause.message : 'folder-import-failed' };
      }
      break;
    }
  }
  return result;
}

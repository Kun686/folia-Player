import type { FoliaNativePlugin } from './bridge';
import type { NativeFolderImportOptions, NativeFolderProgress } from '../types/nativeFolder';
import { decodeNativeFolderLyrics, type NativeFolderLyricContents } from './nativeFolderLyrics';

// localFolderImport.ts — backpressure keeps only one track's sidecar bytes in the WebView at a time.
type Bridge = Pick<FoliaNativePlugin, 'beginFolderImport' | 'readFolderImport' | 'prepareFolderImport' | 'finishFolderImport' | 'cancelFolderImport'>;
export async function importLocalFolder(bridge: Bridge, options: NativeFolderImportOptions,
  signal: AbortSignal, progress: (value: NativeFolderProgress) => void) {
  let committed = false;
  const cancel = () => { void bridge.cancelFolderImport({ token: options.token }).catch(() => undefined); };
  const check = () => signal.throwIfAborted();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    check();
    const start = await bridge.beginFolderImport(options);
    check();
    if ('cancelled' in start) return null;
    if (start.token !== options.token || start.completed !== 0 || !Number.isSafeInteger(start.total) || start.total < 0 || start.total > 50_000) {
      throw new Error('folder-progress-changed');
    }
    progress(start);
    for (let index = 0; index < start.total; index++) {
      check();
      const files = await bridge.readFolderImport({ token: options.token, index });
      check();
      const contents: NativeFolderLyricContents = {}, skipped: ('lyric' | 'translation')[] = [];
      for (const key of ['lyric', 'translation'] as const) {
        if (files[key] === undefined) continue;
        try { Object.assign(contents, await decodeNativeFolderLyrics({ [key]: files[key] }, signal)); }
        catch { check(); skipped.push(key); }
      }
      check();
      const next = await bridge.prepareFolderImport({ token: options.token, index, contents, skipped });
      check();
      if (next.token !== options.token || next.completed !== index + 1 || next.total !== start.total) throw new Error('folder-progress-changed');
      progress(next);
    }
    check();
    const result = await bridge.finishFolderImport({ token: options.token });
    // Native commit wins a race with cancellation; callers must refresh the catalog even if their view is now hidden.
    committed = true;
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    if (!committed) await bridge.cancelFolderImport({ token: options.token }).catch(() => undefined);
  }
}

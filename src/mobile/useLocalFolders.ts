import { useCallback, useEffect, useRef, useState } from 'react';
import type { NativeFolderCatalog, NativeFolderImportOptions, NativeFolderImportResult, NativeFolderProgress } from '../types/nativeFolder';
import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { isNative, native } from './bridge';
import { importLocalFolder } from './localFolderImport';

// useLocalFolders.ts — one cancellable foreground import; retain the last good catalog on refresh failures.
export function useLocalFolders() {
  const [catalog, setCatalog] = useState<NativeFolderCatalog>();
  const [progress, setProgress] = useState<NativeFolderProgress>();
  const [result, setResult] = useState<NativeFolderImportResult>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [canCancel, setCanCancel] = useState(false);
  const active = useRef(false), controller = useRef<AbortController | undefined>(undefined), locked = useRef(false), sequence = useRef(0);
  const refresh = useCallback(async () => {
    const ticket = ++sequence.current;
    try {
      const next = await native.readLocalFolders();
      if (active.current && ticket === sequence.current) setCatalog(next);
    } catch { if (active.current && ticket === sequence.current) setError('folder-unavailable'); }
  }, []);
  const cancel = useCallback(() => controller.current?.abort(), []);
  useEffect(() => {
    active.current = true;
    if (isNative) void refresh();
    const listener = isNative ? native.addListener('localCatalog', () => { void refresh(); }) : undefined;
    window.addEventListener('pagehide', cancel);
    return () => {
      active.current = false; sequence.current++; cancel(); window.removeEventListener('pagehide', cancel);
      void listener?.then(handle => handle.remove()).catch(() => undefined);
    };
  }, [refresh, cancel]);
  const run = async (work: (signal: AbortSignal) => Promise<void>, cancellable = true) => {
    if (locked.current) return;
    locked.current = true; setBusy(true); setError(''); setResult(undefined); setProgress(undefined);
    setCanCancel(cancellable);
    const current = new AbortController(); controller.current = current;
    try { await work(current.signal); }
    catch (cause) {
      if (active.current && !current.signal.aborted) setError(cause instanceof Error ? cause.message : 'folder-import-failed');
    } finally {
      // Cancellation can race the native commit. Read authoritative state either way.
      await refresh(); locked.current = false;
      if (controller.current === current) controller.current = undefined;
      if (active.current) { setBusy(false); setCanCancel(false); setProgress(undefined); }
    }
  };
  const start = (options: Omit<NativeFolderImportOptions, 'token' | 'order'> = {}) => run(async signal => {
    const next = await importLocalFolder(native, { ...options, token: crypto.randomUUID(),
      order: useLyricSettingsStore.getState().localLyricFormatOrder }, signal, value => { if (active.current) setProgress(value); });
    if (active.current && next) setResult(next);
  });
  const remove = (rootID: string) => run(async () => {
    if (!catalog) throw new Error('folder-unavailable');
    await native.removeLocalFolder({ rootID, revision: catalog.revision });
  }, false);
  return { catalog, busy, canCancel, progress, result, error, start, cancel, remove, refresh };
}
export type LocalFolders = ReturnType<typeof useLocalFolders>;

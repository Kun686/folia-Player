import { useCallback, useEffect, useRef, useState } from 'react';
import type { SongResult } from '../types';
import type { NativeLibrarySnapshot } from '../types/nativeLibrary';
import { native, isNative } from './bridge';

// useLocalCatalog.ts — complete entity snapshots; stale async responses cannot overwrite newer catalogs.
export function useLocalCatalog() {
  const [songs, setSongs] = useState<SongResult[]>([]);
  const [snapshot, setSnapshot] = useState<NativeLibrarySnapshot>();
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const sequence = useRef(0), active = useRef(false), lock = useRef(false);
  const refresh = useCallback(async () => {
    const request = ++sequence.current;
    const current = () => active.current && sequence.current === request;
    try {
      const value = await native.readLocalLibrary();
      if (!value?.revision) throw new Error('local-library-unavailable');
      if (current()) { setSongs(value.songs); setSnapshot(value); setError(''); }
    } catch {
      // Keep playable files accessible, but never permit entity editing against an incomplete snapshot.
      try {
        const value = await native.localCatalog();
        if (current()) { setSongs(value.songs); setSnapshot(undefined); setError('local-library-unavailable'); }
      } catch { if (current()) setError('local-library-unavailable'); }
    }
  }, []);
  useEffect(() => {
    active.current = true;
    const listener = isNative ? native.addListener('localCatalog', () => { void refresh(); }) : undefined;
    if (isNative) void refresh();
    return () => { active.current = false; ++sequence.current; void listener?.then(handle => handle.remove()).catch(() => undefined); };
  }, [refresh]);
  const work = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError('');
    try { await action(); }
    catch { if (active.current) setError('local-library-unavailable'); }
    finally { lock.current = false; if (active.current) setBusy(false); }
  };
  const importAudio = () => work(async () => {
    const result = await native.importAudio();
    if (!result.cancelled) await refresh();
    if (result.failures?.length && active.current) setError(result.failures.map(file => `${file.name} (${file.code})`).join(' · '));
  });
  const remove = (song: SongResult) => work(async () => {
    if (song.sourceRef?.kind !== 'local') return;
    await native.removeLocal({ id: song.sourceRef.mediaId }); await refresh();
  });
  return { songs, snapshot, busy, error, importAudio, remove, refresh };
}

import { useEffect, useState } from 'react';
import type { SongResult } from '../types';
import { native, isNative } from './bridge';

// src/mobile/useLocalCatalog.ts — native owns durable files; the UI keeps only catalog metadata.
export function useLocalCatalog() {
  const [songs, setSongs] = useState<SongResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const refresh = () => native.localCatalog().then(value => { if (active) setSongs(value.songs); })
      .catch(() => { if (active) setError('local-library-unavailable'); });
    const listener = isNative ? native.addListener('localCatalog', () => { void refresh(); }) : undefined;
    if (isNative) void refresh();
    return () => { active = false; void listener?.then(handle => handle.remove()).catch(() => undefined); };
  }, []);
  const importAudio = async () => {
    setBusy(true); setError('');
    try {
      const result = await native.importAudio();
      if (!result.cancelled) setSongs((await native.localCatalog()).songs);
      if (result.failures?.length) setError(result.failures.map(file => `${file.name} (${file.code})`).join(' · '));
    } catch { setError('import-failed'); }
    finally { setBusy(false); }
  };
  const remove = async (song: SongResult) => {
    if (song.sourceRef?.kind !== 'local') return;
    setBusy(true); setError('');
    try { await native.removeLocal({ id: song.sourceRef.mediaId }); setSongs((await native.localCatalog()).songs); }
    catch { setError('local-remove-failed'); }
    finally { setBusy(false); }
  };
  return { songs, busy, error, importAudio, remove };
}

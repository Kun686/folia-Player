import { useEffect, useState } from 'react';
import { native } from './bridge';
import { connectNativeModels, type NativeModelsState, type ModelsPort } from './nativeModels';

// useNativeModels.ts — subscribe while settings are open; model work itself belongs to the native player.
export function useNativeModels(open: boolean, port: ModelsPort = native) {
  const [state, setState] = useState<NativeModelsState>();
  const [readError, setReadError] = useState(false), [actionError, setActionError] = useState(false), [attempt, setAttempt] = useState(0);
  const [importing, setImporting] = useState(false), [removing, setRemoving] = useState(false);
  useEffect(() => {
    if (!open) return;
    const connection = connectNativeModels(port, value => { setState(value); setReadError(false); }, () => setReadError(true));
    return connection.dispose;
  }, [open, port, attempt]);
  const run = async (action: () => Promise<unknown>) => {
    setActionError(false);
    try { await action(); setAttempt(value => value + 1); }
    catch { setActionError(true); }
  };
  return { state, error: readError || actionError, importing, removing,
    retry: () => { setActionError(false); setReadError(false); setAttempt(value => value + 1); },
    download: (name: string) => { if (name === 'beat_this' || name === 'htdemucs') void run(() => port.downloadModel({ name })); },
    cancel: (name: string) => { if (name === 'beat_this' || name === 'htdemucs') void run(() => port.cancelModel({ name })); },
    importFile: async () => { setImporting(true); try { await run(() => port.importModel()); } finally { setImporting(false); } },
    removeAll: async () => { setRemoving(true); try { await run(() => port.removeModels()); } finally { setRemoving(false); } },
  };
}

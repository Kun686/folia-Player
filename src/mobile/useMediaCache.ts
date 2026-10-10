import { useEffect, useState } from 'react';
import { isNative, native, type NativeMediaCacheState } from './bridge';
import { connectMediaCacheSettings } from './mediaCacheSettingsSync';

// useMediaCache.ts — event-driven native catalog; no background polling or per-frame React updates.
export function useMediaCache() {
  const [ready, setReady] = useState(false), [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<NativeMediaCacheState>();
  useEffect(() => {
    if (!isNative) return;
    let disposed = false, serial = 0;
    const refresh = () => {
      const stamp = ++serial;
      void native.mediaCacheState().then(value => {
        if (!disposed && stamp === serial) setState(value);
      }).catch(() => { if (!disposed && stamp === serial) setError(true); });
    };
    const stop = connectMediaCacheSettings((ready, error) => { setReady(ready); setError(error); refresh(); });
    const listener = native.addListener('mediaCache', refresh);
    void listener.catch(() => { if (!disposed) setError(true); });
    const foreground = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', foreground);
    refresh();
    return () => {
      disposed = true; stop(); document.removeEventListener('visibilitychange', foreground);
      void listener.then(handle => handle.remove()).catch(() => {});
    };
  }, [attempt]);
  return { ready, error, state, retry: () => setAttempt(value => value + 1) };
}

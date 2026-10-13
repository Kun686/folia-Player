import { useEffect, useRef, useState } from 'react';
import { isNative, native, type NativeMediaCacheState } from './bridge';
import { connectMediaCacheSettings } from './mediaCacheSettingsSync';

// useMediaCache.ts — event-driven native catalog; no background polling or per-frame React updates.
export function useMediaCache() {
  const [ready, setReady] = useState(false), [settingsError, setSettingsError] = useState(false);
  const [readError, setReadError] = useState(false), [listenerError, setListenerError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<NativeMediaCacheState>();
  const refreshCurrent = useRef<() => void>(() => {});
  useEffect(() => {
    if (!isNative) return;
    let disposed = false, serial = 0;
    setReady(false); setSettingsError(false); setReadError(false); setListenerError(false);
    const refresh = () => {
      const stamp = ++serial;
      void native.mediaCacheState().then(value => {
        // A recovered catalog read must not hide a failed settings write or event subscription.
        if (!disposed && stamp === serial) { setState(value); setReadError(false); }
      }).catch(() => { if (!disposed && stamp === serial) setReadError(true); });
    };
    refreshCurrent.current = refresh;
    const stop = connectMediaCacheSettings((ready, error) => { setReady(ready); setSettingsError(error); refresh(); });
    const listener = native.addListener('mediaCache', refresh);
    void listener.catch(() => { if (!disposed) setListenerError(true); });
    const foreground = () => { if (!document.hidden) refresh(); };
    document.addEventListener('visibilitychange', foreground);
    refresh();
    return () => {
      disposed = true; refreshCurrent.current = () => {}; stop(); document.removeEventListener('visibilitychange', foreground);
      void listener.then(handle => handle.remove()).catch(() => {});
    };
  }, [attempt]);
  // Retry only the failed catalog read once settings are loaded; reconnecting could replace an in-flight edit.
  return { ready, error: settingsError || readError || listenerError, state, canRetry: readError || (!ready && settingsError),
    retry: () => { if (ready) refreshCurrent.current(); else setAttempt(value => value + 1); } };
}

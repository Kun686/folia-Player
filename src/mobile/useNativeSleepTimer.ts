import { useCallback, useEffect, useRef, useState } from 'react';
import { native, isNative, type NativeSleepTimerState, type NativeSleepTimerEdit } from './bridge';
import { createSleepTimerSync } from './sleepTimerSync';

// useNativeSleepTimer.ts — mounted with the App, so closing settings never loses a queued action.
export function useNativeSleepTimer() {
  const [status, setStatus] = useState<{ value: NativeSleepTimerState | null; error: boolean }>({ value: null, error: false });
  const controller = useRef<ReturnType<typeof createSleepTimerSync> | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!isNative) return;
    const sync = createSleepTimerSync({ load: () => native.getSleepTimer(), save: edit => native.setSleepTimer({ edit }) },
      (value, error) => setStatus({ value, error }));
    controller.current = sync;
    const subscription = native.addListener('sleepTimer', sync.receive);
    let disposed = false, subscribed = false;
    void subscription.then(() => { subscribed = true; if (!disposed) return sync.refresh(); }).catch(() => {
      if (!disposed) setStatus({ value: null, error: true });
    });
    const visible = () => { if (subscribed && !document.hidden) void sync.refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => {
      disposed = true; sync.dispose(); controller.current = null;
      document.removeEventListener('visibilitychange', visible);
      void subscription.then(handle => handle.remove()).catch(() => {});
    };
  }, [attempt]);
  const change = useCallback((edit: NativeSleepTimerEdit) => controller.current?.change(edit), []);
  const refresh = useCallback(() => { setStatus({ value: null, error: false }); setAttempt(value => value + 1); }, []);
  return { ...status, change, refresh };
}

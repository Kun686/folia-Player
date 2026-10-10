// src/mobile/nativeSettingsSync.ts — serialize store edits and restore native state without feedback writes.
export function connectNativeSettings<T>(port: {
  load: () => Promise<T>; save: (value: T) => Promise<T>; apply: (value: T) => void;
  subscribe: (changed: (value: T) => void) => () => void;
}, report: (ready: boolean, error: boolean) => void) {
  let disposed = false, writingStore = false, draining = false;
  let accepted: T | undefined, pending: T | undefined;
  let unsubscribe = () => {};
  const apply = (value: T) => {
    writingStore = true;
    try { port.apply(value); } finally { writingStore = false; }
  };
  // Coalesce edits while a bridge call is in flight. Old replies cannot undo a newer gesture.
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (pending !== undefined && !disposed) {
        const next = pending; pending = undefined;
        try {
          accepted = await port.save(next);
          if (!disposed && pending === undefined) report(true, false);
        } catch {
          if (!disposed && pending === undefined && accepted !== undefined) { apply(accepted); report(true, true); }
        }
      }
    } finally { draining = false; }
  };
  void port.load().then(value => {
    if (disposed) return;
    accepted = value; apply(value); report(true, false);
    unsubscribe = port.subscribe(value => {
      if (writingStore) return;
      pending = value; void drain();
    });
  }).catch(() => { if (!disposed) report(false, true); });
  return () => { disposed = true; unsubscribe(); };
}

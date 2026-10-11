import type { NativeSleepTimerState, NativeSleepTimerEdit } from './bridge';

// sleepTimerSync.ts — serial partial actions; native expiry cannot be undone by a stale duration edit.
export function createSleepTimerSync(port: {
  load: () => Promise<NativeSleepTimerState>;
  save: (edit: NativeSleepTimerEdit) => Promise<NativeSleepTimerState>;
}, report: (value: NativeSleepTimerState | null, error: boolean) => void) {
  let disposed = false, error = false, accepted: NativeSleepTimerState | null = null;
  let pending: NativeSleepTimerEdit | null = null, writing: NativeSleepTimerEdit | null = null;
  const publish = () => {
    if (!disposed) report(accepted ? { ...accepted, ...writing, ...pending } : null, error);
  };
  const receive = (value: NativeSleepTimerState) => {
    if (disposed || (accepted && value.revision < accepted.revision)) return;
    accepted = value; publish();
  };
  const refresh = async () => {
    try { const value = await port.load(); error = false; receive(value); }
    catch { error = true; publish(); }
  };
  // Duration patches never carry an implicit enabled=true from the rendered snapshot.
  const drain = async () => {
    if (writing) return;
    while (pending && !disposed) {
      writing = pending; pending = null;
      try { const value = await port.save(writing); error = false; receive(value); }
      catch { error = true; }
      writing = null; publish();
    }
  };
  return {
    refresh, receive,
    change(edit: NativeSleepTimerEdit) {
      if (disposed || !accepted) return;
      pending = { ...pending, ...edit }; error = false; publish(); void drain();
    },
    dispose() { disposed = true; pending = null; },
  };
}

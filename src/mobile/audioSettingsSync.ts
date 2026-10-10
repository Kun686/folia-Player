import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { native, type NativeAudioSettings } from './bridge';

// src/mobile/audioSettingsSync.ts — one ordered native writer for the original store and command actions.
export function connectAudioSettings(report: (ready: boolean, error: boolean) => void) {
  let disposed = false, writingStore = false, draining = false;
  let accepted: NativeAudioSettings | undefined, pending: NativeAudioSettings | undefined;
  let unsubscribe = () => {};
  const apply = (value: NativeAudioSettings) => {
    writingStore = true;
    try {
      const store = useAudioSettingsStore.getState();
      store.handleSetVolume(value.volume);
      if (store.isMuted !== value.isMuted) store.handleToggleMute();
      store.handleSetAudioEqualizerSettings(value.equalizer);
    } finally { writingStore = false; }
  };
  // Coalesce slider edits while a bridge call is in flight. Old responses never undo a newer gesture.
  const drain = async () => {
    if (draining) return;
    draining = true;
    try {
      while (pending && !disposed) {
        const next = pending; pending = undefined;
        try {
          accepted = await native.setAudioSettings({ settings: next });
          if (!disposed && !pending) report(true, false);
        } catch {
          if (!disposed && !pending && accepted) { apply(accepted); report(true, true); }
        }
      }
    } finally { draining = false; }
  };
  void native.getAudioSettings().then(value => {
    if (disposed) return;
    accepted = value; apply(value); report(true, false);
    unsubscribe = useAudioSettingsStore.subscribe((state, previous) => {
      if (writingStore || (state.volume === previous.volume && state.isMuted === previous.isMuted &&
          state.audioEqualizerSettings === previous.audioEqualizerSettings)) return;
      pending = { volume: state.volume, isMuted: state.isMuted, equalizer: state.audioEqualizerSettings };
      void drain();
    });
  }).catch(() => { if (!disposed) report(false, true); });
  return () => { disposed = true; unsubscribe(); };
}

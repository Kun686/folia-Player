import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { native, type NativeAudioSettings } from './bridge';
import { connectNativeSettings } from './nativeSettingsSync';

// src/mobile/audioSettingsSync.ts — one ordered native writer for the original store and command actions.
export function connectAudioSettings(report: (ready: boolean, error: boolean) => void) {
  return connectNativeSettings<NativeAudioSettings>({
    load: () => native.getAudioSettings(),
    save: settings => native.setAudioSettings({ settings }),
    apply: value => {
      const store = useAudioSettingsStore.getState();
      store.handleSetVolume(value.volume);
      if (store.isMuted !== value.isMuted) store.handleToggleMute();
      store.handleSetAudioEqualizerSettings(value.equalizer);
    },
    subscribe: changed => useAudioSettingsStore.subscribe((state, previous) => {
      if (state.volume === previous.volume && state.isMuted === previous.isMuted &&
          state.audioEqualizerSettings === previous.audioEqualizerSettings) return;
      changed({ volume: state.volume, isMuted: state.isMuted, equalizer: state.audioEqualizerSettings });
    }),
  }, report);
}

import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { native, type NativeAudioSettings } from './bridge';
import { connectNativeSettings } from './nativeSettingsSync';
import { usePlaybackStore } from '../stores/usePlaybackStore';

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
      store.setAudioQuality(value.audioQuality);
      store.handleTogglePlaybackFade(value.playbackFadeEnabled !== false);
      store.handleToggleNeteaseScrobble(value.neteaseScrobbleEnabled === true);
      usePlaybackStore.getState().setReplayGainMode(value.replayGainMode);
    },
    subscribe: changed => {
      const publish = () => {
        const state = useAudioSettingsStore.getState();
        changed({ playbackFadeEnabled: state.playbackFadeEnabled, neteaseScrobbleEnabled: state.neteaseScrobbleEnabled, volume: state.volume, isMuted: state.isMuted, equalizer: state.audioEqualizerSettings, audioQuality: state.audioQuality,
          replayGainMode: usePlaybackStore.getState().replayGainMode });
      };
      const audio = useAudioSettingsStore.subscribe((state, previous) => {
        if (state.volume !== previous.volume || state.isMuted !== previous.isMuted ||
            state.audioEqualizerSettings !== previous.audioEqualizerSettings || state.audioQuality !== previous.audioQuality ||
            state.playbackFadeEnabled !== previous.playbackFadeEnabled ||
            state.neteaseScrobbleEnabled !== previous.neteaseScrobbleEnabled) publish();
      });
      const playback = usePlaybackStore.subscribe((state, previous) => {
        if (state.replayGainMode !== previous.replayGainMode) publish();
      });
      return () => { audio(); playback(); };
    },
  }, report);
}

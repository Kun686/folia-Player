import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { native, type NativeLyricSettings } from './bridge';
import { connectNativeSettings } from './nativeSettingsSync';

// lyricSettingsSync.ts — migrate existing choices once, then use native persistence for suspended-WebView matching.
const snapshot = (state = useLyricSettingsStore.getState()): NativeLyricSettings => ({
  localLyricsPriority: state.localLyricsPriority, autoUseBestLyric: state.autoUseBestLyric,
  preferredAlternativeLyricSource: state.preferredAlternativeLyricSource,
});
export function connectLyricSettings(report: (ready: boolean, error: boolean) => void) {
  return connectNativeSettings<NativeLyricSettings>({
    load: () => native.getLyricSettings(),
    prepare: value => ({
      value: { ...snapshot(), ...value },
      persist: value.autoUseBestLyric === undefined || value.preferredAlternativeLyricSource === undefined,
    }),
    save: settings => native.setLyricSettings({ settings }),
    apply: value => {
      const state = useLyricSettingsStore.getState();
      state.handleSetLocalLyricsPriority(value.localLyricsPriority);
      if (value.autoUseBestLyric !== undefined && value.autoUseBestLyric !== state.autoUseBestLyric)
        state.handleToggleAutoUseBestLyric(value.autoUseBestLyric);
      if (value.preferredAlternativeLyricSource && value.preferredAlternativeLyricSource !== state.preferredAlternativeLyricSource)
        state.handleSetPreferredAlternativeLyricSource(value.preferredAlternativeLyricSource);
    },
    subscribe: changed => useLyricSettingsStore.subscribe((state, previous) => {
      if (state.localLyricsPriority !== previous.localLyricsPriority || state.autoUseBestLyric !== previous.autoUseBestLyric
        || state.preferredAlternativeLyricSource !== previous.preferredAlternativeLyricSource) changed(snapshot(state));
    }),
  }, report);
}

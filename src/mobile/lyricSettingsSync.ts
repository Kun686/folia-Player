import { useLyricSettingsStore } from '../stores/useLyricSettingsStore';
import { native, type NativeLyricSettings } from './bridge';
import { connectNativeSettings } from './nativeSettingsSync';

// lyricSettingsSync.ts — original source preference follows the native value used by background transitions.
export function connectLyricSettings(report: (ready: boolean, error: boolean) => void) {
  return connectNativeSettings<NativeLyricSettings>({
    load: () => native.getLyricSettings(),
    save: settings => native.setLyricSettings({ settings }),
    apply: value => useLyricSettingsStore.getState().handleSetLocalLyricsPriority(value.localLyricsPriority),
    subscribe: changed => useLyricSettingsStore.subscribe((state, previous) => {
      if (state.localLyricsPriority !== previous.localLyricsPriority) changed({ localLyricsPriority: state.localLyricsPriority });
    }),
  }, report);
}

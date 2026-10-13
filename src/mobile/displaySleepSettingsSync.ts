import { useDesktopSettingsStore } from '../stores/useDesktopSettingsStore';
import { native } from './bridge';
import { connectNativeSettings } from './nativeSettingsSync';

// displaySleepSettingsSync.ts — original store action, native persistence and serialized acknowledgements.
export function connectDisplaySleepSettings(report: (ready: boolean, error: boolean) => void) {
  return connectNativeSettings<{ enabled: boolean }>({
    load: () => native.getDisplaySleepSettings(),
    save: value => native.setDisplaySleepSettings(value),
    apply: value => useDesktopSettingsStore.getState().setDesktopPreferenceSnapshot({ PREVENT_DISPLAY_SLEEP_DURING_PLAYBACK: value.enabled }),
    subscribe: changed => useDesktopSettingsStore.subscribe((state, previous) => {
      if (state.preventDisplaySleepDuringPlayback !== previous.preventDisplaySleepDuringPlayback)
        changed({ enabled: state.preventDisplaySleepDuringPlayback });
    }),
  }, report);
}

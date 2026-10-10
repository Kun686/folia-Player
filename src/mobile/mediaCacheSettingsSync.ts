import { useAudioSettingsStore } from '../stores/useAudioSettingsStore';
import { native, type NativeMediaCacheSettings } from './bridge';
import { connectNativeSettings } from './nativeSettingsSync';

// mediaCacheSettingsSync.ts — original cache actions, with native persistence authoritative after relaunch.
export function connectMediaCacheSettings(report: (ready: boolean, error: boolean) => void) {
  return connectNativeSettings<NativeMediaCacheSettings>({
    load: () => native.getMediaCacheSettings(),
    save: settings => native.setMediaCacheSettings({ settings }),
    apply: value => {
      const store = useAudioSettingsStore.getState();
      store.handleToggleMediaCache(value.enabled);
      store.handleSetMediaCacheLimitGb(value.limitGB);
    },
    subscribe: changed => useAudioSettingsStore.subscribe((state, previous) => {
      if (state.enableMediaCache !== previous.enableMediaCache || state.mediaCacheLimitGb !== previous.mediaCacheLimitGb) {
        changed({ enabled: state.enableMediaCache, limitGB: state.mediaCacheLimitGb });
      }
    }),
  }, report);
}

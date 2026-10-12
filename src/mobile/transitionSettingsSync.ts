import { useAutomixSettingsStore } from '../stores/useAutomixSettingsStore';
import { native, type NativeTransitionSettings } from './bridge';
import { connectNativeSettings } from './nativeSettingsSync';

// src/mobile/transitionSettingsSync.ts — reuse original actions; native persists the settings used while locked.
export function connectTransitionSettings(report: (ready: boolean, error: boolean) => void) {
  return connectNativeSettings<NativeTransitionSettings>({
    load: () => native.getTransitionSettings(),
    save: settings => native.setTransitionSettings({ settings }),
    apply: value => {
      const store = useAutomixSettingsStore.getState();
      store.handleToggleAutomix(value.enabled);
      store.handleSetTransitionMode(value.mode);
      store.handleSetCrossfadeMaxSec(value.crossfadeMaxSec);
      store.handleToggleTransitionPerformance(value.performance ?? false);
    },
    subscribe: changed => useAutomixSettingsStore.subscribe((state, previous) => {
      if (state.automixEnabled === previous.automixEnabled && state.transitionMode === previous.transitionMode &&
          state.crossfadeMaxSec === previous.crossfadeMaxSec && state.transitionPerformance === previous.transitionPerformance) return;
      changed({ enabled: state.automixEnabled, mode: state.transitionMode, crossfadeMaxSec: state.crossfadeMaxSec,
        performance: state.transitionPerformance });
    }),
  }, report);
}

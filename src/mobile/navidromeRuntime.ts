import { native, type FoliaNativePlugin } from './bridge';
import type { NativeNavidromeSettings, NativeNavidromeSettingsEdit } from './nativeNavidrome';
import { safeNavidromeError } from './navidromeConnection';
import { cancelProvider } from './runtime';

// navidromeRuntime.ts — public settings checkpoint; credentials pass directly to native storage and are never retained.
type Snapshot = { settings: NativeNavidromeSettings | null; busy: boolean; error: string; epoch: number };
type Bridge = Pick<FoliaNativePlugin, 'getNavidromeSettings' | 'setNavidromeSettings'>;
export function createNavidromeRuntime(bridge: Bridge, revoke: () => void = () => {}) {
  let snapshot: Snapshot = { settings: null, busy: false, error: '', epoch: 0 };
  const listeners = new Set<() => void>();
  const publish = (patch: Partial<Snapshot>) => { snapshot = { ...snapshot, ...patch }; listeners.forEach(listener => listener()); };
  const run = async (work: () => Promise<NativeNavidromeSettings>) => {
    if (snapshot.busy) throw new Error('navidrome-settings-changed');
    publish({ busy: true, error: '', epoch: snapshot.epoch + 1 }); revoke();
    try {
      const raw = await work();
      // Keep only the native public contract, including when an older host returns extra fields.
      const settings = Object.freeze({ enabled: raw.enabled, baseURL: raw.baseURL, username: raw.username,
        hasPassword: raw.hasPassword, scope: raw.scope, revision: raw.revision });
      publish({ settings }); return settings;
    } catch (cause) { const error = safeNavidromeError(cause); publish({ error: error.message }); throw error; }
    finally { publish({ busy: false }); }
  };
  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    load: () => run(() => bridge.getNavidromeSettings()),
    save: (settings: NativeNavidromeSettingsEdit) => {
      const previous = snapshot.settings;
      if (!previous) return Promise.reject(new Error('navidrome-not-configured'));
      return run(() => bridge.setNavidromeSettings({ revision: previous.revision, scope: previous.scope, settings }));
    },
    capture() { const epoch = snapshot.epoch; return () => epoch === snapshot.epoch && !snapshot.busy; },
  };
}
export const navidromeRuntime = createNavidromeRuntime(native, () => { void cancelProvider('navidrome').catch(() => undefined); });

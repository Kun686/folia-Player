import type { FoliaNativePlugin } from './bridge';
import type { AutomixModelName } from '../services/automix/modelAvailability';
import type { TransitionCapabilities } from '../services/automix/stems';

// nativeModels.ts — native owns files/capability; revision-ordered public status never exposes sandbox paths.
export interface NativeModelsState {
  ready: boolean; revision: number; analysisAvailable: boolean; capabilities: TransitionCapabilities;
  models: { name: AutomixModelName; bytes: number; enables: 'beatGrid' | 'stems'; installed: boolean;
    phase: 'absent' | 'queued' | 'downloading' | 'verifying' | 'installed' | 'error'; received: number; host: string; failures: string[] }[];
}
export type ModelsPort = Pick<FoliaNativePlugin, 'getModels' | 'downloadModel' | 'cancelModel' | 'removeModels' | 'importModel' | 'addListener'>;
export function connectNativeModels(port: Pick<ModelsPort, 'getModels' | 'addListener'>,
  report: (state: NativeModelsState) => void, failed: () => void) {
  let disposed = false, revision = -1, serial = 0;
  const refresh = async () => {
    if (disposed) return;
    const request = ++serial;
    try {
      const next = await port.getModels();
      if (!disposed && next.revision >= revision) { revision = next.revision; report(next); }
    } catch { if (!disposed && request === serial) failed(); }
  };
  const listener = port.addListener('models', () => { void refresh(); });
  void listener.then(refresh).catch(() => { if (!disposed) failed(); });
  const foreground = () => { if (!document.hidden) void refresh(); };
  document.addEventListener('visibilitychange', foreground);
  void refresh();
  return { refresh, dispose: () => {
    disposed = true; document.removeEventListener('visibilitychange', foreground);
    void listener.then(handle => handle.remove()).catch(() => {});
  } };
}

import { useEffect, useSyncExternalStore } from 'react';
import { navidromeRuntime } from './navidromeRuntime';

// useNavidromeSettings.ts — one credential-free snapshot shared by settings and library surfaces.
export function useNavidromeSettings() {
  const state = useSyncExternalStore(navidromeRuntime.subscribe, navidromeRuntime.getSnapshot);
  useEffect(() => {
    if (!navidromeRuntime.getSnapshot().settings && !navidromeRuntime.getSnapshot().busy) void navidromeRuntime.load().catch(() => undefined);
  }, []);
  return state;
}

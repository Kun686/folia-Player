import { createPlaybackFadeController } from '../services/playbackFadeController';

// nativePlaybackFadeRuntime.ts — original scheduling in JavaScriptCore, with native timers and PCM gain.
export const protocolVersion = 1;
export interface FadeHost {
  enabled: () => boolean;
  running: () => boolean;
  ramp: (value: number, seconds: number) => void;
  pause: () => void;
  timer: (callback: () => void, ms: number) => number;
  clearTimer: (id: number) => void;
}
export function create(host: FadeHost) {
  const controller = createPlaybackFadeController({
    getGraph: () => ({ running: host.running(), ramp: (value, seconds) => host.ramp(value, seconds) }),
    isEnabled: () => host.enabled(),
    setTimer: (callback, ms) => host.timer(callback, ms),
    clearTimer: id => host.clearTimer(id as number),
  });
  return { ...controller, fadeOutThen: () => controller.fadeOutThen(() => host.pause()) };
}

import { announceTransition, getActiveTransitionCue, type TransitionCue } from '../services/automix/transitionCue';

// nativeTransitionCue.ts — announce each audio handover once; resume from a fresh native clock.
export interface NativeTransitionCue {
  id: number; seconds: number; crossover: number; periodSec: number | null; plain: boolean; elapsed: number;
}

function valid(value: NativeTransitionCue): boolean {
  return Number.isSafeInteger(value.id) && value.id >= 0 && Number.isFinite(value.seconds) && value.seconds > 0
    && Number.isFinite(value.elapsed) && value.elapsed >= 0 && value.elapsed < value.seconds
    && Number.isFinite(value.crossover) && value.crossover >= 0 && value.crossover <= 1
    && (value.periodSec === null || (Number.isFinite(value.periodSec) && value.periodSec > 0))
    && typeof value.plain === 'boolean';
}

export function createNativeTransitionCueSync() {
  let owned: { id: number; cue: TransitionCue } | null = null;
  const clear = () => {
    // Idle snapshots and cleanup must not dismiss an unrelated settings preview.
    if (owned && getActiveTransitionCue()?.cue === owned.cue) announceTransition(null);
    owned = null;
  };
  return {
    clear,
    receive(value: NativeTransitionCue | null | undefined) {
      if (!value || !valid(value)) { clear(); return; }
      // A repeated 250ms snapshot must not replay a dismissed ring or restart either renderer.
      if (owned?.id === value.id) return;
      const cue: TransitionCue = { seconds: value.seconds, crossover: value.crossover,
        periodSec: value.periodSec, ...(value.plain ? { plain: true } : {}) };
      owned = { id: value.id, cue };
      announceTransition(cue, value.elapsed * 1000);
    },
  };
}

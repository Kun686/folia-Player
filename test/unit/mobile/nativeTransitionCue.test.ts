import { afterEach, describe, expect, it, vi } from 'vitest';
import { createNativeTransitionCueSync, type NativeTransitionCue } from '@/mobile/nativeTransitionCue';
import { announceTransition, getActiveTransitionCue, shouldDrawCue, subscribeToTransitionCue } from '@/services/automix/transitionCue';

// Native snapshots arrive repeatedly and may resume in the middle of an independently running blend.
const cue: NativeTransitionCue = { id: 7, seconds: 10, crossover: 0.5, periodSec: 0.5, plain: false, elapsed: 4 };
afterEach(() => { announceTransition(null); vi.restoreAllMocks(); });

describe('native transition animation bridge', () => {
  it('seeds native elapsed time once and never replays the same handover on periodic snapshots', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const sync = createNativeTransitionCueSync(), seen = vi.fn(), off = subscribeToTransitionCue(seen);
    try {
      sync.receive(cue);
      expect(getActiveTransitionCue()?.elapsedMs).toBe(4000);
      const active = getActiveTransitionCue()!.cue;
      now.mockReturnValue(1250); sync.receive({ ...cue, elapsed: 4.25 });
      expect(getActiveTransitionCue()).toEqual({ cue: active, elapsedMs: 4250 });
      expect(seen).toHaveBeenCalledTimes(1);
      now.mockReturnValue(9000); sync.receive(cue);
      expect(getActiveTransitionCue()).toBeNull();
      expect(seen).toHaveBeenCalledTimes(1);
      sync.receive({ ...cue, id: 8, elapsed: 0 });
      expect(seen).toHaveBeenCalledTimes(2);
    } finally { sync.clear(); off(); }
  });

  it('clears on suspension or cancellation and resumes the same native ID at its current position', () => {
    vi.spyOn(performance, 'now').mockReturnValue(1000);
    const sync = createNativeTransitionCueSync();
    sync.receive(cue); sync.clear();
    expect(getActiveTransitionCue()).toBeNull();
    sync.receive({ ...cue, elapsed: 8 });
    expect(getActiveTransitionCue()?.elapsedMs).toBe(8000);
    sync.receive(null);
    expect(getActiveTransitionCue()).toBeNull();
  });

  it('preserves settings previews on idle snapshots and keeps original short/plain drawing rules', () => {
    const sync = createNativeTransitionCueSync();
    const preview = { seconds: 10, crossover: 0.5, periodSec: null, preview: 'ring' as const };
    announceTransition(preview); sync.receive(null); sync.clear();
    expect(getActiveTransitionCue()?.cue).toBe(preview);
    sync.receive({ ...cue, plain: true });
    expect(shouldDrawCue(getActiveTransitionCue()!.cue, true, 'ring')).toBe(false);
    sync.receive({ ...cue, id: 8, seconds: 2, elapsed: 0 });
    expect(shouldDrawCue(getActiveTransitionCue()!.cue, true, 'card')).toBe(false);
    sync.clear();
  });

  it('rejects expired or malformed snapshots and releases its previous cue', () => {
    const sync = createNativeTransitionCueSync();
    for (const patch of [{ id: NaN }, { id: -1 }, { seconds: Infinity }, { elapsed: 10 }, { elapsed: -1 },
      { crossover: 2 }, { periodSec: 0 }, { periodSec: NaN }, { plain: 'false' }]) {
      sync.receive(cue);
      sync.receive({ ...cue, ...patch } as NativeTransitionCue);
      expect(getActiveTransitionCue()).toBeNull();
    }
  });
});

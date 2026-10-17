import { describe, expect, it } from 'vitest';
import { queueSheetAnchors, queueSheetTarget } from '../../../src/mobile/queueSheetGeometry';

// queueSheetGeometry.test.ts — the same release location must respect opposite flick intents.
describe('queue sheet momentum', () => {
  it('distinguishes slow release, upward flick and downward flick', () => {
    expect(queueSheetTarget(330, 0, 800)).toBe('middle');
    expect(queueSheetTarget(330, -1600, 800)).toBe('full');
    expect(queueSheetTarget(330, 2400, 800)).toBe('closed');
  });
  it('returns to an edge after overscroll and bounds extreme velocities', () => {
    expect(queueSheetTarget(-100, 0, 800)).toBe('full');
    expect(queueSheetTarget(1000, 0, 800)).toBe('closed');
    expect(queueSheetTarget(330, -100000, 800)).toBe('full');
  });
  it('uses a usable full-height sheet in a short landscape viewport', () => {
    expect(queueSheetAnchors(350).middle).toBe(0);
    expect(queueSheetTarget(90, 0, 350)).toBe('full');
    expect(queueSheetTarget(90, 1800, 350)).toBe('closed');
  });
});

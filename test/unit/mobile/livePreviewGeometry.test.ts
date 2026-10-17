import { describe, expect, it } from 'vitest';
import { fitLivePreview } from '../../../src/mobile/livePreviewGeometry';

// livePreviewGeometry.test.ts — preview bounds must never intersect the actual settings surface.
describe('live preview geometry', () => {
  it.each([
    [{ width: 390, height: 844 }, { x: 16, y: 59, width: 358, height: 751 }, { x: 16, y: 397, width: 358, height: 413 }],
    [{ width: 844, height: 390 }, { x: 59, y: 16, width: 769, height: 340 }, { x: 428, y: 16, width: 400, height: 340 }],
    [{ width: 1194, height: 834 }, { x: 16, y: 24, width: 1162, height: 790 }, { x: 620, y: 435, width: 558, height: 379 }],
    [{ width: 600, height: 834 }, { x: 16, y: 24, width: 568, height: 790 }, { x: 20, y: 380, width: 560, height: 434 }],
    [{ width: 834, height: 1194 }, { x: 16, y: 24, width: 802, height: 1150 }, { x: 433, y: 654, width: 385, height: 520 }],
  ])('fits the scene in phone/tablet portrait, landscape and multitasking windows', (stage, available, panel) => {
    const result = fitLivePreview(stage, available, panel);
    const right = result.x + result.width!, bottom = result.y + result.height!;
    expect(result.width).toBeGreaterThan(0);
    expect(result.height).toBeGreaterThan(0);
    expect(result.x).toBeGreaterThanOrEqual(available.x);
    expect(result.y).toBeGreaterThanOrEqual(available.y);
    expect(right).toBeLessThanOrEqual(available.x + available.width + .001);
    expect(bottom).toBeLessThanOrEqual(available.y + available.height + .001);
    expect(right <= panel.x - 11.99 || bottom <= panel.y - 11.99
      || result.x >= panel.x + panel.width + 11.99 || result.y >= panel.y + panel.height + 11.99).toBe(true);
  });
  it('keeps the full available width in a short keyboard viewport', () => {
    const result = fitLivePreview({ width: 390, height: 844 }, { x: 16, y: 59, width: 358, height: 250 },
      { x: 16, y: 155, width: 358, height: 154 });
    expect(result.width).toBe(358);
    expect(result.height).toBe(84);
  });
  it('does not emit invalid transforms while the host is unmeasurable', () => {
    expect(fitLivePreview({ width: 0, height: 0 }, { x: 0, y: 0, width: 0, height: 0 },
      { x: 0, y: 0, width: 0, height: 0 })).toEqual({ x: 0, y: 0, width: null, height: null });
  });
});

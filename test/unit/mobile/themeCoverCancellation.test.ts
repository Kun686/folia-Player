import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { extractColors } from '../../../src/utils/colorExtractor';

// themeCoverCancellation.test.ts — image lifecycle bounds for native cover themes, including a tainted canvas.
let instances: ImageFixture[];
class ImageFixture {
  onload: (() => void) | null = null; onerror: (() => void) | null = null;
  src = ''; crossOrigin = ''; removed = false;
  constructor() { instances.push(this); }
  removeAttribute() { this.removed = true; }
}
beforeEach(() => { instances = []; vi.useFakeTimers(); vi.stubGlobal('Image', ImageFixture); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('aborts image work and removes callbacks instead of applying late artwork', async () => {
  const controller = new AbortController();
  const result = extractColors('blob:fixture', 5, { signal: controller.signal });
  const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort(); await rejected;
  expect(instances[0]).toMatchObject({ onload: null, onerror: null, removed: true });
  expect(vi.getTimerCount()).toBe(0);
});
it('bounds an image that never completes and keeps the original empty palette fallback', async () => {
  const result = extractColors('blob:fixture');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(await result).toEqual([]); expect(instances[0].removed).toBe(true);
});
it('settles canvas/security errors with the original fallback', async () => {
  vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() { throw Error('tainted'); } }) }) });
  const result = extractColors('blob:fixture'); instances[0].onload!();
  expect(await result).toEqual([]); expect(vi.getTimerCount()).toBe(0);
});

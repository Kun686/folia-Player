import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// stem-clock-reference.spec.ts — original media-element automation during stem ownership and cancellation.
test('capture original stem element splice and cancellation', async ({ page }) => {
  test.skip(process.env.FOLIA_STEM_CLOCK_REFERENCE !== '1', 'Explicit reference generation only');
  await page.goto('/mobile.html');
  const rows = await page.evaluate(async () => {
    const graphPath = '/src/services/automix/crossfadeGraph.ts', gesturePath = '/src/services/automix/stemGesture.ts';
    const { scheduleStemWindow, rampGain } = await import(graphPath);
    const { outgoingCurves, incomingCurves, planStemHandover } = await import(gesturePath);
    const rate = 44100, seconds = 0.8, frames = 36864, rows = [];
    const envelope = new Float32Array(16).fill(0.5);
    const handover = planStemHandover(seconds, null, null, [], envelope, envelope);
    for (const hold of [0, 384.25]) for (const level of [1, 0.4]) for (const cancel of [null, 256, 640, 1024]) {
      const context = new OfflineAudioContext(2, frames, rate), merger = context.createChannelMerger(2);
      const source = context.createConstantSource(); source.offset.value = 1; source.start();
      const elements = [context.createGain(), context.createGain()]; elements[0].gain.value = level;
      merger.connect(context.destination);
      for (let deck = 0; deck < 2; deck++) {
        source.connect(elements[deck]); elements[deck].connect(merger, 0, deck);
        // Only AudioParam automation is under test; these disconnected stem nodes still use the original scheduler.
        const chain = { gains: Object.fromEntries(['vocals', 'drums', 'bass', 'other'].map(name => [name, context.createGain()])),
          sweep: context.createBiquadFilter(), output: context.createGain(), stop: () => {} };
        const curves = (deck === 0 ? outgoingCurves : incomingCurves)(seconds, handover);
        if (!scheduleStemWindow(context, chain, curves, elements[deck], Math.ceil(hold) / rate, seconds, deck === 0 ? 'out' : 'in')) {
          throw new Error('Original stem element schedule failed');
        }
      }
      const cancelled = cancel === null ? Promise.resolve() : context.suspend(cancel / rate).then(async () => {
        elements.forEach(element => rampGain(context, element, 1, 0.03)); await context.resume();
      });
      const output = await context.startRendering(); await cancelled;
      const indices = [...new Set([
        ...Array.from({ length: Math.ceil(frames / 128) }, (_, i) => [0, 1, 63, 126, 127].map(j => i * 128 + j)).flat(),
        ...[Math.ceil(hold), Math.ceil(hold + 0.008 * rate), Math.ceil(hold + (seconds - 0.008) * rate),
          Math.ceil(hold + seconds * rate), ...(cancel === null ? [] : [cancel, cancel + 0.03 * rate])]
          .flatMap(at => [-2, -1, 0, 1, 2].map(delta => at + delta)),
      ])].filter(i => Number.isInteger(i) && i >= 0 && i < frames).sort((a, b) => a - b);
      rows.push({ hold, level, cancel, frames, seconds, indices,
        outgoing: indices.map(i => output.getChannelData(0)[i]), incoming: indices.map(i => output.getChannelData(1)[i]) });
    }
    return rows;
  });
  expect(rows).toHaveLength(16);
  await writeFile('ios/App/NativeTests/StemClockReference.json', JSON.stringify(rows) + '\n');
});

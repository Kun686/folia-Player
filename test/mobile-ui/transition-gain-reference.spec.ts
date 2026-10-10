import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// transition-gain-reference.spec.ts — independent WebKit AudioParam oracle using Folia's actual scheduling functions.
test('capture native transition gain references', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const graphPath = '/src/services/automix/crossfadeGraph.ts';
    const signalPath = '/src/services/automix/signalAnalysis.ts';
    const { scheduleCrossfade, rampGain } = await import(/* @vite-ignore */ graphPath);
    const { buildCrossfadeCurves } = await import(/* @vite-ignore */ signalPath);
    const frames = 8192, cases = [];
    for (const rate of [8000, 44100, 48000, 96000]) {
      for (const [crossover, together] of [[0.15, 0], [0.5, 0.4], [0.85, 0.8]]) {
        for (const scenario of ['integer', 'fractional', 'cancel', 'cancel-before']) {
          const start = scenario === 'integer' ? 384 : 384.25;
          const duration = scenario === 'integer' ? 2016 : 2016.375;
          const cancel = scenario === 'cancel' ? 1536 : scenario === 'cancel-before' ? 256 : null;
          const context = new OfflineAudioContext(2, frames, rate), source = context.createConstantSource();
          const outgoing = context.createGain(), incoming = context.createGain(), merger = context.createChannelMerger(2);
          source.offset.value = 1; source.connect(outgoing); source.connect(incoming); source.start();
          outgoing.connect(merger, 0, 0); incoming.connect(merger, 0, 1); merger.connect(context.destination);
          if (!scheduleCrossfade(context, outgoing, incoming, duration / rate, crossover, start / rate, together)) {
            throw new Error('Original scheduleCrossfade rejected the reference');
          }
          const cancelled = cancel === null ? Promise.resolve() : context.suspend(cancel / rate).then(async () => {
            rampGain(context, outgoing, 1, 0.03); rampGain(context, incoming, 1, 0.03);
            await context.resume();
          });
          const output = await context.startRendering(); await cancelled;
          const indices = [...new Set([
            ...Array.from({ length: 64 }, (_, i) => [0, 1, 2, 126, 127].map(j => i * 128 + j)).flat(),
            ...Array.from({ length: 64 }, (_, i) => [-1, 0, 1, 2].map(j => Math.floor(start + duration * i / 63) + j)).flat(),
            ...(cancel === null ? [] : [-2, -1, 0, 1, 2].map(i => Math.floor(cancel + 0.03 * rate) + i)),
          ])].filter(i => i >= 0 && i < frames).sort((a, b) => a - b);
          const curves = buildCrossfadeCurves(crossover, together);
          cases.push({ rate, start, duration, cancel, indices,
            outCurve: Array.from(curves.out), inCurve: Array.from(curves.in),
            outSamples: indices.map(i => output.getChannelData(0)[i]),
            inSamples: indices.map(i => output.getChannelData(1)[i]) });
        }
      }
    }
    return { generator: 'WebKit OfflineAudioContext; original scheduleCrossfade and rampGain; unity ConstantSource', frames, cases };
  });
  expect(reference.cases).toHaveLength(48);
  await writeFile('ios/App/NativeTests/TransitionGainReference.json', JSON.stringify(reference) + '\n');
});

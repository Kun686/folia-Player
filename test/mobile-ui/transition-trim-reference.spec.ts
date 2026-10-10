import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// transition-trim-reference.spec.ts — original linear gain ramps, replacement and settle behavior.
test('capture original balance gain and cancellation', async ({ page }) => {
  test.skip(process.env.FOLIA_TRIM_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const path = '/src/services/automix/crossfadeGraph.ts';
    const { rampGainDb, rampGain } = await import(path);
    const frames = 32768, cases = [];
    for (const rate of [8000, 44100, 48000, 96000]) {
      for (const cancel of [null, 8192]) {
        const context = new OfflineAudioContext(1, frames, rate), source = context.createConstantSource();
        const trim = context.createGain(); source.offset.value = 1;
        source.connect(trim).connect(context.destination); source.start();
        const actions = [{ at: 256, db: -3 }, { at: 4096, db: -6 }];
        const waits = actions.map(({ at, db }) => context.suspend(at / rate).then(async () => {
          rampGainDb(context, trim, db, 0.4); await context.resume();
        }));
        if (cancel !== null) waits.push(context.suspend(cancel / rate).then(async () => {
          rampGain(context, trim, 1, 0.03); await context.resume();
        }));
        const output = await context.startRendering(); await Promise.all(waits);
        const indices = [...new Set(Array.from({ length: 256 }, (_, i) => [0, 1, 126, 127].map(j => i * 128 + j)).flat())];
        cases.push({ rate, cancel, actions, indices, samples: indices.map(i => output.getChannelData(0)[i]) });
      }
    }
    return { frames, cases };
  });
  expect(reference.cases).toHaveLength(8);
  await writeFile('ios/App/NativeTests/TransitionTrimReference.json', JSON.stringify(reference) + '\n');
});

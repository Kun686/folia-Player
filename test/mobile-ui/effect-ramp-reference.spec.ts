import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// effect-ramp-reference.spec.ts — expose AudioParam samples through a unity constant source, without DSP masking rounding.
test('capture sample-accurate effect ramps', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const frames = 16384, indices = [...new Set([...Array.from({ length: 256 }, (_, i) => i),
      ...Array.from({ length: frames / 128 }, (_, block) => [0, 1, 2, 3, 4, 126, 127].map(i => block * 128 + i)).flat(),
      4095, 4096, 4097, 8191, 8192, 8193, 12287, 12288, 12289])].sort((a, b) => a - b);
    const cases = [];
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      for (const seconds of [0.03, 0.08, 0.12]) {
        for (const values of [[20, 90, 20, 110, 20], [20000, 6000, 20000, 16000, 500], [0, 0.7, 0, 1, 0.35]]) {
          const context = new OfflineAudioContext(1, frames, rate), source = context.createConstantSource(), gain = context.createGain();
          source.offset.value = 1; source.connect(gain); gain.connect(context.destination); source.start(); gain.gain.value = values[0];
          const events = values.slice(1).map((target, i) => ({ frame: i * 4096, target }));
          const apply = (target: number) => { gain.gain.cancelScheduledValues(context.currentTime); gain.gain.setTargetAtTime(target, context.currentTime, seconds); };
          apply(events[0].target);
          const pauses = events.slice(1).map(event => context.suspend(event.frame / rate).then(async () => { apply(event.target); await context.resume(); }));
          const output = (await context.startRendering()).getChannelData(0); await Promise.all(pauses);
          cases.push({ rate, seconds, initial: values[0], events, samples: indices.map(i => output[i]) });
        }
      }
    }
    return { generator: 'WebKit AudioParam setTargetAtTime via ConstantSourceNode(1) and GainNode', frames, indices, cases };
  });
  expect(reference.cases).toHaveLength(45);
  await writeFile('ios/App/NativeTests/EffectRampReference.json', JSON.stringify(reference) + '\n');
});

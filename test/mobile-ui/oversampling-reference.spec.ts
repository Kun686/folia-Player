import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// oversampling-reference.spec.ts — original 4x drive and non-oversampled crush, including live curve changes.
test('capture original waveshaper audio references', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const sourcesPath = '/src/services/audioEffects/effectSources.ts', nodesPath = '/src/services/audioEffects/effectNodes.ts';
    const { createSaturationCurve, createBitCrushCurve } = await import(sourcesPath);
    const { createAudioEffectNodes } = await import(nodesPath);
    const indices = [...new Set([...Array.from({ length: 512 }, (_, i) => i),
      ...Array.from({ length: 119 }, (_, i) => 512 + i * 64), 2047, 2049, 4095, 4097, 6143, 6145, 8191])].sort((a, b) => a - b);
    const cases = [];
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      for (const kind of ['drive', 'crush']) {
        for (const initial of [0, 0.45, 1]) {
          const context = new OfflineAudioContext(1, 8192, rate), nodes = createAudioEffectNodes(context);
          const source = context.createBufferSource(), buffer = context.createBuffer(1, 8192, rate);
          const pcm = buffer.getChannelData(0);
          for (let i = 0; i < pcm.length; i++) pcm[i] = i === 0 ? 0.25 : i < 1024 ? 0
            : 0.5 * Math.sin(i * 0.41 * Math.PI) + 0.2 * Math.sin(i * 2 * Math.PI * 997 / rate);
          source.buffer = buffer;
          const node = kind === 'drive' ? nodes.drive : nodes.crush;
          const curve = kind === 'drive' ? createSaturationCurve : createBitCrushCurve;
          source.connect(node); node.connect(context.destination); source.start();
          const events = [{ frame: 0, amount: initial }, { frame: 2048, amount: 0 },
            { frame: 4096, amount: 1 }, { frame: 6144, amount: 0.28 }];
          node.curve = curve(initial);
          const pauses = events.slice(1).map(event => context.suspend(event.frame / rate).then(async () => {
            node.curve = curve(event.amount); await context.resume();
          }));
          const output = (await context.startRendering()).getChannelData(0); await Promise.all(pauses);
          const impulse = Array.from(output.slice(0, 1024));
          const peak = impulse.reduce((best, value, i) => Math.abs(value) > Math.abs(impulse[best]) ? i : best, 0);
          cases.push({ rate, kind, events, peak, samples: indices.map(i => output[i]),
            energy: output.reduce((sum, value) => sum + value * value, 0) });
        }
      }
    }
    return { generator: 'Original effectNodes.ts/effectSources.ts; WebKit OfflineAudioContext', indices, cases };
  });
  expect(reference.cases).toHaveLength(30);
  await writeFile('ios/App/NativeTests/OversamplingReference.json', JSON.stringify(reference) + '\n');
});

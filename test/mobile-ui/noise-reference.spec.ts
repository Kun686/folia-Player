import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// noise-reference.spec.ts — run the original noise branch with deterministic randomness and real WebKit filtering.
test('capture original noise branch reference', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const nodesPath = '/src/services/audioEffects/effectNodes.ts', noisePath = '/src/services/audioEffects/noiseBranch.ts';
    const { createAudioEffectNodes } = await import(nodesPath), { createNoiseBranch } = await import(noisePath);
    const cases = [];
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      const frames = Math.ceil(rate * 3.3 / 128) * 128;
      const indices = [...new Set([...Array.from({ length: 256 }, (_, i) => i),
        ...Array.from({ length: 512 }, (_, i) => Math.floor(i * (frames - 1) / 511)),
        ...Array.from({ length: 5 }, (_, i) => rate * 3 + i - 2)])].sort((a, b) => a - b);
      const context = new OfflineAudioContext(2, frames, rate), nodes = createAudioEffectNodes(context);
      const branch = createNoiseBranch(context, nodes); nodes.noiseGain.connect(context.destination);
      const events = [{ frame: 0, amount: 0.7 }, { frame: 2048, amount: 0 },
        { frame: 4096, amount: 0.4 }, { frame: 8192, amount: 1 }];
      let seed = 0x12345678;
      const random = Math.random;
      try {
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        branch.set(events[0].amount);
      } finally { Math.random = random; }
      const pauses = events.slice(1).map(event => context.suspend(event.frame / rate).then(async () => {
        branch.set(event.amount); await context.resume();
      }));
      const output = await context.startRendering(); await Promise.all(pauses); branch.dispose();
      cases.push({ rate, frames, indices, events, channels: [0, 1].map(channel => {
        const pcm = output.getChannelData(channel);
        return { samples: indices.map(i => pcm[i]), energy: pcm.reduce((sum, value) => sum + value * value, 0) };
      }) });
    }
    return { generator: 'Original noiseBranch.ts / effectSources.ts; seeded LCG; WebKit OfflineAudioContext', cases };
  });
  expect(reference.cases).toHaveLength(5);
  await writeFile('ios/App/NativeTests/NoiseReference.json', JSON.stringify(reference) + '\n');
});

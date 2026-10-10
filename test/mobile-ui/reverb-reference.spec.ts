import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// reverb-reference.spec.ts — actual original reverb branch, full impulse tail and live wet/dry automation.
test('capture original reverb branch reference', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const nodesPath = '/src/services/audioEffects/effectNodes.ts', reverbPath = '/src/services/audioEffects/reverbBranch.ts';
    const { createAudioEffectNodes } = await import(nodesPath), { createReverbBranch } = await import(reverbPath);
    const cases = [];
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      const frames = Math.ceil((rate * 2.2 + 4096) / 128) * 128;
      const indices = [...new Set([...Array.from({ length: 512 }, (_, i) => i),
        ...Array.from({ length: 1024 }, (_, i) => Math.floor(i * (frames - 1) / 1023)),
        ...[1024, 2048, 4096, 8192, 16384].flatMap(i => [i - 1, i, i + 1])])].sort((a, b) => a - b);
      const context = new OfflineAudioContext(2, frames, rate), nodes = createAudioEffectNodes(context);
      const branch = createReverbBranch(context, nodes);
      const source = context.createBufferSource(), input = context.createBuffer(2, frames, rate);
      for (let channel = 0; channel < 2; channel++) {
        const pcm = input.getChannelData(channel);
        for (let i = 0; i < 4096; i++) {
          pcm[i] = i === 0 ? (channel ? -0.25 : 0.75) : i >= 128 && i < 2048
            ? 0.2 * Math.sin(i * 2 * Math.PI * (channel ? 313 : 997) / rate)
            : i === 2048 ? 0.4 : i === 4095 ? -0.2 : 0;
        }
      }
      source.buffer = input; source.connect(nodes.wetSend); source.connect(nodes.dry);
      nodes.dry.connect(context.destination); nodes.wet.connect(context.destination);
      const events = [{ frame: 0, amount: 0.7 }, { frame: 4096, amount: 0 },
        { frame: 8192, amount: 1 }, { frame: 16384, amount: 0.35 }];
      let seed = 0x12345678;
      const random = Math.random;
      try {
        Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
        branch.set(events[0].amount);
      } finally { Math.random = random; }
      source.start();
      const pauses = events.slice(1).map(event => context.suspend(event.frame / rate).then(async () => {
        branch.set(event.amount); await context.resume();
      }));
      const output = await context.startRendering(); await Promise.all(pauses); branch.dispose();
      cases.push({ rate, frames, indices, events, channels: [0, 1].map(channel => {
        const pcm = output.getChannelData(channel);
        return { samples: indices.map(i => pcm[i]), energy: pcm.reduce((sum, value) => sum + value * value, 0) };
      }) });
    }
    return { generator: 'Original reverbBranch.ts / effectSources.ts; seeded LCG; WebKit OfflineAudioContext', cases };
  });
  expect(reference.cases).toHaveLength(5);
  await writeFile('ios/App/NativeTests/ReverbReference.json', JSON.stringify(reference) + '\n');
});

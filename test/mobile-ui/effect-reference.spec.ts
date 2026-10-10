import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// effect-reference.spec.ts — capture original source generators and WebKit cutoff automation independently of Swift.
test('capture original effect sources and cutoff references', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const sourcePath = '/src/services/audioEffects/effectSources.ts';
    const nodePath = '/src/services/audioEffects/effectNodes.ts';
    const paramsPath = '/src/services/audioEffects/effectParams.ts';
    const { createSaturationCurve, createBitCrushCurve, createVinylNoiseBuffer, createReverbImpulse } = await import(sourcePath);
    const { createAudioEffectNodes } = await import(nodePath);
    const { rampParam } = await import(paramsPath);
    const curves = [0, 0.1, 0.45, 1].map(amount => ({ amount,
      saturation: Array.from(createSaturationCurve(amount) ?? []), crush: Array.from(createBitCrushCurve(amount) ?? []) }));
    const sources = [], cutoffs = [];
    const indices = [...new Set([...Array.from({ length: 128 }, (_, i) => i),
      ...Array.from({ length: 127 }, (_, i) => 64 * (i + 1)), 2047, 2049, 4095, 4097, 6143, 6145, 8191])].sort((a, b) => a - b);
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      const context = new OfflineAudioContext(2, 8192, rate);
      for (const kind of ['noise', 'reverb']) {
        let seed = 0x12345678;
        const originalRandom = Math.random;
        let buffer: AudioBuffer;
        try {
          Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
          buffer = kind === 'noise' ? createVinylNoiseBuffer(context) : createReverbImpulse(context);
        } finally { Math.random = originalRandom; }
        const probes = [...new Set([...Array.from({ length: 128 }, (_, i) => i),
          ...Array.from({ length: 256 }, (_, i) => Math.floor(i * (buffer.length - 1) / 255))])];
        sources.push({ rate, kind, length: buffer.length, indices: probes, channels: [0, 1].map(channel => {
          const pcm = buffer.getChannelData(channel);
          return { samples: probes.map(index => pcm[index]), energy: pcm.reduce((sum, value) => sum + value * value, 0) };
        }) });
      }
      for (const [highpass, lowpass] of [[20, 20000], [90, 6000], [420, 3800], [2000, 500]]) {
        const render = new OfflineAudioContext(1, 8192, rate);
        const nodes = createAudioEffectNodes(render);
        const input = render.createBufferSource(), buffer = render.createBuffer(1, 8192, rate);
        const pcm = buffer.getChannelData(0);
        for (let i = 0; i < pcm.length; i++) {
          pcm[i] = 0.1 * Math.sin(i * 2 * Math.PI * 121 / rate) + 0.03 * Math.cos(i * 2 * Math.PI * 1997 / rate)
            + (i === 0 ? 0.25 : i === 2050 ? -0.2 : 0);
        }
        input.buffer = buffer;
        input.connect(nodes.highpass); nodes.highpass.connect(nodes.lowpass); nodes.lowpass.connect(render.destination);
        const events = [{ frame: 0, highpass, lowpass }, { frame: 2048, highpass: 20, lowpass: 20000 },
          { frame: 4096, highpass: 2000, lowpass: 500 }, { frame: 6144, highpass, lowpass }];
        const apply = (event: typeof events[number]) => {
          rampParam(render, nodes.highpass.frequency, event.highpass);
          rampParam(render, nodes.lowpass.frequency, Math.min(event.lowpass, rate * 0.475));
        };
        apply(events[0]); input.start();
        const pauses = events.slice(1).map(event => render.suspend(event.frame / rate).then(async () => {
          apply(event); await render.resume();
        }));
        const result = (await render.startRendering()).getChannelData(0); await Promise.all(pauses);
        cutoffs.push({ rate, events, samples: indices.map(index => result[index]),
          energy: result.reduce((sum, value) => sum + value * value, 0) });
      }
    }
    return { generator: 'Original effectSources.ts and effectNodes.ts; WebKit OfflineAudioContext automation',
      curves, sources, indices, cutoffs };
  });
  expect(reference.cutoffs).toHaveLength(20); expect(reference.sources).toHaveLength(10);
  await writeFile('ios/App/NativeTests/EffectReference.json', JSON.stringify(reference) + '\n');
});

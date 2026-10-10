import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// compressor-reference.spec.ts — original compressor/makeup, exercising attack, release and live punch changes.
test('capture original punch compression references', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const nodesPath = '/src/services/audioEffects/effectNodes.ts', paramsPath = '/src/services/audioEffects/effectParams.ts';
    const { createAudioEffectNodes } = await import(nodesPath), { rampParam, dbToLinear } = await import(paramsPath);
    const frames = 32768;
    const indices = [...new Set([...Array.from({ length: 512 }, (_, i) => i),
      ...Array.from({ length: 504 }, (_, i) => 512 + i * 64), 4095, 4097, 8191, 8193, 16383, 16385, 24575, 24577, frames - 1])].sort((a, b) => a - b);
    const cases = [];
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      for (const kind of ['static', 'automated']) {
        for (const initial of [0, 0.15, 0.4, 1]) {
          const context = new OfflineAudioContext(2, frames, rate), nodes = createAudioEffectNodes(context);
          const source = context.createBufferSource(), buffer = context.createBuffer(2, frames, rate);
          for (let channel = 0; channel < 2; channel++) {
            const pcm = buffer.getChannelData(channel);
            for (let i = 0; i < frames; i++) {
              const amplitude = i < 1024 ? 0.002 : i < 6144 ? 1 : i < 12288 ? 0.03 : i < 18432 ? 1.3 : i < 24576 ? 0 : 0.1;
              pcm[i] = amplitude * (channel ? 0.07 * Math.sin(i * 2 * Math.PI * 117 / rate) + 0.6 * Math.cos(i * 2 * Math.PI * 997 / rate)
                : 0.8 * Math.sin(i * 2 * Math.PI * 220 / rate) + 0.1 * Math.sin(i * 2 * Math.PI * 799 / rate));
            }
          }
          source.buffer = buffer; source.connect(nodes.compressor); nodes.compressor.connect(nodes.makeup);
          nodes.makeup.connect(context.destination); source.start();
          const events = [{ frame: 0, amount: initial }, ...(kind === 'static' ? [] : [
            { frame: 4096, amount: 0.5 }, { frame: 8192, amount: 1 }, { frame: 16384, amount: 0 }, { frame: 24576, amount: 0.35 }])];
          const apply = (amount: number) => {
            for (const [param, value] of [[nodes.compressor.threshold, -6 - 26 * amount],
              [nodes.compressor.ratio, 1 + 7 * amount], [nodes.compressor.knee, 30 - 18 * amount],
              [nodes.makeup.gain, dbToLinear(amount * 3)]] as const) {
              if (kind === 'static') param.value = value;
              else rampParam(context, param, value);
            }
          };
          apply(initial);
          const parameters: { frame: number; threshold: number; knee: number; ratio: number; makeup: number }[] = [];
          const capture = (frame: number) => parameters.push({ frame, threshold: nodes.compressor.threshold.value,
            knee: nodes.compressor.knee.value, ratio: nodes.compressor.ratio.value, makeup: nodes.makeup.gain.value });
          const boundaries = kind === 'automated' ? Array.from({ length: frames / 128 - 1 }, (_, i) => (i + 1) * 128) : [];
          const pauses = boundaries.map(frame => context.suspend(frame / rate).then(async () => {
            // AudioParam.value on the main thread reads the last rendered value without advancing automation.
            capture(Math.round(context.currentTime * rate) - 128);
            const event = events.find(item => item.frame === frame);
            if (event) apply(event.amount);
            await context.resume();
          }));
          const output = await context.startRendering(); await Promise.all(pauses);
          if (kind === 'automated') capture(frames - 128);
          cases.push({ rate, kind, events, parameters, channels: [0, 1].map(channel => {
            const pcm = output.getChannelData(channel);
            return { samples: indices.map(i => pcm[i]), energy: pcm.reduce((sum, value) => sum + value * value, 0) };
          }) });
        }
      }
    }
    return { generator: 'Original effectNodes.ts / effectParams.ts; WebKit OfflineAudioContext compressor and makeup', frames, indices, cases };
  });
  expect(reference.cases).toHaveLength(40);
  await writeFile('ios/App/NativeTests/CompressorReference.json', JSON.stringify(reference) + '\n');
});

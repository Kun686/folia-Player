import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// effect-channel-diagnostic.spec.ts — locate channel-dependent automation in original Web Audio primitives.
test('diagnose linked stereo effect automation', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit DSP diagnosis only');
  await page.goto('/mobile.html');
  const result = await page.evaluate(async () => {
    const path = '/src/services/audioEffects/effectNodes.ts', params = '/src/services/audioEffects/effectParams.ts';
    const { createAudioEffectNodes } = await import(path), { rampParam } = await import(params);
    const rate = 44100, frames = 8192, results = [];
    for (const kind of ['cutoff', 'drive', 'compressor']) {
      const context = new OfflineAudioContext(2, frames, rate), nodes = createAudioEffectNodes(context);
      const source = context.createBufferSource(), buffer = context.createBuffer(2, frames, rate);
      for (let channel = 0; channel < 2; channel++) {
        const pcm = buffer.getChannelData(channel);
        for (let i = 0; i < frames; i++) pcm[i] = 0.1 * Math.sin(i * 2 * Math.PI * 221 / rate) + 0.03 * Math.cos(i * 2 * Math.PI * 1997 / rate);
      }
      source.buffer = buffer;
      if (kind === 'cutoff') { source.connect(nodes.highpass); nodes.highpass.connect(nodes.lowpass); nodes.lowpass.connect(context.destination); }
      else { source.connect(nodes[kind]); nodes[kind].connect(context.destination); }
      source.start();
      const pause = context.suspend(4096 / rate).then(async () => {
        if (kind === 'cutoff') { rampParam(context, nodes.highpass.frequency, 90); rampParam(context, nodes.lowpass.frequency, 6000); }
        if (kind === 'compressor') { rampParam(context, nodes.compressor.threshold, -16.4); rampParam(context, nodes.compressor.ratio, 3.8); }
        await context.resume();
      });
      const output = await context.startRendering(); await pause;
      const a = output.getChannelData(0), b = output.getChannelData(1);
      results.push({ kind, maximumStereoDifference: a.reduce((maximum, value, i) => Math.max(maximum, Math.abs(value - b[i])), 0),
        probes: [4096, 4224, 4352, 4480, 4608, 6144].map(frame => ({ frame, left: a[frame], right: b[frame] })) });
    }
    return results;
  });
  expect(result).toHaveLength(3);
  await writeFile('.mobile-test-results/effect-channel-diagnostic.json', JSON.stringify(result, null, 2) + '\n');
});

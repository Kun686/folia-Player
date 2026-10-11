import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Original WebKit ramp samples are an independent oracle for the native audio callback.
test('capture original ReplayGain ramps and mode changes', async ({ page }) => {
  test.skip(process.env.FOLIA_REPLAYGAIN_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const graphPath = '/src/services/automix/crossfadeGraph.ts', utilityPath = '/src/utils/replayGain.ts';
    const { rampGain } = await import(graphPath), { calculateReplayGain } = await import(utilityPath);
    const info = { trackGain: -6, albumGain: -3 }, frames = 16384, cases = [];
    for (const rate of [8000, 44100, 48000, 96000]) {
      const context = new OfflineAudioContext(1, frames, rate), source = context.createConstantSource(), gain = context.createGain();
      source.connect(gain).connect(context.destination); source.start();
      const actions = [{ at: 0, mode: 'track' }, { at: 2048, mode: 'album' }, { at: 8192, mode: 'off' }];
      rampGain(context, gain, calculateReplayGain(info, 'track').linearGain, 0.1);
      const waits = actions.slice(1).map(({ at, mode }) => context.suspend(at / rate).then(async () => {
        rampGain(context, gain, calculateReplayGain(info, mode).linearGain, 0.1); await context.resume();
      }));
      const output = await context.startRendering(); await Promise.all(waits);
      const indices = Array.from({ length: frames / 128 }, (_, i) => [0, 1, 126, 127].map(j => i * 128 + j)).flat();
      cases.push({ rate, actions, indices, samples: indices.map(i => output.getChannelData(0)[i]) });
    }
    const inputs = [null, {}, { trackGain: -6 }, { trackGain: 6, trackPeak: 0.8 },
      { trackGain: -8, albumGain: -3, albumPeak: 0.9 }, { trackGain: 6, albumPeak: 1.2 }];
    return { frames, info, cases, calculations: inputs.map(info => ({ info, track: calculateReplayGain(info, 'track').linearGain,
      album: calculateReplayGain(info, 'album').linearGain })) };
  });
  expect(reference.cases).toHaveLength(4);
  await writeFile('ios/App/NativeTests/ReplayGainReference.json', JSON.stringify(reference) + '\n');
});

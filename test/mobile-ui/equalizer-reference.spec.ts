import { test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// Regenerate the native DSP oracle from the original Web Audio graph, never from native coefficients.
test('capture WebKit equalizer impulse references', async ({ page }) => {
  test.skip(process.env.FOLIA_EQ_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const references = await page.evaluate(async () => {
    const graphPath = '/src/services/audioEqualizerGraph.ts', settingsPath = '/src/utils/audioEqualizer.ts';
    const { connectAudioEqualizerGraph } = await import(graphPath);
    const { DEFAULT_AUDIO_EQUALIZER_SETTINGS } = await import(settingsPath);
    const samples = [...Array.from({ length: 32 }, (_, i) => i), ...Array.from({ length: 127 }, (_, i) => 64 * (i + 1))];
    const cases = [];
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      for (const gains of [Array(10).fill(12), Array(10).fill(-12), [6, -3, 2, -4, 0, 5, -2, 4, -6, 9]]) {
        const context = new OfflineAudioContext(1, 8192, rate);
        const input = context.createBufferSource(), buffer = context.createBuffer(1, 8192, rate);
        buffer.getChannelData(0)[0] = 0.25; input.buffer = buffer;
        connectAudioEqualizerGraph({ context, input, output: context.destination, nodesRef: { current: [] },
          settings: { ...DEFAULT_AUDIO_EQUALIZER_SETTINGS, enabled: true, gains } });
        input.start();
        const pcm = (await context.startRendering()).getChannelData(0);
        cases.push({ rate, gains, samples: samples.map(index => pcm[index]), energy: pcm.reduce((sum, value) => sum + value * value, 0) });
      }
    }
    return { generator: 'WebKit OfflineAudioContext; src/services/audioEqualizerGraph.ts', indices: samples, cases };
  });
  await writeFile('ios/App/NativeTests/EqualizerReference.json', JSON.stringify(references, null, 2) + '\n');
});

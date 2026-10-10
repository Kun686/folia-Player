import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// WebKit is the independent oracle, including its channel mixing and analyser normalization.
test('capture original WebKit analyser references', async ({ page }) => {
  test.skip(process.env.FOLIA_SPECTRUM_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const path = '/src/utils/visualizerAudio.ts';
    const { VISUALIZER_FFT_SIZE, VISUALIZER_SMOOTHING } = await import(path);
    const cases = [];
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      for (const [channels, volume] of [[[1], 1], [[0, 1], 1], [[1, -1], 1], [[1, 0.25], 0.25], [[1], 0],
        [[0, 1, 0], 1], [[0, 0, 1, 0], 1], [[1, 0, 0, 0, 0, 0], 1], [[0, 0, 1, 0, 0, 0], 1],
        [[0, 0, 0, 1, 0, 0], 1], [[0, 0, 0, 0, 1, 0], 1], [[0, 0, 0, 0, 0, 0, 1, 0], 1]] as const) {
        const context = new OfflineAudioContext(channels.length, 16384, rate);
        const buffer = context.createBuffer(channels.length, 16384, rate), source = context.createBufferSource();
        channels.forEach((gain, channel) => {
          const pcm = buffer.getChannelData(channel);
          for (let i = 0; i < 8192; i++) {
            pcm[i] = gain * (0.004 * Math.sin(i * 2 * Math.PI * 220 / rate)
              + 0.002 * Math.cos(i * 2 * Math.PI * 997 / rate) + 0.001 * Math.sin(i * 2 * Math.PI * 1703 / rate));
          }
        });
        source.buffer = buffer;
        const gain = context.createGain(); gain.gain.value = volume;
        const analyser = context.createAnalyser();
        analyser.fftSize = VISUALIZER_FFT_SIZE; analyser.smoothingTimeConstant = VISUALIZER_SMOOTHING;
        source.connect(gain); gain.connect(analyser); analyser.connect(context.destination); source.start();
        const snapshots: { frames: number; spectrum: number[]; repeated: boolean }[] = [];
        const suspensions = [4096, 8192, 12288].map(frames => context.suspend(frames / rate).then(async () => {
          const bins = new Uint8Array(analyser.frequencyBinCount), again = new Uint8Array(bins.length);
          analyser.getByteFrequencyData(bins); analyser.getByteFrequencyData(again);
          snapshots.push({ frames: Math.round(context.currentTime * rate), spectrum: Array.from(bins),
            repeated: bins.every((value, i) => value === again[i]) });
          await context.resume();
        }));
        await context.startRendering(); await Promise.all(suspensions);
        cases.push({ rate, channels, volume, snapshots });
      }
    }
    return { generator: 'WebKit OfflineAudioContext; original analyser parameters and signal flow',
      fftSize: VISUALIZER_FFT_SIZE, smoothing: VISUALIZER_SMOOTHING, cases };
  });
  expect(reference.fftSize).toBe(2048); expect(reference.smoothing).toBe(0.6);
  expect(reference.cases).toHaveLength(60);
  expect(reference.cases.every(entry => entry.snapshots.length === 3 && entry.snapshots.every(sample => sample.repeated))).toBe(true);
  await writeFile('ios/App/NativeTests/SpectrumReference.json', JSON.stringify(reference) + '\n');
});

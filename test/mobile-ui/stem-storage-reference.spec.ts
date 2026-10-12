import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// stem-storage-reference.spec.ts — original PCM packing, eviction and WebKit media-offset semantics.
test('capture original stem storage and source offsets', async ({ page }) => {
  test.skip(process.env.FOLIA_STEM_STORAGE_REFERENCE !== '1', 'Explicit reference generation only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const path = '/src/services/automix/stems.ts', graph = '/src/services/automix/crossfadeGraph.ts';
    const { peakOf, toPcm, pickStemVictim, MAX_WINDOWS, STEM_WINDOW_SEC } = await import(path);
    const { connectStemDeck } = await import(graph);
    const names = ['drums', 'bass', 'vocals', 'other'], cases = [];
    for (const mode of ['silence', 'stereo', 'mono', 'rounding']) {
      const rows = Array.from({ length: 4 }, (_, stem) => [0, 1].map(channel => Float32Array.from({ length: 257 }, (_, i) => {
        if (mode === 'silence') return 0;
        if (mode === 'rounding') return i === 256 ? 32767 : ((i % 19) - 9) / 2;
        const polarity = mode === 'mono' || channel === 0 ? 1 : -0.37;
        return polarity * (stem + 1) * ((i * (31 + stem * 2) % 257) - 128) / 113;
      })));
      const [mix, drums, bass, vocals] = rows;
      // The original ensureStems subtraction happens in JS double precision before the Float32 store.
      const other = [0, 1].map(c => Float32Array.from(mix[c], (sample, i) => sample - drums[c][i] - bass[c][i] - vocals[c][i]));
      const parts = [drums, bass, vocals, other];
      cases.push({ name: mode, mix: mix.map(row => Array.from(row)), separated: Object.fromEntries(names.slice(0, 3).map((name, i) => [name, parts[i].map(row => Array.from(row))])),
        packed: Object.fromEntries(names.map((name, i) => {
          const gain = peakOf(...parts[i]), pcm: Int16Array = toPcm(...parts[i], gain);
          return [name, { gain, pcm: Array.from(pcm), restored: Array.from(pcm, x => Math.fround(x / 32767 * gain)) }];
        })) });
    }
    const offsets = [];
    for (const offset of [0, 0.25, 0.5, 0.75, 1.25, 127.75, 1000.25]) {
      const context = new OfflineAudioContext(2, 128, 44100);
      const buffers = Object.fromEntries(names.map(name => {
        const buffer = context.createBuffer(2, 1024, 44100);
        if (name === 'drums') for (let c = 0; c < 2; c++) for (let i = 0; i < 1024; i++) {
          buffer.getChannelData(c)[i] = i >= 1021 ? [0.5, -0.75, 0.125][i - 1021] * (c === 0 ? 1 : -0.5)
            : Math.fround((i % 17 - 8) / (c === 0 ? 32 : -64));
        }
        const gain = peakOf(buffer.getChannelData(0), buffer.getChannelData(1));
        const pcm = toPcm(buffer.getChannelData(0), buffer.getChannelData(1), gain);
        for (let c = 0; c < 2; c++) for (let i = 0; i < 1024; i++) buffer.getChannelData(c)[i] = pcm[c * 1024 + i] / 32767 * gain;
        return [name, buffer];
      }));
      const deck = connectStemDeck(context, { buffers, from: 0, duration: 1024 / 44100 }, context.destination, offset / 44100, 0, false);
      deck.output.gain.value = 1;
      const output = await context.startRendering();
      offsets.push({ offset, channels: [0, 1].map(c => Array.from(output.getChannelData(c))) });
    }
    const policies = [
      { keys: ['a', 'b', 'c', 'd', 'e'], wanted: ['c', 'd'], arriving: 'e' },
      { keys: ['a', 'b', 'c', 'd', 'e'], wanted: ['c', 'e'], arriving: 'e' },
      { keys: ['a', 'b', 'c', 'd', 'e'], wanted: ['a', 'b', 'c', 'd', 'e'], arriving: 'e' },
      { keys: ['b', 'c', 'd', 'a', 'e'], wanted: ['e'], arriving: 'e' },
    ].map(row => ({ ...row, victim: pickStemVictim(row.keys, new Set(row.wanted), row.arriving) }));
    return { maxWindows: MAX_WINDOWS, windowSeconds: STEM_WINDOW_SEC, cases, offsets, policies };
  });
  expect(reference.cases).toHaveLength(4);
  expect(reference.offsets).toHaveLength(7);
  await writeFile('ios/App/NativeTests/StemStorageReference.json', JSON.stringify(reference) + '\n');
});

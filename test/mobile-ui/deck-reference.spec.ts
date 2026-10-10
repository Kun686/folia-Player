import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// deck-reference.spec.ts — independent WebKit filters and floating FFT, using the original tap wiring.
test('capture original per-deck WebKit PCM and spectrum', async ({ page }) => {
  test.skip(process.env.FOLIA_DECK_PCM_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const path = '/src/services/automix/deckAnalyser.ts';
    const { createDeckAnalyser } = await import(path);
    const cases = [];
    for (const rate of [44100, 48000, 96000]) {
      for (const channels of [[1, 0.3], [1, -1], [0, 1]]) {
        const context = new OfflineAudioContext(2, 12288, rate);
        const make = context.createAnalyser.bind(context);
        let analyser: AnalyserNode;
        context.createAnalyser = () => { analyser = make(); return analyser; };
        const source = context.createBufferSource(), buffer = context.createBuffer(2, 12288, rate);
        channels.forEach((gain, channel) => {
          const pcm = buffer.getChannelData(channel);
          for (let i = 0; i < pcm.length; i++) pcm[i] = gain * (0.1 * Math.sin(i * 2 * Math.PI * 97 / rate)
            + 0.03 * Math.cos(i * 2 * Math.PI * 997 / rate) + 0.02 * Math.sin(i * 2 * Math.PI * 3901 / rate));
        });
        source.buffer = buffer;
        const deck = createDeckAnalyser(context, source, context.destination);
        source.start();
        const snapshots: { frames: number; samples: number[]; spectrum: (number | null)[] }[] = [];
        const waits = [1024, 4096, 8192].map(frames => context.suspend(frames / rate).then(async () => {
          const samples = new Float32Array(1024), spectrum = new Float32Array(512);
          deck.tick(context.currentTime);
          analyser!.getFloatTimeDomainData(samples); analyser!.getFloatFrequencyData(spectrum);
          snapshots.push({ frames: Math.round(context.currentTime * rate), samples: Array.from(samples),
            spectrum: Array.from(spectrum, value => Number.isFinite(value) ? value : null) });
          await context.resume();
        }));
        await context.startRendering(); await Promise.all(waits);
        cases.push({ rate, channels, snapshots });
      }
    }
    const live = [];
    for (const rate of [44100, 48000]) {
      const context = new OfflineAudioContext(2, rate * 11, rate);
      const source = context.createBufferSource(), buffer = context.createBuffer(2, rate * 11, rate);
      for (let channel = 0; channel < 2; channel++) {
        const pcm = buffer.getChannelData(channel);
        for (let i = 0; i < pcm.length; i++) {
          const amplitude = (i / rate) % 0.5 < 0.065 ? 0.2 : 0.015;
          pcm[i] = amplitude * (Math.sin(i * 2 * Math.PI * 97 / rate)
            + 0.3 * Math.cos(i * 2 * Math.PI * 997 / rate)
            + 0.2 * Math.sin(i * 2 * Math.PI * 3901 / rate)) * (channel ? 0.3 : 1);
        }
      }
      source.buffer = buffer; const deck = createDeckAnalyser(context, source, context.destination); source.start();
      const states: { frames: number; state: unknown }[] = [];
      // Offline suspension rounds up to a render quantum; native replays those actual frame counts.
      const waits = Array.from({ length: 400 }, (_, i) => context.suspend((i + 1) * 0.025).then(async () => {
        deck.tick(context.currentTime);
        states.push({ frames: Math.round(context.currentTime * rate), state: {
          loudnessDb: deck.loudnessDb(), tempo: deck.tempo(), nextBeatIn: deck.nextBeatIn(context.currentTime + 0.013),
        } });
        await context.resume();
      }));
      await context.startRendering(); await Promise.all(waits);
      live.push({ rate, states });
    }
    return { cases, live };
  });
  const { cases } = reference;
  expect(cases).toHaveLength(9);
  expect(cases.every(entry => entry.snapshots.length === 3)).toBe(true);
  await writeFile('ios/App/NativeTests/DeckPCMReference.json', JSON.stringify(reference) + '\n');
});

import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// transition-tone-reference.spec.ts — actual original deck graph and WebKit filter automation.
test('capture original band handover and reset PCM', async ({ page }) => {
  test.skip(process.env.FOLIA_TONE_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const graphPath = '/src/services/automix/crossfadeGraph.ts';
    const signalPath = '/src/services/automix/signalAnalysis.ts';
    const { connectAutomixDeck, scheduleBandBlend, resetTone } = await import(graphPath);
    const { buildBandCurves } = await import(signalPath);
    const frames = 16384, cases = [];
    for (const rate of [8000, 44100, 48000, 96000]) {
      for (const [crossover, sweepOut, tiltDb] of [[0.15, true, [3, -3]], [0.5, true, [-3, 3]], [0.85, false, [0, 0]]] as const) {
        for (const scenario of ['normal', 'fractional', 'cancel', 'cancel-before']) {
          const start = scenario === 'fractional' ? 384.25 : 384;
          const duration = scenario === 'fractional' ? 2016.375 : 2016;
          const cancel = scenario === 'cancel' ? 1536 : scenario === 'cancel-before' ? 256 : null;
          const context = new OfflineAudioContext(4, frames, rate), merger = context.createChannelMerger(4);
          merger.connect(context.destination);
          const sources: AudioBufferSourceNode[] = [];
          const decks = [0, 1].map(deck => {
            const buffer = context.createBuffer(2, frames, rate), source = context.createBufferSource();
            for (let channel = 0; channel < 2; channel++) {
              const pcm = buffer.getChannelData(channel);
              for (let i = 0; i < frames; i++) pcm[i] = (channel ? -0.25 : 1) * (0.1 * Math.sin(i * 2 * Math.PI * 97 / rate)
                + 0.03 * Math.cos(i * 2 * Math.PI * 997 / rate) + 0.02 * Math.sin(i * 2 * Math.PI * 2701 / rate));
            }
            source.buffer = buffer; sources.push(source);
            // OfflineAudioContext has no media elements; substitute only the PCM source node.
            Object.defineProperty(context, 'createMediaElementSource', { configurable: true, value: () => source });
            const output = context.createGain(), splitter = context.createChannelSplitter(2);
            output.connect(splitter); splitter.connect(merger, 0, deck * 2); splitter.connect(merger, 1, deck * 2 + 1);
            return connectAutomixDeck(context, {} as HTMLAudioElement, output);
          });
          const request = { crossover, swapBass: true, sweepOut, tiltDb };
          if (!scheduleBandBlend(context, decks[0].tone, decks[1].tone, start / rate, duration / rate, request)) {
            throw new Error('Original band schedule failed');
          }
          sources.forEach(source => source.start());
          const cancelled = cancel === null ? Promise.resolve() : context.suspend(cancel / rate).then(async () => {
            decks.forEach(deck => resetTone(context, deck.tone));
            await context.resume();
          });
          const output = await context.startRendering(); await cancelled;
          const indices = [...new Set([
            ...Array.from({ length: 128 }, (_, i) => [0, 1, 126, 127].map(j => i * 128 + j)).flat(),
            ...Array.from({ length: 64 }, (_, i) => [-1, 0, 1, 2].map(j => Math.floor(start + duration * i / 63) + j)).flat(),
          ])].filter(i => i < frames).sort((a, b) => a - b);
          const curves = buildBandCurves(request);
          cases.push({ rate, start, duration, cancel, indices,
            bands: { out: curves.out.map((row: Float32Array) => [...row]), in: curves.in.map((row: Float32Array) => [...row]) },
            channels: [0, 1, 2, 3].map(channel => indices.map(i => output.getChannelData(channel)[i])) });
        }
      }
    }
    return { frames, cases };
  });
  expect(reference.cases).toHaveLength(48);
  await writeFile('ios/App/NativeTests/TransitionToneReference.json', JSON.stringify(reference) + '\n');
});

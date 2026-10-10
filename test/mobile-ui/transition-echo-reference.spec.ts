import { test, expect } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

// transition-echo-reference.spec.ts — original pre-fade throw, feedback tail and reset in real WebKit.
test('capture original echo throw PCM', async ({ page }) => {
  test.skip(!['1', 'verify'].includes(process.env.FOLIA_ECHO_REFERENCE ?? ''), 'Explicit capture or verification only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const path = '/src/services/automix/crossfadeGraph.ts';
    const { connectAutomixDeck, scheduleEchoThrow, resetThrow } = await import(path);
    const cases = [];
    for (const rate of [8000, 44100, 48000, 96000]) {
      for (const [at, period, cancelTime] of [
        [0.35, null, null], [0.13751, 0.33333333, null], [0, 0.07, null],
        [0.05, 8, null], [0.25, 0.4, 0.18], [0.4, null, 0.125],
      ] as const) {
        const frames = Math.ceil(rate * 2.4), context = new OfflineAudioContext(2, frames, rate);
        const source = context.createBufferSource(), pcm = context.createBuffer(2, frames, rate);
        const stop = Math.floor(rate * 0.55);
        for (let i = 0; i < stop; i++) {
          pcm.getChannelData(0)[i] = 0.1 * Math.sin(i * 2 * Math.PI * 97 / rate)
            + 0.03 * Math.cos(i * 2 * Math.PI * 997 / rate);
          pcm.getChannelData(1)[i] = -0.25 * pcm.getChannelData(0)[i];
        }
        source.buffer = pcm;
        Object.defineProperty(context, 'createMediaElementSource', { configurable: true, value: () => source });
        const deck = connectAutomixDeck(context, {} as HTMLAudioElement, context.destination);
        deck.fade.gain.value = 0; // Isolate the throw; its sound must survive the dry fade reaching zero.
        scheduleEchoThrow(context, deck.throw, at, period);
        source.start();
        const cancel = cancelTime === null ? null : Math.floor(cancelTime * rate / 128) * 128;
        const cancelled = cancel === null ? Promise.resolve() : context.suspend(cancel / rate).then(async () => {
          resetThrow(context, deck.throw); await context.resume();
        });
        const output = await context.startRendering(); await cancelled;
        const indices = Array.from({ length: Math.ceil(frames / 128) }, (_, i) => [0, 1, 63, 126, 127].map(j => i * 128 + j))
          .flat().filter(i => i < frames);
        cases.push({ rate, frames, stop, at, period, cancel, indices,
          channels: [0, 1].map(ch => indices.map(i => output.getChannelData(ch)[i])) });
      }
    }
    return { cases };
  });
  expect(reference.cases).toHaveLength(24);
  const path = 'ios/App/NativeTests/TransitionEchoReference.json';
  if (process.env.FOLIA_ECHO_REFERENCE === '1') await writeFile(path, JSON.stringify(reference) + '\n');
  // JSON represents both signs of zero as 0; compare the same serialized representation.
  else expect(JSON.parse(JSON.stringify(reference))).toEqual(JSON.parse(await readFile(path, 'utf8')));
});

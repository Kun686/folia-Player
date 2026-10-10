import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// delay-channel-diagnostic.spec.ts — isolates per-channel parameter advancement in the installed WebKit.
test('record shared DelayNode automation across identical channels', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit diagnostic only');
  await page.goto('/mobile.html');
  const result = await page.evaluate(async () => {
    const cases = [];
    for (const channels of [1, 2]) {
      const context = new OfflineAudioContext(channels, 1024, 8000), source = context.createBufferSource();
      const buffer = context.createBuffer(channels, 1024, 8000), delay = context.createDelay(0.2);
      for (let channel = 0; channel < channels; channel++) {
        const pcm = buffer.getChannelData(channel);
        for (let i = 0; i < 1024; i++) pcm[i] = i / 1024;
      }
      source.buffer = buffer; source.connect(delay); delay.connect(context.destination);
      delay.delayTime.setTargetAtTime(0.012, 0, 0.08); source.start();
      const audio = await context.startRendering();
      cases.push({ channels, output: Array.from({ length: channels }, (_, channel) => Array.from(audio.getChannelData(channel))) });
    }
    return { engine: navigator.userAgent, cases };
  });
  expect(result.cases[0].output[0].length).toBe(1024);
  const at = [0, 64, 127, 128, 256, 512];
  console.log('Delay shared parameter diagnostic', at.map(frame => ({ frame,
    mono: result.cases[0].output[0][frame], left: result.cases[1].output[0][frame], right: result.cases[1].output[1][frame] })));
  await writeFile('.mobile-test-results/delay-channel-diagnostic.json', JSON.stringify(result) + '\n');
});

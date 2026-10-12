import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// stem-mix-reference.spec.ts — actual original four-stem graph, splices, HP automation and shared limiter.
test('capture original stem bus PCM', async ({ page }) => {
  test.skip(process.env.FOLIA_STEM_MIX_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const graphPath = '/src/services/automix/crossfadeGraph.ts', gesturePath = '/src/services/automix/stemGesture.ts';
    const { connectStemBus, connectStemDeck, scheduleStemWindow } = await import(graphPath);
    const { outgoingCurves, incomingCurves, planStemHandover } = await import(gesturePath);
    const rate = 44100, names = ['drums', 'bass', 'other', 'vocals'] as const, cases = [];
    const scenarios = [
      { name: 'normal', seconds: 1.75, level: 0.09, outLevel: 1, inLevel: 1, solo: null, mono: false },
      { name: 'limiting', seconds: 1.75, level: 1.8, outLevel: 1, inLevel: 1, solo: null, mono: false },
      { name: 'replaygain', seconds: 1.75, level: 0.3, outLevel: 0.4, inLevel: 2.1, solo: null, mono: false },
      { name: 'outgoing-other', seconds: 0.8, level: 0.3, outLevel: 1, inLevel: 0, solo: 'other', mono: false },
      { name: 'incoming-other', seconds: 0.8, level: 0.3, outLevel: 0, inLevel: 1, solo: 'other', mono: false },
      { name: 'silence', seconds: 0.8, level: 0, outLevel: 1, inLevel: 1, solo: null, mono: false },
      { name: 'mono', seconds: 0.8, level: 0.3, outLevel: 1, inLevel: 1, solo: null, mono: true },
    ];
    for (const scenario of scenarios) {
      const { seconds, level, outLevel, inLevel, solo, mono } = scenario;
      const frames = Math.ceil(seconds * rate), context = new OfflineAudioContext(2, frames, rate);
      const input = { version: 1, windowSec: seconds, outgoingBarSec: null, incomingBarSec: null, downbeats: [],
        vocals: Array.from(new Float32Array(Math.floor(seconds / 0.05)).fill(0.5)),
        mix: Array.from(new Float32Array(Math.floor(seconds / 0.05)).fill(0.5)), incoming: {} };
      const handover = planStemHandover(seconds, null, null, [], new Float32Array(input.vocals), new Float32Array(input.mix));
      const curves = [outgoingCurves(seconds, handover), incomingCurves(seconds, handover)];
      for (const [deck, gain] of [outLevel, inLevel].entries()) {
        for (const name of names) for (let i = 0; i < curves[deck][name].length; i++) curves[deck][name][i] *= gain;
      }
      const bus = connectStemBus(context, context.destination);
      for (let deck = 0; deck < 2; deck++) {
        const buffers = Object.fromEntries(names.map((name, stem) => {
          const buffer = context.createBuffer(2, frames, rate);
          for (let channel = 0; channel < 2; channel++) {
            const pcm = buffer.getChannelData(channel), polarity = channel && !mono ? -0.37 : 1;
            for (let i = 0; i < frames; i++) {
              pcm[i] = solo !== null && solo !== name ? 0 : polarity * level
                * (0.7 * Math.sin(i * 2 * Math.PI * (97 + stem * 301 + deck * 43) / rate)
                  + 0.3 * Math.cos(i * 2 * Math.PI * (41 + stem * 73 + deck * 29) / rate));
            }
          }
          return [name, buffer];
        }));
        const chain = connectStemDeck(context, { buffers, from: 0, duration: seconds }, bus.input, 0, 0, deck === 0);
        if (!scheduleStemWindow(context, chain, curves[deck], context.createGain(), 0, seconds, deck === 0 ? 'out' : 'in')) {
          throw new Error('Original stem graph rejected fixture');
        }
      }
      const output = await context.startRendering();
      // Cover every render quantum, both splices and all curve knots/6ms drum and bass handoffs.
      const indices = [...new Set([
        ...Array.from({ length: Math.ceil(frames / 128) }, (_, i) => [0, 1, 63, 126, 127].map(j => i * 128 + j)).flat(),
        ...Array.from({ length: 2 * 512 }, (_, i) => i < 512 ? i : frames - 1024 + i),
        ...Array.from({ length: curves[0].vocals.length }, (_, i) => [-1, 0, 1].map(j => Math.floor(frames * i / (curves[0].vocals.length - 1)) + j)).flat(),
      ])].filter(i => i >= 0 && i < frames).sort((a, b) => a - b);
      cases.push({ ...scenario, input, frames, indices,
        channels: [0, 1].map(channel => indices.map(i => output.getChannelData(channel)[i])) });
    }
    return { rate, generator: 'WebKit OfflineAudioContext using original stem graph; generated PCM only', cases };
  });
  expect(reference.cases).toHaveLength(7);
  expect(reference.cases[1].channels.flat().some(value => Math.abs(value) > 0.99)).toBe(true);
  expect(reference.cases[1].channels.flat().every(value => Math.abs(value) <= 1)).toBe(true);
  await writeFile('ios/App/NativeTests/StemMixReference.json', JSON.stringify(reference) + '\n');
});

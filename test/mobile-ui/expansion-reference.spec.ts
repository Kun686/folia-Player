import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// expansion-reference.spec.ts — original plan/render/mask plus the actual original shared WebKit graph.
test('capture original performance gesture and output', async ({ page }) => {
  test.skip(process.env.FOLIA_EXPANSION_REFERENCE !== '1', 'Explicit reference generation only');
  await page.goto('/mobile.html');
  const result = await page.evaluate(async () => {
    const paths = ['/src/services/automix/expansionGesture.ts', '/src/services/automix/stemGesture.ts', '/src/services/automix/crossfadeGraph.ts'];
    const { planExpansion, renderExpansion, expansionMask } = await import(paths[0]);
    const { planStemHandover, outgoingCurves, incomingCurves } = await import(paths[1]);
    const { connectStemBus, connectStemDeck, connectExpansion, scheduleStemWindow } = await import(paths[2]);
    const names = ['drums', 'bass', 'other', 'vocals'], rate = 44100, cases = [];
    const hash = async (data: Float32Array) => {
      const bytes = new Uint8Array(data.byteLength);
      bytes.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
      return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('');
    };
    const scenarios = [
      { name: 'quarter', intensity: 0.25, seconds: 12, bar: 2, beats: 4, level: 0.25, outLevel: 1, inLevel: 1 },
      { name: 'half-replaygain', intensity: 0.5, seconds: 12, bar: 2, beats: 4, level: 0.25, outLevel: 0.4, inLevel: 1.5 },
      { name: 'three-quarter', intensity: 0.75, seconds: 12, bar: 2, beats: 4, level: 0.25, outLevel: 1, inLevel: 1 },
      { name: 'full-limiting', intensity: 1, seconds: 12, bar: 2, beats: 4, level: 2, outLevel: 1.6, inLevel: 1 },
      { name: 'odd-fractional', intensity: 0.75, seconds: 11.11, bar: 1.37, beats: 3, level: 0.25, outLevel: 1, inLevel: 1 },
      { name: 'gridless-silent', intensity: 1, seconds: 6.57, bar: null, beats: 4, level: 0, outLevel: 1, inLevel: 1 },
      { name: 'no-room', intensity: 1, seconds: 0.8, bar: 2, beats: 4, level: 0.25, outLevel: 1, inLevel: 1 },
    ];
    for (const entry of scenarios) {
      const { seconds, bar, beats, intensity, level, outLevel, inLevel } = entry, frames = Math.ceil(seconds * rate);
      const input = { version: 1, windowSec: seconds, outgoingBarSec: bar, incomingBarSec: bar, downbeats: [],
        vocals: Array.from(new Float32Array(Math.floor(seconds / 0.05)).fill(0.5)),
        mix: Array.from(new Float32Array(Math.floor(seconds / 0.05)).fill(0.5)), incoming: {}, expansion: intensity, outgoingBeatsPerBar: beats };
      const handover = planStemHandover(seconds, bar, bar, [], new Float32Array(input.vocals), new Float32Array(input.mix));
      const plan = planExpansion(intensity, handover.swap, bar, seconds, beats), mask = plan ? expansionMask(seconds, plan) : null;
      const curves = [outgoingCurves(seconds, handover), incomingCurves(seconds, handover)];
      if (plan) for (const name of plan.stems) for (let i = 0; i < curves[0][name].length; i++) curves[0][name][i] *= mask[i];
      for (const [deck, gain] of [outLevel, inLevel].entries()) for (const name of names) {
        for (let i = 0; i < curves[deck][name].length; i++) curves[deck][name][i] *= gain;
      }
      const context = new OfflineAudioContext(2, frames, rate), bus = connectStemBus(context, context.destination);
      let rendered: Float32Array[] | null = null;
      for (let deck = 0; deck < 2; deck++) {
        const buffers = Object.fromEntries(names.map((name, stem) => {
          const buffer = context.createBuffer(2, frames, rate);
          for (let c = 0; c < 2; c++) for (let i = 0; i < frames; i++) {
            buffer.getChannelData(c)[i] = (((i * (stem + 3) + deck * 17) % 257) - 128) * level * (c === 0 ? 1 : -0.375) / 512;
          }
          return [name, buffer];
        }));
        const chain = connectStemDeck(context, { buffers, from: 0, duration: seconds }, bus.input, 0, 0, deck === 0);
        if (deck === 0 && plan) {
          rendered = [new Float32Array(Math.max(1, Math.round((plan.to - plan.from) * rate))), new Float32Array(Math.max(1, Math.round((plan.to - plan.from) * rate)))];
          for (const name of plan.stems) {
            const parts = renderExpansion([buffers[name].getChannelData(0), buffers[name].getChannelData(1)], plan, rate);
            for (let c = 0; c < 2; c++) for (let i = 0; i < rendered[c].length; i++) rendered[c][i] += parts[c][i];
          }
          if (!connectExpansion(context, rendered, rate, chain.output, plan.from, outLevel)) throw new Error('Original expansion failed');
        }
        if (!scheduleStemWindow(context, chain, curves[deck], context.createGain(), 0, seconds, deck === 0 ? 'out' : 'in')) throw new Error('Original stem schedule failed');
      }
      const pcm = await context.startRendering();
      const events = plan ? [plan.from, plan.to, plan.to - plan.spinbackSec, ...plan.repeats.flatMap((r: {at: number; length: number}) => [plan.from + r.at, plan.from + r.at + r.length])] : [];
      const indices = [...new Set([...Array.from({length: Math.ceil(frames / 128)}, (_, i) => [0, 1, 63, 127].map(x => i * 128 + x)).flat(),
        ...events.flatMap(at => [-2, -1, 0, 1, 2].map(x => Math.round(at * rate) + x))])].filter(i => i >= 0 && i < frames).sort((a, b) => a - b);
      cases.push({ ...entry, input, plan: plan ? {...plan, windowSec: seconds} : null, frames, indices,
        output: [0, 1].map(c => indices.map(i => pcm.getChannelData(c)[i])),
        renderedFrames: rendered?.[0].length ?? 0, renderedHashes: rendered ? await Promise.all(rendered.map(hash)) : [] });
    }
    const starts = [];
    for (const at of [0, 0.25, 0.5, 0.75, 100.25]) {
      const context = new OfflineAudioContext(2, 256, rate);
      const source = Float32Array.from({ length: 128 }, (_, i) => (i % 17 - 8) / 32);
      connectExpansion(context, [source, source], rate, context.destination, at / rate, 1);
      const result = await context.startRendering(); starts.push({ at, pcm: Array.from(result.getChannelData(0)) });
    }
    return { cases, starts };
  });
  expect(result.cases).toHaveLength(7);
  expect(result.cases.at(-1)?.plan).toBeNull();
  await writeFile('ios/App/NativeTests/ExpansionReference.json', JSON.stringify(result) + '\n');
});

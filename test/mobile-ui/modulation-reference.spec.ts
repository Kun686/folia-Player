import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// modulation-reference.spec.ts — exercise original wow branch and width matrix in WebKit, without native math.
test('capture original wow and stereo width references', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const nodesPath = '/src/services/audioEffects/effectNodes.ts', wowPath = '/src/services/audioEffects/wowBranch.ts';
    const paramsPath = '/src/services/audioEffects/effectParams.ts';
    const { createAudioEffectNodes } = await import(nodesPath), { createWowBranch } = await import(wowPath);
    const { rampParam } = await import(paramsPath);
    const frames = 16384, indices = [...new Set([...Array.from({ length: 128 }, (_, i) => i),
      ...Array.from({ length: 255 }, (_, i) => (i + 1) * 64), 2047, 2049, 4095, 4097, 6143, 6145, frames - 1])].sort((a, b) => a - b);
    const cases = [];
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      for (const kind of ['wow', 'width']) {
        for (const initial of kind === 'wow' ? [0.35, 1] : [0, 2]) {
          // WebKit advances shared DelayNode automation per channel; see delay-channel-diagnostic.spec.ts.
          // Use the original mono branch for each input; native linked stereo is verified separately.
          for (const inputs of kind === 'wow' ? [[0], [1]] : [[0, 1]]) {
          const context = new OfflineAudioContext(inputs.length, frames, rate), nodes = createAudioEffectNodes(context);
          const wow = kind === 'wow' ? createWowBranch(context, nodes) : null;
          const input = context.createBufferSource(), buffer = context.createBuffer(inputs.length, frames, rate);
          for (const [output, channel] of inputs.entries()) {
            const pcm = buffer.getChannelData(output);
            for (let i = 0; i < frames; i++) pcm[i] = (channel ? -0.07 : 0.1) * Math.sin(i * 2 * Math.PI * 121 / rate)
              + (channel ? 0.02 : 0.03) * Math.cos(i * 2 * Math.PI * 799 / rate);
          }
          input.buffer = buffer;
          if (kind === 'wow') { input.connect(nodes.wowDelay); nodes.wowDelay.connect(context.destination); }
          else {
            input.connect(nodes.stereoInput); nodes.stereoInput.connect(nodes.splitter);
            nodes.splitter.connect(nodes.leftDirect, 0, 0); nodes.splitter.connect(nodes.rightCross, 1, 0);
            nodes.splitter.connect(nodes.leftCross, 0, 0); nodes.splitter.connect(nodes.rightDirect, 1, 0);
            nodes.leftDirect.connect(nodes.merger, 0, 0); nodes.rightCross.connect(nodes.merger, 0, 0);
            nodes.leftCross.connect(nodes.merger, 0, 1); nodes.rightDirect.connect(nodes.merger, 0, 1);
            nodes.merger.connect(context.destination);
          }
          const events = [{ frame: 0, amount: initial }, { frame: 2048, amount: 0 },
            { frame: 4096, amount: kind === 'wow' ? 0.8 : 1.3 }, { frame: 6144, amount: 0 }];
          const apply = (amount: number) => {
            if (wow) wow.set(amount);
            else {
              for (const node of [nodes.leftDirect, nodes.rightDirect]) rampParam(context, node.gain, (1 + amount) / 2);
              for (const node of [nodes.leftCross, nodes.rightCross]) rampParam(context, node.gain, (1 - amount) / 2);
            }
          };
          apply(initial); input.start();
          const pauses = events.slice(1).map(event => context.suspend(event.frame / rate).then(async () => {
            apply(event.amount); await context.resume();
          }));
          const rendered = await context.startRendering(); await Promise.all(pauses); wow?.dispose();
          cases.push({ rate, kind, inputs, events, channels: inputs.map((_, channel) => {
            const pcm = rendered.getChannelData(channel);
            return { samples: indices.map(index => pcm[index]), energy: pcm.reduce((sum, value) => sum + value * value, 0) };
          }) });
          }
        }
      }
    }
    return { generator: 'Original wowBranch.ts, effectNodes.ts matrix and rampParam; WebKit OfflineAudioContext', frames, indices, cases };
  });
  expect(reference.cases).toHaveLength(30);
  await writeFile('ios/App/NativeTests/ModulationReference.json', JSON.stringify(reference) + '\n');
});

import { test, expect } from '@playwright/test';
import { writeFile } from 'node:fs/promises';

// effect-graph-reference.spec.ts — original post-EQ graph and presets, including enable/disable and live changes.
test('capture original combined effect graph', async ({ page }) => {
  test.skip(process.env.FOLIA_EFFECT_REFERENCE !== '1', 'Explicit fixture regeneration only');
  await page.goto('/mobile.html');
  const reference = await page.evaluate(async () => {
    const graphPath = '/src/services/audioEffects/effectChain.ts', presetsPath = '/src/utils/audioPresets.ts';
    const { createAudioEffectChain } = await import(graphPath), { AUDIO_SOUND_PRESETS } = await import(presetsPath);
    const frames = 32768, indices = [...new Set([...Array.from({ length: 512 }, (_, i) => i),
      ...Array.from({ length: 1008 }, (_, i) => 512 + i * 32), 4095, 4097, 8191, 8193, 12287, 12289, frames - 1])].sort((a, b) => a - b);
    const cases = [];
    for (const rate of [8000, 22050, 44100, 48000, 96000]) {
      for (const preset of ['flat', 'lofi', 'hall', 'bass']) {
        const trace = rate === 44100 && preset === 'flat';
        const context = new OfflineAudioContext(trace ? 16 : 2, frames, rate), input = context.createBufferSource();
        const taps: Record<string, AudioNode> = {}, root = context.createGain();
        const createShaper = context.createWaveShaper.bind(context), createDelay = context.createDelay.bind(context);
        const createGain = context.createGain.bind(context), createMerger = context.createChannelMerger.bind(context);
        let shaperCount = 0, compressorCreated = false, postCompressorGains = 0;
        context.createWaveShaper = () => { const node = createShaper(); taps[shaperCount++ === 0 ? 'drive' : 'crush'] = node; return node; };
        context.createDelay = maximum => { const node = createDelay(maximum); taps.wow = node; return node; };
        context.createGain = () => { const node = createGain(); if (compressorCreated && ++postCompressorGains === 5) taps.makeup = node; return node; };
        context.createChannelMerger = count => { const node = createMerger(count); taps.width = node; return node; };
        const createCompressor = context.createDynamicsCompressor.bind(context);
        let compressor: DynamicsCompressorNode;
        context.createDynamicsCompressor = () => { compressor = createCompressor(); taps.compressor = compressor; compressorCreated = true; return compressor; };
        // The two cutoff nodes otherwise advance their shared AudioParam once per channel in this WebKit.
        // Retain the original graph and parameters, but give each cutoff channel its own original BiquadFilterNode.
        // Unmodified stereo results are retained in .mobile-test-results/EffectGraphRawStereoWebKitReference.json.
        const createFilter = context.createBiquadFilter.bind(context);
        let createdFilters = 0;
        context.createBiquadFilter = () => {
          if (createdFilters++ >= 2) return createFilter(); // The noise branch's static bandpass is unchanged.
          const entry = context.createGain(), split = context.createChannelSplitter(2), merge = context.createChannelMerger(2);
          const filters = [createFilter(), createFilter()];
          entry.channelCount = 2; entry.channelCountMode = 'explicit'; entry.connect(split);
          filters.forEach((filter, channel) => {
            filter.channelCount = 1; filter.channelCountMode = 'explicit';
            split.connect(filter, channel); filter.connect(merge, 0, channel);
          });
          const parameter = (key: 'frequency' | 'Q') => ({
            get value() { return filters[0][key].value; },
            set value(value: number) { filters.forEach(filter => { filter[key].value = value; }); },
            cancelScheduledValues(time: number) { filters.forEach(filter => filter[key].cancelScheduledValues(time)); },
            setTargetAtTime(value: number, time: number, constant: number) { filters.forEach(filter => filter[key].setTargetAtTime(value, time, constant)); },
          });
          const disconnectEntry = entry.disconnect.bind(entry);
          Object.defineProperties(entry, {
            type: { get: () => filters[0].type, set: (type: BiquadFilterType) => filters.forEach(filter => { filter.type = type; }) },
            frequency: { value: parameter('frequency') }, Q: { value: parameter('Q') },
            connect: { value: merge.connect.bind(merge) },
            disconnect: { value: () => { disconnectEntry(); split.disconnect(); filters.forEach(filter => filter.disconnect()); merge.disconnect(); } },
          });
          if (createdFilters === 2) taps.cutoff = entry;
          return entry as unknown as BiquadFilterNode;
        };
        const buffer = context.createBuffer(2, frames, rate);
        for (let channel = 0; channel < 2; channel++) {
          const pcm = buffer.getChannelData(channel);
          for (let i = 0; i < frames; i++) pcm[i] = i < 16384 ? (channel ? -0.07 : 0.1) * Math.sin(i * 2 * Math.PI * 221 / rate)
            + (channel ? 0.02 : 0.03) * Math.cos(i * 2 * Math.PI * 1997 / rate) : 0;
        }
        input.buffer = buffer;
        // Wow's upstream shared stereo-automation defect is isolated in delay-channel-diagnostic.spec.ts.
        // Its linked native timeline has a separate original mono-branch oracle; this oracle covers the combined remaining graph.
        const events = [{ frame: 0, enabled: true, values: { ...AUDIO_SOUND_PRESETS[preset].effects, wow: 0 } },
          { frame: 4096, enabled: true, values: { ...AUDIO_SOUND_PRESETS.lofi.effects, wow: 0 } },
          { frame: 8192, enabled: false, values: { ...AUDIO_SOUND_PRESETS.lofi.effects, wow: 0 } },
          { frame: 12288, enabled: true, values: { ...AUDIO_SOUND_PRESETS.vocal.effects, wow: 0 } }];
        let seed = 0x12345678;
        const seeded = <T>(action: () => T): T => {
          const random = Math.random;
          try {
            Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
            return action();
          } finally { Math.random = random; }
        };
        const graph = seeded(() => createAudioEffectChain({ context, input, output: root,
          effects: events[0].values, enabled: true }));
        const stageNames = ['cutoff', 'drive', 'crush', 'wow', 'width', 'compressor', 'makeup', 'output'];
        if (trace) {
          taps.output = root;
          const merge = createMerger(16);
          for (const [index, name] of stageNames.entries()) {
            const split = context.createChannelSplitter(2); taps[name].connect(split);
            split.connect(merge, 0, index * 2); split.connect(merge, 1, index * 2 + 1);
          }
          merge.connect(context.destination);
        } else root.connect(context.destination);
        input.start();
        const parameters: { frame: number; threshold: number; knee: number; ratio: number }[] = [];
        const capture = (frame: number) => parameters.push({ frame, threshold: compressor.threshold.value,
          knee: compressor.knee.value, ratio: compressor.ratio.value });
        const pauses = Array.from({ length: frames / 128 - 1 }, (_, i) => (i + 1) * 128).map(frame => context.suspend(frame / rate).then(async () => {
          capture(Math.round(context.currentTime * rate) - 128);
          const event = events.find(event => event.frame === frame);
          if (event) seeded(() => graph.apply(event.values, event.enabled)); await context.resume();
        }));
        const output = await context.startRendering(); await Promise.all(pauses); capture(frames - 128); graph.dispose();
        const read = (channel: number) => {
          const pcm = output.getChannelData(channel);
          return { samples: indices.map(i => pcm[i]), energy: pcm.reduce((sum, value) => sum + value * value, 0) };
        };
        cases.push({ rate, preset, events, parameters, channels: [0, 1].map(channel => read((trace ? 14 : 0) + channel)),
          stages: trace ? Object.fromEntries(stageNames.map((name, i) => [name, [read(i * 2), read(i * 2 + 1)]])) : {} });
      }
    }
    return { generator: 'Original effectChain.ts / audioPresets.ts; independent mono cutoff nodes; wow=0 (separate mono oracle); seeded LCG; WebKit OfflineAudioContext', frames, indices, cases };
  });
  expect(reference.cases).toHaveLength(20);
  await writeFile('ios/App/NativeTests/EffectGraphReference.json', JSON.stringify(reference) + '\n');
});

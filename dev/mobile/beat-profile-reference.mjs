import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'vite';
import * as ort from 'onnxruntime-node';

// beat-profile-reference.mjs — original desktop functions + actual fixed Node ORT, against a licensed fixed music window.
const [modelPath, inputPath, directory, ...extra] = process.argv.slice(2);
assert(modelPath && inputPath && directory && !extra.length, 'usage: model.onnx stereo44100.f32 NEW-directory');
assert.equal(ort.env.versions.node, '1.30.0');
const hash = data => createHash('sha256').update(data).digest('hex');
const model = (JSON.parse(await readFile('shared/modelManifest.json', 'utf8'))).models.find(m => m.name === 'beat_this');
assert.equal(hash(await readFile(modelPath)), model.sha256);
const source = await readFile(inputPath);
assert.equal(hash(source), '33ab08343bbe235478aba3835c5313083cfedf2caca038b67333bb867eb523aa');
await mkdir(directory); // Keep earlier evidence immutable.
await build({ configFile: false, publicDir: false, build: { target: 'esnext', outDir: directory, emptyOutDir: false,
  lib: { entry: 'dev/mobile/beat-reference-entry.ts', formats: ['es'], fileName: () => 'original.mjs' } } });
const original = await import(pathToFileURL(resolve(directory, 'original.mjs')).href);
const stereo = new Float32Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
const total = stereo.length / 2, mid = new Float32Array(total / 2), side = new Float32Array(total / 2);
// Fixed reference PCM, not a claim of decoder/resampler parity: select alternate samples, then original mid/side arithmetic.
for (let i = 0; i < mid.length; i++) { mid[i] = (stereo[i * 2] + stereo[total + i * 2]) / 2; side[i] = (stereo[i * 2] - stereo[total + i * 2]) / 2; }
const files = {};
async function save(name, data) {
  const bytes = ArrayBuffer.isView(data) ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data);
  await writeFile(join(directory, name), bytes, { flag: 'wx' }); files[name] = { bytes: bytes.length, sha256: hash(bytes) };
}
await save('mid.f32', mid); await save('side.f32', side);
const mel = await original.melSpectrogram(mid), chunks = original.splitForModel(mel), predictions = [], chunkRecords = [];
const session = await ort.InferenceSession.create(modelPath, { executionProviders: ['cpu'], intraOpNumThreads: 2,
  interOpNumThreads: 1, executionMode: 'sequential', graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false });
try {
  for (const [i, chunk] of chunks.entries()) {
    await save(`input-${i}.f32`, chunk.data);
    const tensor = new ort.Tensor('float32', chunk.data, [1, chunk.frames, 128]);
    const output = await session.run({ input_spectrogram: tensor });
    try {
      for (const name of ['beat', 'downbeat']) {
        assert.deepEqual(output[name].dims, [1, chunk.frames]);
        assert(output[name].data.every(Number.isFinite));
        await save(`${name}-${i}.f32`, output[name].data);
      }
      predictions.push({ start: chunk.start, frames: chunk.frames,
        beat: new Float32Array(output.beat.data), downbeat: new Float32Array(output.downbeat.data) });
      chunkRecords.push({ start: chunk.start, frames: chunk.frames });
      console.log(`reference chunk ${i + 1}/${chunks.length}`);
    } finally { tensor.dispose(); for (const value of Object.values(output)) value.dispose(); }
  }
} finally { await session.release(); }
const track = original.aggregateChunks(predictions, mel.frames), grid = original.beatsFromLogits(track.beat, track.downbeat);
await save('grid.json', JSON.stringify(grid));
for (const partial of [false, true]) await save(partial ? 'partial.json' : 'profile.json',
  JSON.stringify(await original.analyseTrack(mid, 22050, { side, partial, grid, gridless: false })));
const sources = {};
for (const path of ['src/services/automix/beatThis.ts', 'src/services/automix/trackProfile.ts', 'src/services/automix/signalAnalysis.ts',
  'dev/mobile/beat-reference-entry.ts', 'dev/mobile/beat-profile-reference.mjs']) sources[path] = hash(await readFile(path));
await writeFile(join(directory, 'report.json'), JSON.stringify({ modelSHA256: model.sha256, runtime: 'Node ORT 1.30.0',
  sourceAudioSHA256: hash(source), pcmFrames: mid.length, melFrames: mel.frames, chunks: chunkRecords,
  beats: grid.beats.length, downbeats: grid.downbeats.length, sources, files }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: 'PASS_ORIGINAL_BEAT_REFERENCE', frames: mel.frames, chunks: chunks.length, beats: grid.beats.length, downbeats: grid.downbeats.length }));

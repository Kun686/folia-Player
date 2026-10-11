import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { endianness } from 'node:os';
import { basename, join } from 'node:path';
import * as ort from 'onnxruntime-node';

// Independent reference for automix-runtime-probe.cpp, using the installed desktop runtime.
// Run under codex-bounded; never imports App code or rewrites the original ONNX model.
const [modelPath, inputPath, outputDirectory, ...extra] = process.argv.slice(2);
const windowMode = extra.length === 1 && extra[0] === '--window';
const options = { executionProviders: ['cpu'], intraOpNumThreads: 2,
    graphOptimizationLevel: 'all', enableCpuMemArena: false, ...(windowMode ? { enableMemPattern: false } : {}) };
const started = performance.now();
const checkpoints = [];
const sha256 = data => createHash('sha256').update(data).digest('hex');

async function fileHash(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}

function checkpoint(stage) {
    const value = { stage, elapsedMs: performance.now() - started,
        rssBytes: process.memoryUsage().rss, peakRSSBytes: process.resourceUsage().maxRSS * 1024 };
    checkpoints.push(value);
    console.log(JSON.stringify(value));
}

async function main() {
    assert(modelPath && inputPath && outputDirectory && (!extra.length || windowMode),
        'usage: node automix-node-probe.mjs model input.f32 NEW-output-directory [--window]');
    assert.equal(endianness(), 'LE', 'reference raw float32 files require little-endian host');
    assert.equal(ort.env.versions.node, '1.30.0', 'review a new reference runtime before changing versions');
    const manifest = JSON.parse(await readFile(new URL('../../shared/modelManifest.json', import.meta.url), 'utf8'));
    const model = manifest.models.find(item => item.file === basename(modelPath));
    assert(model && ['htdemucs', 'beat_this'].includes(model.name), 'expected an original Automix model');
    assert(!windowMode || model.name === 'htdemucs', 'window mode requires htdemucs');
    assert.equal((await stat(modelPath)).size, model.bytes, 'model size mismatch');
    assert.equal(await fileHash(modelPath), model.sha256, 'model SHA256 mismatch');
    checkpoint('verified_model');
    let session;
    let tensor;
    let result;
    const outputs = [];
    let inputSHA256;
    let shape;
    let windowContract;
    const chunks = [];
    try {
        session = await ort.InferenceSession.create(modelPath, options);
        checkpoint('loaded');
        assert.equal(session.inputMetadata.length, 1, 'expected one input');
        const input = session.inputMetadata[0];
        assert(input.isTensor && input.type === 'float32', 'expected float32 tensor');
        shape = model.name === 'beat_this' ? [1, 1500, 128] : input.shape;
        assert(shape.every(d => Number.isSafeInteger(d) && d > 0), 'unsupported shape');
        const count = shape.reduce((a, b) => a * b, 1);
        assert(count <= 10_000_000, 'input exceeds probe limit');
        const inputBytes = (await stat(inputPath)).size;
        if (windowMode) {
            assert(shape.length === 3 && shape[0] === 1 && shape[1] === 2, 'expected stereo model');
            assert(inputBytes > 0 && inputBytes % 8 === 0 && inputBytes <= 30 * 44100 * 8,
                'window must be planar stereo, nonempty and at most 30 seconds');
            const segment = shape[2], overlap = Math.floor(segment / 4);
            assert(overlap > 1, 'unsupported segment size');
            windowContract = { total: inputBytes / 8, segment, overlap, stride: segment - overlap };
        } else assert.equal(inputBytes, count * 4, 'input size mismatch');
        const bytes = await readFile(inputPath);
        inputSHA256 = sha256(bytes);
        const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        assert(samples.every(Number.isFinite), 'non-finite input');
        await mkdir(outputDirectory); // Must be new, so a reference run cannot overwrite prior evidence.
        const chunkCount = windowMode ? Math.ceil(windowContract.total / windowContract.stride) : 1;
        for (let chunk = 0; chunk < chunkCount; chunk++) {
            let inputSamples = samples;
            if (windowMode) {
                const { total, segment, stride } = windowContract;
                const start = chunk * stride, frames = Math.min(segment, total - start);
                inputSamples = new Float32Array(count);
                for (let channel = 0; channel < 2; channel++) {
                    inputSamples.set(samples.subarray(channel * total + start, channel * total + start + frames), channel * segment);
                }
                chunks.push({ chunk, start, frames, inputSHA256: sha256(Buffer.from(inputSamples.buffer)) });
            }
            tensor = new ort.Tensor('float32', inputSamples, shape);
            checkpoint(`before_run_${chunk}`);
            result = await session.run({ [input.name]: tensor });
            checkpoint(`ran_${chunk}`);
            for (const [index, name] of session.outputNames.entries()) {
                const output = result[name];
                assert(output?.data instanceof Float32Array, 'expected float32 output');
                let peak = 0;
                let squared = 0;
                for (const value of output.data) {
                    assert(Number.isFinite(value), 'non-finite model output');
                    peak = Math.max(peak, Math.abs(value));
                    squared += value * value;
                }
                const bytes = Buffer.from(output.data.buffer, output.data.byteOffset, output.data.byteLength);
                if (windowMode) assert.deepEqual(output.dims, [1, 4, 2, windowContract.segment]);
                const file = windowMode ? `${chunk}.${index}.f32` : `${index}.f32`;
                await writeFile(join(outputDirectory, file), bytes, { flag: 'wx' });
                outputs.push({ name, file, ...(windowMode ? { chunk } : {}), shape: output.dims, floats: output.data.length,
                    sha256: sha256(bytes), peak, rms: Math.sqrt(squared / output.data.length) });
            }
            for (const output of Object.values(result)) output.dispose();
            result = undefined;
            tensor.dispose();
            tensor = undefined;
        }
    } finally {
        for (const output of Object.values(result ?? {})) output.dispose();
        tensor?.dispose();
        await session?.release();
        checkpoint('released');
        assert.equal(await fileHash(modelPath), model.sha256, 'original model changed during probe');
    }
    const report = { status: 'PASS_REFERENCE_ONLY', runtime: ort.env.versions, node: process.version,
        platform: process.platform, arch: process.arch, model: model.name, modelSHA256: model.sha256,
        options, input: { sha256: inputSHA256, shape: windowMode ? [2, windowContract.total] : shape },
        ...(windowMode ? { window: windowContract, chunks } : {}), outputs, checkpoints };
    await writeFile(join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(report));
}

main().catch(error => { console.error(`FAILED: ${error.message}`); process.exitCode = 1; });

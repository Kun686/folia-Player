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
const options = { executionProviders: ['cpu'], intraOpNumThreads: 2,
    graphOptimizationLevel: 'all', enableCpuMemArena: false };
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
    assert(modelPath && inputPath && outputDirectory && !extra.length,
        'usage: node automix-node-probe.mjs model input.f32 NEW-output-directory');
    assert.equal(endianness(), 'LE', 'reference raw float32 files require little-endian host');
    assert.equal(ort.env.versions.node, '1.30.0', 'review a new reference runtime before changing versions');
    const manifest = JSON.parse(await readFile(new URL('../../shared/modelManifest.json', import.meta.url), 'utf8'));
    const model = manifest.models.find(item => item.file === basename(modelPath));
    assert(model && ['htdemucs', 'beat_this'].includes(model.name), 'expected an original Automix model');
    assert.equal((await stat(modelPath)).size, model.bytes, 'model size mismatch');
    assert.equal(await fileHash(modelPath), model.sha256, 'model SHA256 mismatch');
    checkpoint('verified_model');
    let session;
    let tensor;
    let result;
    const outputs = [];
    let inputSHA256;
    let shape;
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
        assert.equal((await stat(inputPath)).size, count * 4, 'input size mismatch');
        const bytes = await readFile(inputPath);
        inputSHA256 = sha256(bytes);
        const samples = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
        assert(samples.every(Number.isFinite), 'non-finite input');
        await mkdir(outputDirectory); // Must be new, so a reference run cannot overwrite prior evidence.
        tensor = new ort.Tensor('float32', samples, shape);
        checkpoint('before_run');
        result = await session.run({ [input.name]: tensor });
        checkpoint('ran');
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
            const file = `${index}.f32`;
            await writeFile(join(outputDirectory, file), bytes, { flag: 'wx' });
            outputs.push({ name, file, shape: output.dims, floats: output.data.length,
                sha256: sha256(bytes), peak, rms: Math.sqrt(squared / output.data.length) });
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
        options, input: { sha256: inputSHA256, shape }, outputs, checkpoints };
    await writeFile(join(outputDirectory, 'report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(report));
}

main().catch(error => { console.error(`FAILED: ${error.message}`); process.exitCode = 1; });

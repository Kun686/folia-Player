import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import { parse } from '@babel/parser';

// dev/mobile/automix-window-compare.mjs — inspect iPhone float differences through original storage/gesture code.
// A near-silent relative-error failure remains visible; it is not silently converted to a pass.
const [inputPath, referenceDirectory, actualPrefix, reportPath, ...extra] = process.argv.slice(2);
assert(inputPath && referenceDirectory && actualPrefix && reportPath && !extra.length,
    'usage: compare input.f32 original-directory native-output-prefix NEW-report.json');
const hash = data => createHash('sha256').update(data).digest('hex');
const raw = await readFile(inputPath);
assert(raw.length > 0 && raw.length % 8 === 0 && raw.length <= 30 * 44100 * 8);
const floats = bytes => new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
const mix = floats(raw), total = mix.length / 2;
assert(mix.every(Number.isFinite), 'non-finite input');
const originalReport = JSON.parse(await readFile(join(referenceDirectory, 'report.json'), 'utf8'));
assert.equal(originalReport.status, 'PASS_ORIGINAL_STITCHING_REFERENCE');
assert.equal(originalReport.inputSHA256, hash(raw), 'original reference belongs to a different input');
const stemsPath = new URL('../../src/services/automix/stems.ts', import.meta.url);
const gesturePath = new URL('../../src/services/automix/stemGesture.ts', import.meta.url);
const stemsSource = await readFile(stemsPath, 'utf8'), gestureSource = await readFile(gesturePath, 'utf8');
const ast = parse(stemsSource, { sourceType: 'module', plugins: ['typescript'] });
const names = new Set(['PCM_FULL_SCALE', 'peakOf', 'toPcm']);
const selected = ast.program.body.filter(statement => {
    const declaration = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
    return declaration?.type === 'VariableDeclaration' && declaration.declarations.some(d => names.has(d.id.name));
});
assert.equal(selected.length, 3, 'review original storage helper extraction');
const originalModule = async source => {
    const js = stripTypeScriptTypes(source, { mode: 'strip' });
    return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
};
const { peakOf, toPcm } = await originalModule(selected.map(s => stemsSource.slice(s.start, s.end)).join('\n'));
const { envelopeOf, lastVocalMoment } = await originalModule(gestureSource);
const reference = {}, actual = {};
for (const name of ['drums', 'bass', 'vocals']) {
    const bytes = await readFile(join(referenceDirectory, `${name}.f32`));
    assert.equal(hash(bytes), originalReport.outputs.find(o => o.name === name)?.sha256, 'reference output changed');
    reference[name] = floats(bytes);
    actual[name] = floats(await readFile(`${actualPrefix}.${name}.f32`));
    for (const values of [reference[name], actual[name]]) {
        assert.equal(values.length, mix.length);
        assert(values.every(Number.isFinite));
    }
}
// Same Number subtraction followed by Float32 storage as stems.ts; model row 2 is never substituted.
for (const parts of [reference, actual]) {
    parts.other = new Float32Array(mix.length);
    for (let i = 0; i < mix.length; i++)
        parts.other[i] = mix[i] - parts.drums[i] - parts.bass[i] - parts.vocals[i];
}
const split = values => [values.subarray(0, total), values.subarray(total)];
const records = [], decodedReference = [], decodedActual = [];
for (const name of ['drums', 'bass', 'other', 'vocals']) {
    const a = reference[name], b = actual[name];
    const gainA = peakOf(...split(a)), gainB = peakOf(...split(b));
    const pcmA = toPcm(...split(a), gainA), pcmB = toPcm(...split(b), gainB);
    let maxAbs = 0, squared = 0, referenceSquared = 0, changedPCM = 0, maxPCMUnits = 0;
    for (let i = 0; i < a.length; i++) {
        const delta = a[i] - b[i];
        maxAbs = Math.max(maxAbs, Math.abs(delta));
        squared += delta * delta;
        referenceSquared += a[i] * a[i];
        if (pcmA[i] !== pcmB[i]) changedPCM++;
        maxPCMUnits = Math.max(maxPCMUnits, Math.abs(pcmA[i] - pcmB[i]));
    }
    const relativeL2 = referenceSquared === 0 ? (squared === 0 ? 0 : null) : Math.sqrt(squared / referenceSquared);
    records.push({ stem: name, maxAbs, rmse: Math.sqrt(squared / a.length), referenceRMS: Math.sqrt(referenceSquared / a.length),
        relativeL2, originalFloatDiagnosticPass: maxAbs <= 1e-5 && relativeL2 !== null && relativeL2 <= 1e-4,
        referenceGain: gainA, actualGain: gainB, changedPCM, sampleCount: a.length, maxPCMUnits });
    assert.equal(gainA, gainB, 'this fixture should retain the same peak divisor');
    assert(maxPCMUnits <= 1, 'more than one stored PCM unit differs');
    decodedReference.push(Float32Array.from(pcmA, v => v / 32767 * gainA));
    decodedActual.push(Float32Array.from(pcmB, v => v / 32767 * gainB));
}
const mixEnvelope = envelopeOf(split(mix), 44100);
const gestureReference = lastVocalMoment(envelopeOf(split(reference.vocals), 44100), mixEnvelope);
const gestureActual = lastVocalMoment(envelopeOf(split(actual.vocals), 44100), mixEnvelope);
assert.equal(gestureActual, gestureReference, 'vocal exit decision differs');
let referenceMixError = 0, actualMixError = 0, mixDifference = 0;
for (let i = 0; i < mix.length; i++) {
    const a = decodedReference.reduce((sum, part) => sum + part[i], 0);
    const b = decodedActual.reduce((sum, part) => sum + part[i], 0);
    referenceMixError = Math.max(referenceMixError, Math.abs(a - mix[i]));
    actualMixError = Math.max(actualMixError, Math.abs(b - mix[i]));
    mixDifference = Math.max(mixDifference, Math.abs(a - b));
}
const result = { status: 'PASS_STORAGE_AND_VOCAL_EXIT_FOR_THIS_FIXTURE',
    note: 'Original float diagnostic failures remain in records; not a real-music listening test.',
    inputSHA256: hash(raw), sourceSHA256: { stems: hash(stemsSource), stemGesture: hash(gestureSource) },
    records, vocalExit: { reference: gestureReference, actual: gestureActual },
    decodedMix: { referenceMaxError: referenceMixError, actualMaxError: actualMixError, maxDifference: mixDifference } };
await writeFile(reportPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));

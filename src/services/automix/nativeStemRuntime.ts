import { CELL_SEC, incomingCurves, outgoingCurves, planStemHandover,
    OTHER_SWEEP_END, OTHER_SWEEP_HZ } from './stemGesture';
import { AUTOMIX_MIN_OVERLAP_SEC } from './transitionPlanner';
import { fail, numeric, numbers, object, read } from './nativeTransitionInput';
import type { StemName } from './stems';
import { stemBusParameters } from './stemBus';
import { stemWindowCoverage, stemWindowLate } from './stemWindow';
import { nativeExpansion } from './nativeExpansionRuntime';
import { expansionMask } from './expansionGesture';

// nativeStemRuntime.ts — original handover rules on measured envelopes; no PCM, inference or audio I/O.
// This boundary accepts one original 30-second separated window, never a whole song.
const MAX_WINDOW_SEC = 30;
const names: readonly StemName[] = ['vocals', 'drums', 'bass', 'other'];
const bar = (value: unknown): number | null => value === null ? null
    : numeric(value) && value > 0 && value <= MAX_WINDOW_SEC ? value : fail();

function plan(request: Record<string, unknown>) {
    const seconds = request.windowSec;
    if (!numeric(seconds) || seconds < AUTOMIX_MIN_OVERLAP_SEC || seconds > MAX_WINDOW_SEC) fail();
    const windowSec = seconds as number;
    const vocals = request.vocals, mix = request.mix, beats = request.downbeats;
    // The source rounds PCM frames, then floors 50ms cells. Allow its single-cell boundary rounding.
    const envelope = (value: unknown): value is number[] => numbers(value)
        && Math.abs(value.length - windowSec / CELL_SEC) <= 1.001
        && value.length <= MAX_WINDOW_SEC / CELL_SEC
        && value.every(cell => cell >= 0 && Number.isFinite(Math.fround(cell)));
    if (!envelope(vocals) || !envelope(mix) || vocals.length !== mix.length
        || !numbers(beats) || beats.length > 600
        || beats.some((at, index) => at < 0 || at > windowSec || (index > 0 && at <= beats[index - 1]))) fail();
    const incoming = object(request.incoming);
    for (const key of ['sings', 'keysClash']) {
        if (incoming[key] !== undefined && typeof incoming[key] !== 'boolean') fail();
    }
    // sings is the session's combined stem + structural evidence, not a guessed vocal-entry time.
    const handover = planStemHandover(windowSec, bar(request.outgoingBarSec), bar(request.incomingBarSec),
        beats as number[], new Float32Array(vocals as number[]), new Float32Array(mix as number[]), incoming);
    return { windowSec, handover,
        otherSweep: { fromHz: OTHER_SWEEP_HZ[0], toHz: OTHER_SWEEP_HZ[1], seconds: windowSec * OTHER_SWEEP_END } };
}

export function stemPlanJSON(text: string): string {
    return JSON.stringify(plan(read(text)));
}

export function expansionPlanJSON(text: string): string {
    const request = read(text), { windowSec, handover } = plan(request);
    const expansion = nativeExpansion(request, handover.swap, windowSec);
    return JSON.stringify(expansion ? { ...expansion, windowSec } : null);
}

export function stemBusJSON(text: string): string {
    read(text);
    const { curve, ...parameters } = stemBusParameters();
    return JSON.stringify({ ...parameters, curve: Array.from(curve) });
}

/** Only timing metadata crosses this bridge; full PCM stays in native memory. */
export function stemWindowJSON(text: string): string {
    const request = read(text);
    const values = ['outAt', 'outFrom', 'outFrames', 'inAt', 'inFrom', 'inFrames', 'seconds', 'lateBy'] as const;
    for (const key of values) if (!numeric(request[key]) || (request[key] as number) < 0) fail();
    const { outAt, outFrom, outFrames, inAt, inFrom, inFrames, seconds, lateBy } = request as Record<typeof values[number], number>;
    if (seconds < AUTOMIX_MIN_OVERLAP_SEC || seconds > MAX_WINDOW_SEC
        || [outFrames, inFrames].some(frames => !Number.isInteger(frames) || frames < 1 || frames > 1_323_000)) fail();
    const { offset, inOffset, length, covered } = stemWindowCoverage(outAt, outFrom, outFrames, inAt, inFrom, inFrames, seconds, 44100);
    if (!covered) return JSON.stringify({ covered: false, late: 0 });
    const late = stemWindowLate(lateBy, 0, outFrames, inFrames, offset, inOffset, length, 44100);
    return JSON.stringify({ covered: true, late, expansionOffset: offset + Math.round(late * 44100), length });
}

/** One Float32 curve per bounded response; retains all original 200Hz samples, including both ends. */
export function stemCurveJSON(text: string): string {
    const request = read(text);
    if ((request.direction !== 'out' && request.direction !== 'in') || !names.includes(request.stem as StemName)) fail();
    const { windowSec, handover } = plan(request);
    const curves = request.direction === 'out' ? outgoingCurves(windowSec, handover) : incomingCurves(windowSec, handover);
    const expansion = nativeExpansion(request, handover.swap, windowSec);
    if (request.direction === 'out' && expansion?.stems.includes(request.stem as StemName)) {
        const mask = expansionMask(windowSec, expansion), curve = curves[request.stem as StemName];
        for (let i = 0; i < curve.length; i++) curve[i] *= mask[i];
    }
    return JSON.stringify(Array.from(curves[request.stem as StemName]));
}

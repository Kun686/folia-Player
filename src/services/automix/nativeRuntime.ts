import { isTransitionMode, planForMode, type TransitionSettings } from './transitionStrategy';
import type { TransitionPlan, TransitionTrack } from './transitionPlanner';
import { shapeBlend, type TransitionStyle } from './transitionChooser';
import { buildBandCurves, buildCrossfadeCurves, planBlendShape } from './signalAnalysis';
import { TRACK_PROFILE_VERSION } from './trackProfile';

// nativeRuntime.ts — JSON boundary for the original planners, bundled for Apple's JavaScriptCore.
export const protocolVersion = 1;
const styles: TransitionStyle[] = ['beatCut', 'bassSwap', 'tailRide', 'plainBlend'];
const fail = (): never => { throw new Error('invalid-transition-input'); };
const object = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : fail();
const numeric = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalNumber = (value: unknown): boolean => value === null || numeric(value);
const numbers = (value: unknown, length?: number): value is number[] =>
    Array.isArray(value) && (length === undefined || value.length === length) && value.every(numeric);

function read(text: string): Record<string, unknown> {
    if (typeof text !== 'string' || text.length > 262144) fail();
    const value: unknown = JSON.parse(text);
    // Bound work before invoking the planner; non-finite JSON exponents are also rejected.
    let nodes = 0;
    function visit(item: unknown, depth: number): void {
        if (++nodes > 20000 || depth > 12) fail();
        if (typeof item === 'number' && !Number.isFinite(item)) fail();
        if (typeof item === 'string' && item.length > 4096) fail();
        if (item && typeof item === 'object') Object.values(item).forEach(child => visit(child, depth + 1));
    }
    visit(value, 0);
    const request = object(value);
    if (request.version !== protocolVersion) fail();
    return request;
}

function track(value: unknown): TransitionTrack {
    const data = object(value);
    if (!numeric(data.duration) || data.duration < 0) fail();
    if (data.lines !== null) {
        if (!Array.isArray(data.lines) || data.lines.length > 2000) fail();
        for (const raw of data.lines as unknown[]) {
            const line = object(raw);
            if (!numeric(line.startTime) || !numeric(line.endTime) || typeof line.fullText !== 'string'
                || !Array.isArray(line.words)) fail();
        }
    }
    if (data.vocalEnd !== undefined && !optionalNumber(data.vocalEnd)) fail();
    if (data.separated != null) {
        const window = object(data.separated);
        if (!numeric(window.from) || !numeric(window.to) || window.from > window.to) fail();
    }
    if (data.profile != null) {
        const profile = object(data.profile);
        if (profile.version !== TRACK_PROFILE_VERSION) fail();
        for (const key of ['duration', 'leadIn', 'introSlope', 'loudness', 'headDb', 'beatOffset', 'beatsPerBar', 'key', 'keyConfidence']) {
            if (!numeric(profile[key])) fail();
        }
        for (const key of ['vocalStart', 'sectionStart', 'leadOut', 'bodyOut', 'outroSlope', 'tailDb', 'bpm', 'outroBpm', 'downbeatOffset', 'headDownbeatOffset']) {
            if (!optionalNumber(profile[key])) fail();
        }
        for (const key of ['partial', 'startsHot', 'major']) if (typeof profile[key] !== 'boolean') fail();
        if (profile.endsHot !== null && typeof profile.endsHot !== 'boolean') fail();
        if (!numbers(profile.sections) || !numbers(profile.introTone, 3)
            || (profile.outroTone !== null && !numbers(profile.outroTone, 3))) fail();
        for (const key of ['introKey', 'outroKey']) {
            if (key === 'outroKey' && profile[key] === null) continue;
            const estimate = object(profile[key]);
            if (!numeric(estimate.key) || !numeric(estimate.confidence) || typeof estimate.major !== 'boolean') fail();
        }
    }
    return data as unknown as TransitionTrack;
}

export function planJSON(text: string): string {
    const request = read(text), settings = object(request.settings);
    if (!isTransitionMode(settings.mode) || !numeric(settings.crossfadeMaxSec)
        || typeof settings.performance !== 'boolean' || !optionalNumber(request.bpm)
        || !numeric(request.at) || request.at < 0) fail();
    const plan = planForMode(settings as unknown as TransitionSettings, track(request.from), track(request.to),
        request.bpm as number | null, request.at as number);
    return JSON.stringify(plan);
}

export function envelopeJSON(text: string): string {
    const request = read(text), plan = object(request.plan), timing = object(request.timing);
    if (!styles.includes(plan.style as TransitionStyle) || !numeric(plan.minOverlap) || plan.minOverlap < 0
        || !numbers(plan.tiltDb, 2)) fail();
    for (const key of ['overlap', 'remaining']) if (!numeric(timing[key]) || (timing[key] as number) < 0) fail();
    if ((timing.overlap as number) > (timing.remaining as number)) fail();
    for (const key of ['outgoingDb', 'nextBeatIn', 'periodSec', 'incomingLeadIn']) if (!optionalNumber(timing[key])) fail();
    const fade = planBlendShape({ overlap: timing.overlap as number, outgoingDb: timing.outgoingDb as number | null,
        nextBeatIn: timing.nextBeatIn as number | null, periodSec: timing.periodSec as number | null,
        minOverlap: plan.minOverlap as number, maxOverlap: timing.remaining as number });
    const shape = shapeBlend({ style: plan.style as TransitionStyle, room: timing.overlap as number,
        overlap: fade.overlap, crossover: fade.crossover, nextBeatIn: timing.nextBeatIn as number | null,
        periodSec: timing.periodSec as number | null, incomingLeadIn: timing.incomingLeadIn as number | null });
    const gain = buildCrossfadeCurves(shape.crossover, shape.together);
    const bands = shape.shapeBands ? buildBandCurves({ crossover: shape.crossover, swapBass: true,
        sweepOut: shape.sweepOut, tiltDb: plan.tiltDb as TransitionPlan['tiltDb'] }) : null;
    return JSON.stringify({ ...shape, snappedToBeat: fade.snappedToBeat,
        gain: { out: Array.from(gain.out), in: Array.from(gain.in) },
        bands: bands ? { out: bands.out.map(row => Array.from(row)), in: bands.in.map(row => Array.from(row)) } : null });
}

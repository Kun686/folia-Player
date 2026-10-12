import { isTransitionMode, planForMode, type TransitionSettings } from './transitionStrategy';
import type { TransitionPlan, TransitionTrack } from './transitionPlanner';
import type { StyledBlend, TransitionStyle } from './transitionChooser';
import { buildBandCurves, buildCrossfadeCurves, dbToGain } from './signalAnalysis';
import { TRACK_PROFILE_VERSION } from './trackProfile';
import { BALANCE_INTERVAL_MS, BALANCE_RAMP_SEC, nextBalanceTrim } from './balanceCorrection';
import { AUTOMIX_MIN_OVERLAP_SEC } from './transitionPlanner';
import { echoThrowAt, planEchoThrow } from './echoThrow';
import { handoverWindow, handoverStretch, handoverPeriod, handoverBeatGrid, waitToGrid, shapeMasterHandover, masterHandoverCue } from './masterHandover';
import { tempoBendRate } from './tempoBend';
import { calculateReplayGain } from '../../utils/replayGain';
import type { ReplayGainInfo } from '../../types';
import { fail, object, numeric, optionalNumber, numbers, read } from './nativeTransitionInput';

// nativeRuntime.ts — JSON boundary for the original planners, bundled for Apple's JavaScriptCore.
export { protocolVersion } from './nativeTransitionInput';
export { stemPlanJSON, stemCurveJSON, stemBusJSON, stemWindowJSON, expansionPlanJSON } from './nativeStemRuntime';
export { renderExpansionPCM } from './nativeExpansionRuntime';
const styles: TransitionStyle[] = ['beatCut', 'bassSwap', 'tailRide', 'plainBlend'];

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
    if (plan.echoThrow !== undefined && typeof plan.echoThrow !== 'boolean') fail();
    for (const key of ['overlap', 'remaining']) if (!numeric(timing[key]) || (timing[key] as number) < 0) fail();
    if ((timing.overlap as number) > (timing.remaining as number)) fail();
    for (const key of ['outgoingDb', 'nextBeatIn', 'periodSec', 'incomingLeadIn']) if (!optionalNumber(timing[key])) fail();
    const { fade, shape } = shapeMasterHandover({ style: plan.style as TransitionStyle, minOverlap: plan.minOverlap as number }, {
        overlap: timing.overlap as number, outgoingDb: timing.outgoingDb as number | null,
        nextBeatIn: timing.nextBeatIn as number | null, periodSec: timing.periodSec as number | null,
        remaining: timing.remaining as number, incomingLeadIn: timing.incomingLeadIn as number | null });
    return JSON.stringify({ ...shape, snappedToBeat: fade.snappedToBeat,
        ...(plan.echoThrow ? { echo: planEchoThrow(echoThrowAt(shape.hold, shape.style, shape.overlap, shape.crossover),
            timing.periodSec as number | null, 0) } : {}), ...curves(shape, plan.tiltDb as TransitionPlan['tiltDb']) });
}

function curves(shape: StyledBlend, tiltDb: TransitionPlan['tiltDb']) {
    const gain = buildCrossfadeCurves(shape.crossover, shape.together);
    const bands = shape.shapeBands ? buildBandCurves({ crossover: shape.crossover, swapBass: true,
        sweepOut: shape.sweepOut, tiltDb }) : null;
    return { gain: { out: Array.from(gain.out), in: Array.from(gain.in) },
        bands: bands ? { out: bands.out.map(row => Array.from(row)), in: bands.in.map(row => Array.from(row)) } : null };
}

// A first call asks for the rate; a second uses the rate actually adopted by the system output.
// nextBeatIn is the live analyser's answer at the projected start, as in automixSession.
export function masterJSON(text: string): string {
    const request = read(text), raw = object(request.plan), timing = object(request.timing);
    if (!['fade', 'hardCut'].includes(raw.kind as string) || !styles.includes(raw.style as TransitionStyle)
        || !numbers(raw.tiltDb, 2) || typeof raw.echoThrow !== 'boolean') fail();
    for (const key of ['outStart', 'overlap', 'minOverlap', 'stretch']) {
        if (!numeric(raw[key]) || (raw[key] as number) < 0) fail();
    }
    if ((raw.stretch as number) < 0.88 || (raw.stretch as number) > 1.12) fail();
    for (const key of ['position', 'tailRate']) if (!numeric(timing[key]) || (timing[key] as number) < 0) fail();
    if (!(timing.tailRate as number > 0)) fail();
    for (const key of ['appliedRate', 'outgoingDb', 'periodSec', 'nextBeatIn']) if (!optionalNumber(timing[key])) fail();
    if (timing.appliedRate !== null && ((timing.appliedRate as number) < 0.879999 || (timing.appliedRate as number) > 1.120001)) fail();
    if (timing.periodSec !== null && (timing.periodSec as number) <= 0) fail();
    if (timing.nextBeatIn !== null && (timing.nextBeatIn as number) < 0) fail();
    const from = track(request.from), to = track(request.to), plan = raw as unknown as TransitionPlan;
    const { startMedia, remaining, overlap } = handoverWindow(plan, from.duration, timing.position as number);
    const requestedRate = overlap > 0 ? tempoBendRate(handoverStretch(plan, overlap, false)) : 1;
    if (overlap <= 0 || timing.appliedRate === null) return JSON.stringify({ requestedRate, mediaOverlap: overlap, envelope: null, cue: null });
    const applied = timing.appliedRate as number, tailRate = timing.tailRate as number;
    const periodSec = handoverPeriod(from.profile, timing.periodSec as number | null);
    const alignHold = Math.max(0, (startMedia - (timing.position as number)) / (tailRate * applied));
    const nextBeatIn = waitToGrid(handoverBeatGrid(from.profile), startMedia, tailRate * applied) ?? timing.nextBeatIn as number | null;
    const { fade, shape } = shapeMasterHandover(plan, { overlap, remaining, periodSec, nextBeatIn,
        outgoingDb: timing.outgoingDb as number | null, incomingLeadIn: to.profile?.leadIn ?? null });
    const hold = alignHold + shape.hold, wall = shape.overlap / applied;
    return JSON.stringify({ requestedRate, mediaOverlap: shape.overlap,
        envelope: { ...shape, hold, overlap: wall, snappedToBeat: fade.snappedToBeat, ...curves(shape, plan.tiltDb),
            ...(plan.echoThrow ? { echo: planEchoThrow(echoThrowAt(hold, shape.style, wall, shape.crossover), periodSec, 0) } : {}) },
        cue: masterHandoverCue(hold, wall, shape.crossover, periodSec, applied, shape.style === 'plainBlend') });
}

export function balanceJSON(text: string): string {
    const request = read(text);
    if (!optionalNumber(request.outgoingDb) || !optionalNumber(request.incomingDb)
        || !numeric(request.appliedDb) || request.appliedDb < 0
        || !numeric(request.overlap) || request.overlap < 0) fail();
    const trimDb = (request.overlap as number) >= AUTOMIX_MIN_OVERLAP_SEC
        ? nextBalanceTrim(request.outgoingDb as number | null, request.incomingDb as number | null, request.appliedDb as number)
        : null;
    return JSON.stringify({ intervalMs: BALANCE_INTERVAL_MS, minOverlap: AUTOMIX_MIN_OVERLAP_SEC,
        adjustment: trimDb === null ? null : { trimDb, gain: dbToGain(-trimDb), seconds: BALANCE_RAMP_SEC } });
}

export function echoJSON(text: string): string {
    const request = read(text);
    if (!numeric(request.at) || request.at < 0 || request.at > 50 || !optionalNumber(request.periodSec)) fail();
    return JSON.stringify(planEchoThrow(request.at as number, request.periodSec as number | null, 0));
}

// Precompute both modes outside the audio thread; Swift only ramps these original amplitudes.
export function replayGainJSON(text: string): string {
    const request = read(text);
    const info = request.info == null ? undefined : object(request.info) as ReplayGainInfo;
    const gain = (mode: 'track' | 'album') => {
        const value = calculateReplayGain(info, mode).linearGain;
        // Corrupt tags must not inject Infinity into float PCM.
        return Number.isFinite(value) && value >= 0 && value <= 3.4028234663852886e38 ? value : 1;
    };
    return JSON.stringify({ track: gain('track'), album: gain('album') });
}

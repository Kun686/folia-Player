import { settledBpm, type Grid } from './musicalTime';
import { planBlendShape } from './signalAnalysis';
import { shapeBlend } from './transitionChooser';
import { AUTOMIX_MIN_OVERLAP_SEC, resolveOverlap, type TransitionPlan } from './transitionPlanner';
import type { TrackProfile } from './trackProfile';
import type { TransitionCue } from './transitionCue';

// masterHandover.ts — the original session's media/wall-clock arithmetic, shared with native playback.
/** Longest silent alignment hold; waiting consumes the outgoing track's remaining tail. */
const MAX_ALIGN_HOLD_SEC = 1;

export function handoverWindow(plan: TransitionPlan, duration: number, position: number) {
    const soundingLeft = Math.min(duration, plan.outStart + plan.overlap);
    const startMedia = Math.min(Math.max(position, Math.min(plan.outStart, soundingLeft)), position + MAX_ALIGN_HOLD_SEC);
    const remaining = soundingLeft - startMedia;
    return { startMedia, remaining, overlap: resolveOverlap(plan, remaining) };
}

export const handoverStretch = (plan: TransitionPlan, overlap: number, useStems: boolean): number =>
    plan.style === 'beatCut' || overlap < AUTOMIX_MIN_OVERLAP_SEC || useStems ? 1 : plan.stretch;

/** Seconds of WALL time to the next line of the outgoing track's own media grid. */
export function waitToGrid(grid: Grid | null, fromMedia: number, rate: number): number | null {
    if (!grid || !(grid.period > 0) || !(rate > 0)) return null;
    const next = grid.offset + Math.ceil((fromMedia - grid.offset) / grid.period) * grid.period;
    return (next - fromMedia) / rate;
}

export function handoverBeatGrid(profile: TrackProfile | null | undefined): Grid | null {
    const steady = profile?.bpm
        && (profile.outroBpm === null || Math.abs((profile.outroBpm ?? 0) - profile.bpm) < 0.5);
    return steady && profile?.bpm
        ? { offset: profile.beatOffset % (60 / profile.bpm), period: 60 / profile.bpm } : null;
}

export function handoverPeriod(profile: TrackProfile | null | undefined, livePeriod: number | null): number | null {
    const bpm = settledBpm(profile?.bpm, profile?.outroBpm);
    return bpm ? 60 / bpm : livePeriod;
}

export function shapeMasterHandover(plan: Pick<TransitionPlan, 'style' | 'minOverlap'>, timing: {
    overlap: number; remaining: number; outgoingDb: number | null; nextBeatIn: number | null;
    periodSec: number | null; incomingLeadIn: number | null;
}) {
    const fade = planBlendShape({ overlap: timing.overlap, outgoingDb: timing.outgoingDb,
        nextBeatIn: timing.nextBeatIn, periodSec: timing.periodSec, minOverlap: plan.minOverlap, maxOverlap: timing.remaining });
    const shape = shapeBlend({ style: plan.style, room: timing.overlap, overlap: fade.overlap,
        crossover: fade.crossover, nextBeatIn: timing.nextBeatIn, periodSec: timing.periodSec, incomingLeadIn: timing.incomingLeadIn });
    return { fade, shape };
}

/** The cue describes the schedule actually used, including hold and the outgoing rate. */
export function masterHandoverCue(hold: number, wall: number, crossover: number,
    periodSec: number | null, applied: number, plain: boolean): TransitionCue {
    return { seconds: hold + wall, crossover: hold + wall > 0 ? (hold + wall * crossover) / (hold + wall) : 0,
        periodSec: periodSec === null ? null : periodSec / applied, ...(plain ? { plain: true } as const : {}) };
}

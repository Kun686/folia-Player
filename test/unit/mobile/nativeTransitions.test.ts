import { describe, expect, it } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { planJSON, envelopeJSON } from '@/services/automix/nativeRuntime';
import { planForMode, type TransitionSettings } from '@/services/automix/transitionStrategy';
import { shapeBlend, type TransitionStyle } from '@/services/automix/transitionChooser';
import { buildBandCurves, buildCrossfadeCurves, planBlendShape } from '@/services/automix/signalAnalysis';
import type { TransitionTrack } from '@/services/automix/transitionPlanner';
import { makeProfile } from '../automix/trackProfileFixture';

// nativeTransitions.test.ts — original functions are the reference, not a second planner implementation.
const encode = (value: unknown) => JSON.stringify(value);
const plain = (value: unknown) => JSON.parse(encode(value));
const bare = (duration = 200): TransitionTrack => ({ duration, lines: null, profile: null });
const trackPairs: [TransitionTrack, TransitionTrack][] = [
    [bare(), bare(180)], [bare(0), bare()], [bare(2), bare(3)],
    [{ ...bare(), lines: [{ startTime: 1000, endTime: 170000, fullText: 'vocal tail', words: [] }] }, bare()],
    [{ ...bare(), profile: makeProfile({ endsHot: true }) }, { ...bare(), profile: makeProfile({ startsHot: true }) }],
    [{ ...bare(), profile: makeProfile({ endsHot: false }) }, { ...bare(), profile: makeProfile({ startsHot: false, leadIn: 4 }) }],
    [{ ...bare(), profile: makeProfile({ endsHot: true, outroSlope: -3 }) }, { ...bare(), profile: makeProfile({ startsHot: false }) }],
    [{ ...bare(), profile: makeProfile({ outroBpm: 100, bpm: 100 }) }, { ...bare(), profile: makeProfile({ bpm: 130, leadIn: 2 }) }],
    [{ ...bare(), profile: makeProfile({ bpm: 100, outroBpm: 100, headDownbeatOffset: 0.3, downbeatOffset: 0.4 }) },
        { ...bare(), profile: makeProfile({ bpm: 110, downbeatOffset: 0.2, headDownbeatOffset: 0.1 }) }],
    [{ ...bare(), vocalEnd: 182, separated: { from: 170, to: 200 }, profile: makeProfile({ bodyOut: 10, leadOut: 2, sections: [170, 184] }) },
        { ...bare(), separated: { from: 0, to: 30 }, profile: makeProfile({ leadIn: 1, vocalStart: 12, sectionStart: 9, introTone: [0.1, 0.2, 0.7] }) }],
];
const plans = trackPairs.flatMap(([from, to], pair) => (['crossfade', 'automix'] as const).flatMap(mode =>
    [false, true].flatMap(performance => [0, 197].map(at => {
        const settings: TransitionSettings = { mode, crossfadeMaxSec: 12, performance };
        const bpm = pair === 3 ? 120 : null;
        return { name: `${pair}-${mode}-${performance}-${at}`, input: { version: 1, settings, from, to, bpm, at },
            expected: plain(planForMode(settings, from, to, bpm, at)) };
    }))));
const envelopes = (['beatCut', 'bassSwap', 'tailRide', 'plainBlend'] as TransitionStyle[]).flatMap(style =>
    [null, -12, -38].flatMap(outgoingDb => [null, 0.15, 0.4].map(nextBeatIn => {
        const plan = { style, minOverlap: style === 'beatCut' ? 0.15 : 0.8, tiltDb: [2, -3] as [number, number] };
        const timing = { overlap: 7, remaining: 9, outgoingDb, nextBeatIn, periodSec: nextBeatIn === null ? null : 0.5, incomingLeadIn: 1 };
        const fade = planBlendShape({ ...timing, minOverlap: plan.minOverlap, maxOverlap: timing.remaining });
        const shape = shapeBlend({ ...timing, style, room: timing.overlap, overlap: fade.overlap, crossover: fade.crossover });
        const gain = buildCrossfadeCurves(shape.crossover, shape.together);
        const bands = shape.shapeBands ? buildBandCurves({ crossover: shape.crossover, swapBass: true, sweepOut: shape.sweepOut, tiltDb: plan.tiltDb }) : null;
        return { name: `${style}-${outgoingDb}-${nextBeatIn}`, input: { version: 1, plan, timing }, expected: {
            ...shape, snappedToBeat: fade.snappedToBeat, gain: { out: [...gain.out], in: [...gain.in] },
            bands: bands ? { out: bands.out.map(row => [...row]), in: bands.in.map(row => [...row]) } : null,
        } };
    })));
const fixture = { version: 1, plans, envelopes };
const fixtureURL = new URL('../../../ios/App/NativeTests/TransitionReference.json', import.meta.url);

describe('native transition boundary', () => {
    it('preserves original plan choices, fallback, timing, stretching and performance strength', () => {
        for (const row of plans) expect(JSON.parse(planJSON(encode(row.input))), row.name).toEqual(row.expected);
        expect(new Set(plans.filter(row => row.input.at === 0).map(row => row.expected.style))).toEqual(
            new Set(['plainBlend', 'beatCut', 'bassSwap', 'tailRide']));
        expect(plans.some(row => row.expected.stretch !== 1)).toBe(true);
    });
    it('preserves four original shapes and every Float32 gain/band curve sample', () => {
        // JSON represents both signs of zero as 0; every nonzero Float32 sample remains exact.
        for (const row of envelopes) expect(JSON.parse(envelopeJSON(encode(row.input))), row.name).toEqual(plain(row.expected));
    });
    it('rejects malformed or excessive input without poisoning the next calculation', () => {
        const valid = plans[0].input;
        for (const input of ['{', 'null', ' '.repeat(262145), encode({ ...valid, version: 2 }),
            encode({ ...valid, from: { duration: 100, lines: {}, profile: null } }),
            encode({ ...valid, from: { ...bare(), profile: { version: 1 } } }),
            encode({ ...valid, at: -1 }), encode({ ...valid, settings: { ...valid.settings, mode: 'unknown' } }),
            encode(valid).replace('"duration":200', '"duration":1e999')]) {
            expect(() => planJSON(input)).toThrow();
        }
        expect(() => envelopeJSON(encode({ ...envelopes[0].input, timing: { ...envelopes[0].input.timing, remaining: 0 } }))).toThrow();
        expect(JSON.parse(planJSON(encode(valid)))).toEqual(plans[0].expected);
    });
    it('keeps the committed native reference tied to the original functions', () => {
        if (process.env.FOLIA_TRANSITION_REFERENCE === '1') writeFileSync(fixtureURL, encode(fixture) + '\n');
        expect(JSON.parse(readFileSync(fixtureURL, 'utf8'))).toEqual(plain(fixture));
    });
});

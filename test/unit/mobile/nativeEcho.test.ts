import { expect, it } from 'vitest';
import { echoJSON, envelopeJSON } from '../../../src/services/automix/nativeRuntime';
import { echoThrowAt, planEchoThrow } from '../../../src/services/automix/echoThrow';

// nativeEcho.test.ts — original schedule ranges, cut timing and unchanged dry-only envelope schema.
it.each([null, -1, 0, 0.01, 0.33333333, 0.5, 8])('shares original throw scheduling for period %s', periodSec => {
    for (const at of [0, 0.13751, 0.4, 25]) {
        expect(JSON.parse(echoJSON(JSON.stringify({ version: 1, at, periodSec })))).toEqual(planEchoThrow(at, periodSec, 0));
    }
});
it('keeps the late-send guard and original repeat bounds', () => {
    expect(planEchoThrow(1, null, 2)).toEqual({ delay: 0.25, opensAt: 2, peaksAt: 2.001,
        closesAt: 2.001 + 0.03, send: 0.6, feedback: 0.45, defaultDelay: 0.25 });
    expect(planEchoThrow(1, 0.01, 0).delay).toBe(0.08);
    expect(planEchoThrow(1, 8, 0).delay).toBe(1);
    expect(echoThrowAt(2, 'beatCut', 4, 0.6)).toBe(2);
    expect(echoThrowAt(2, 'bassSwap', 4, 0.6)).toBe(4.4);
});
it('adds a throw only when the original plan requests one', () => {
    const request = { version: 1, plan: { style: 'bassSwap', minOverlap: 0.8, tiltDb: [0, 0], echoThrow: false },
        timing: { overlap: 3, remaining: 4, outgoingDb: null, nextBeatIn: null, periodSec: 0.5, incomingLeadIn: null } };
    const dry = JSON.parse(envelopeJSON(JSON.stringify(request)));
    expect(dry.echo).toBeUndefined(); request.plan.echoThrow = true;
    const wet = JSON.parse(envelopeJSON(JSON.stringify(request)));
    expect(wet.echo).toEqual(planEchoThrow(echoThrowAt(wet.hold, wet.style, wet.overlap, wet.crossover), 0.5, 0));
    delete wet.echo; expect(wet).toEqual(dry);
    for (const value of [{ at: -1, periodSec: null }, { at: 2, periodSec: 'fast' }, { at: 51, periodSec: null }]) {
        expect(() => echoJSON(JSON.stringify({ version: 1, ...value }))).toThrow();
    }
});

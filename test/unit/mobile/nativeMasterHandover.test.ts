import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { masterJSON } from '@/services/automix/nativeRuntime';
import { createAutomixSession } from '@/services/automix/automixSession';
import { planForMode } from '@/services/automix/transitionStrategy';
import { subscribeToTransitionCue, type TransitionCue } from '@/services/automix/transitionCue';
import { makeProfile } from '../automix/trackProfileFixture';
import { handoverStretch } from '@/services/automix/masterHandover';
import { tempoBendRate } from '@/services/automix/tempoBend';
import { asElement, createFakeChain, createFakeContext, createFakeElement, lastCurve } from '../automix/fakeAudioGraph';

// Compare native schedules to the commands emitted by the existing Web Audio session.
const json = (value: unknown) => JSON.stringify(value);
const plain = (value: unknown) => JSON.parse(json(value));
const fixtureURL = new URL('../../../ios/App/NativeTests/MasterHandoverReference.json', import.meta.url);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('native master handover', () => {
  it('keeps both stream clocks unbent only when the original session can attempt a stem gesture', () => {
    const from = { duration: 200, lines: null, profile: makeProfile() };
    const to = { duration: 200, lines: null, profile: makeProfile({ bpm: 132, outroBpm: 132 }) };
    const original = planForMode({ mode: 'automix', crossfadeMaxSec: 5, performance: false }, from, to, 120, 0);
    expect(original.stretch).toBeGreaterThan(1);
    for (const style of ['bassSwap', 'tailRide', 'plainBlend', 'beatCut'] as const) {
      for (const overlap of [0.4, 0.8, 4]) for (const pair of [0, 1, 2, 3]) {
        const plan = { ...original, style, outStart: 190, overlap, minOverlap: 0.8 };
        const input = { version: 1, plan,
          from: { ...from, separated: pair & 1 ? { from: 170, to: 200 } : null },
          to: { ...to, separated: pair & 2 ? { from: 0, to: 30 } : null },
          timing: { position: 190, tailRate: 1, appliedRate: null, outgoingDb: null, periodSec: null, nextBeatIn: null } };
        const allowed = pair === 3 && style !== 'beatCut' && overlap >= 0.8;
        const expected = tempoBendRate(handoverStretch(plan, overlap, allowed));
        const result = JSON.parse(masterJSON(json(input)));
        expect(result.requestedRate).toBe(expected);
        if (allowed) expect(result.requestedRate).toBe(1);
        expect(result.envelope).toBeNull();
        const adopted = JSON.parse(masterJSON(json({ ...input, timing: { ...input.timing, appliedRate: expected } })));
        if (overlap < plan.minOverlap) {
          expect(adopted.mediaOverlap).toBe(0);
          expect(adopted.envelope).toBeNull();
          expect(adopted.cue).toBeNull();
          continue;
        }
        expect(adopted.envelope).not.toBeNull();
        expect(adopted.envelope.overlap * expected).toBeCloseTo(adopted.mediaOverlap, 12);
      }
    }
  });
  it('matches the desktop session gain curves, wall duration, beat cue and style across real planner branches', () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    const rows: unknown[] = [], seen = new Set<string>(), rates = new Set<number>();
    for (const kind of ['bare', 'tail', 'bass', 'cut'] as const) {
      for (const bpm of [106, 120, 132]) for (const offset of [-0.2, 0.15]) {
        const from = { duration: 200, lines: null, profile: kind === 'bare' ? null
          : makeProfile({ bpm: 120, outroBpm: 120, endsHot: kind !== 'tail', beatOffset: 0.13 }) };
        const to = { duration: 200, lines: null, profile: kind === 'bare' ? null
          : makeProfile({ bpm, outroBpm: bpm, leadIn: kind === 'cut' ? 1 : 0.15, startsHot: kind === 'cut' }) };
        const settings = { mode: 'automix' as const, crossfadeMaxSec: 5, performance: false };
        const planned = planForMode(settings, from, to, from.profile?.bpm ?? 120, 0);
        const armedAt = Math.max(0, planned.outStart - 0.2);
        const elements = { A: createFakeElement(200, armedAt), B: createFakeElement(200, 0) };
        const chains = { A: createFakeChain({ bpm: 120, loudnessDb: -16, nextBeatIn: 0.21 }), B: createFakeChain() };
        const context = createFakeContext();
        let cue: TransitionCue | null = null;
        const unsubscribe = subscribeToTransitionCue(value => { if (value) cue = value; });
        const session = createAutomixSession({ getContext: () => context, getElement: deck => asElement(elements[deck]),
          getChain: deck => chains[deck], onActiveDeckChange: () => {}, onTailSrcChange: () => {},
          onAutoplayHoldChange: () => {}, advanceTrack: () => {} });
        try {
          const plan = session.requestTransition({ time: armedAt, audioSrc: 'outgoing', fromKey: 'a', nextKey: 'b', from, to, settings })!;
          expect(plan.kind).toBe('fade');
          expect(session.getPhase()).toBe('armed');
          // Arm first, then model an early/late start. Replanning after the point can choose the next bar.
          const position = Math.max(0, plan.outStart + offset);
          elements.A.currentTime = position;
          session.handleActiveDeckPlaying('b');
          const input = { version: 1, plan, from, to, timing: { position, tailRate: 1,
            appliedRate: elements.A.playbackRate, outgoingDb: -16, periodSec: 0.5, nextBeatIn: 0.21 } };
          const result = JSON.parse(masterJSON(json(input)));
          const out = lastCurve(chains.A.fadeNode)!, incoming = lastCurve(chains.B.fadeNode)!;
          expect(out).not.toBeNull(); expect(incoming).not.toBeNull();
          expect(result.envelope.hold).toBeCloseTo(out.time, 12);
          expect(result.envelope.overlap).toBeCloseTo(out.duration, 12);
          expect(result.envelope.gain.out).toEqual(plain([...out.curve]));
          expect(result.envelope.gain.in).toEqual(plain([...incoming.curve]));
          expect(result.cue).toEqual(plain(cue));
          expect(result.requestedRate).toBe(elements.A.playbackRate);
          seen.add(result.envelope.style); rates.add(result.requestedRate);
          rows.push({ name: [kind, bpm, offset].join('-'), input, expected: result });
        } finally { session.dispose(); unsubscribe(); }
      }
    }
    expect(seen).toEqual(new Set(['plainBlend', 'bassSwap', 'tailRide', 'beatCut']));
    expect([...rates].some(rate => rate < 1)).toBe(true);
    expect([...rates].some(rate => rate > 1)).toBe(true);
    if (process.env.FOLIA_MASTER_REFERENCE === '1') writeFileSync(fixtureURL, json(rows) + '\n');
    expect(JSON.parse(readFileSync(fixtureURL, 'utf8'))).toEqual(plain(rows));
  });

  it('uses adopted rate rather than requested rate, and rejects short or malformed windows', () => {
    const from = { duration: 200, lines: null, profile: makeProfile() };
    const to = { duration: 200, lines: null, profile: makeProfile({ bpm: 132, outroBpm: 132 }) };
    const plan = planForMode({ mode: 'automix', crossfadeMaxSec: 5, performance: false }, from, to, 120, 0);
    const input = { version: 1, plan, from, to, timing: { position: plan.outStart, tailRate: 1,
      appliedRate: 1 as number | null, outgoingDb: null, periodSec: null, nextBeatIn: null } };
    const first = JSON.parse(masterJSON(json({ ...input, timing: { ...input.timing, appliedRate: null } })));
    expect(first.requestedRate).toBeGreaterThan(1); expect(first.envelope).toBeNull();
    const result = JSON.parse(masterJSON(json(input)));
    expect(result.envelope.overlap).toBe(result.mediaOverlap);
    const late = JSON.parse(masterJSON(json({ ...input, timing: { ...input.timing, position: 200 } })));
    expect(late.envelope).toBeNull(); expect(late.requestedRate).toBe(1);
    for (const timing of [{ ...input.timing, appliedRate: 2 }, { ...input.timing, tailRate: 0 }, { ...input.timing, periodSec: -1 }]) {
      expect(() => masterJSON(json({ ...input, timing }))).toThrow('invalid-transition-input');
    }
    expect(JSON.parse(masterJSON(json(input)))).toEqual(result);
  });
});

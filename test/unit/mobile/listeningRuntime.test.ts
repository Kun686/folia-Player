import { describe, expect, it } from 'vitest';
import { create, createListeningSession, type ListeningSample } from '../../../src/mobile/nativeListeningRuntime';
import { resolveNeteaseListeningIdentity } from '../../../src/utils/playbackListeningIdentity';
import { PlaybackListenTracker } from '../../../src/utils/playbackListenTracker';
import type { SongResult } from '../../../src/types';
import { buildNeteaseReportParams, requireNeteaseReportSuccess } from '../../../shared/mobile/neteaseReport';

// listeningRuntime.test.ts — timed samples are synthetic; native decoding and live reports are separate evidence.
const candidate = { songKey: 'online:netease:42', mediaId: '42', totalSeconds: 240 };
const sample = (position: number, nowMs = position * 1000, extra: Partial<ListeningSample> = {}): ListeningSample =>
  ({ candidate, occurrence: 'first', position, playing: true, nowMs, ...extra });
function play(session: ReturnType<typeof createListeningSession>, start: number, seconds: number, wallStart = start * 1000) {
  for (let step = 0; step <= seconds * 4; step++) {
    expect(session.observe(sample(start + step / 4, wallStart + step * 250))).toBeNull();
  }
}
const song = (provider = 'netease', mediaId = '42', variant?: string) => ({ id: 42, sourceRef:
  { kind: 'online', providerId: provider, mediaId, ...(variant ? { variant } : {}) } }) as SongResult;

describe('native listening session using the original tracker', () => {
  it('matches the original report exactly and settles once', () => {
    const session = createListeningSession(), original = new PlaybackListenTracker(); original.start(candidate, 0);
    for (let i = 0; i <= 180; i++) { session.observe(sample(i / 4)); original.handleProgress(i / 4, i * 250); }
    expect(session.settle(45_000)).toEqual(original.settle(45_000));
    expect(session.settle(45_000)).toBeNull();
  });
  it('starts on actual playback so buffering does not freeze an unknown duration', () => {
    const session = createListeningSession();
    session.observe(sample(0, 0, { candidate: { ...candidate, totalSeconds: 0 }, playing: false }));
    for (let i = 0; i <= 160; i++) session.observe(sample(i / 4, 10_000 + i * 250,
      { candidate: { ...candidate, totalSeconds: 35 } }));
    expect(session.settle(50_000)).toEqual({ ...candidate, totalSeconds: 35, playedSeconds: 35 });
  });
  it('does not count short listens, stalls, pause gaps or large seeks', () => {
    const session = createListeningSession(); play(session, 0, 10);
    session.observe(sample(10, 50_000)); session.observe(sample(10, 50_250, { playing: false }));
    session.observe(sample(200, 60_000, { playing: false })); play(session, 200, 10, 70_000);
    session.observe(sample(230, 81_000)); expect(session.listenedSeconds()).toBe(20);
    expect(session.settle(90_000)).toBeNull();
  });
  it('an explicit discontinuity refuses even a sub-two-second seek', () => {
    const session = createListeningSession(); play(session, 0, 29);
    session.discontinuity(); session.observe(sample(30, 30_000));
    expect(session.listenedSeconds()).toBe(29); expect(session.settle(31_000)).toBeNull();
  });
  it('starts a separate occurrence for repeat-one without double reporting', () => {
    const session = createListeningSession(); play(session, 0, 40);
    expect(session.observe(sample(0, 41_000, { occurrence: 'second' }))).toMatchObject({ playedSeconds: 40 });
    expect(session.observe(sample(0.25, 41_250, { occurrence: 'second' }))).toBeNull();
    expect(session.settle(42_000)).toBeNull();
  });
  it('retains the original restart detection for an in-place replay', () => {
    const session = createListeningSession(); play(session, 0, 40);
    expect(session.observe(sample(0.5, 41_000))).toMatchObject({ playedSeconds: 40 });
    expect(session.observe(sample(0.75, 41_250))).toBeNull();
    expect(session.listenedSeconds()).toBe(0.25);
  });
  it('settles the outgoing eligible track when moving to another platform', () => {
    const session = createListeningSession(); play(session, 0, 35);
    expect(session.observe(sample(0, 36_000, { candidate: null, occurrence: 'qq' }))).toMatchObject({ mediaId: '42', playedSeconds: 35 });
    expect(session.observe(sample(1, 37_000, { candidate: null, occurrence: 'qq' }))).toBeNull();
    expect(session.settle(100_000)).toBeNull();
  });
  it('discard drops an earned listen and cannot report it later', () => {
    const session = createListeningSession(); play(session, 0, 40); session.discard();
    expect(session.settle(41_000)).toBeNull(); expect(session.listenedSeconds()).toBe(0);
  });
  it('rejects impossible speed, backwards and non-finite clocks', () => {
    const fast = createListeningSession();
    for (let i = 0; i <= 160; i++) fast.observe(sample(i / 4, i * 10));
    expect(fast.settle(2000)).toBeNull();
    for (const time of [NaN, Infinity, -1]) {
      const session = createListeningSession(); play(session, 0, 40);
      session.observe(sample(40.25, time)); expect(session.settle(50_000)).toBeNull();
    }
  });
  it('JSON bridge uses explicit provider identity, original duration cap and protocol', () => {
    const runtime = create();
    for (let i = 0; i <= 160; i++) expect(runtime.observe(JSON.stringify({ song: song(), duration: 35,
      occurrence: 'a', position: i / 4, playing: true, nowMs: i * 250 }))).toBe('null');
    expect(JSON.parse(runtime.settle(41_000))).toEqual({ ...candidate, totalSeconds: 35, playedSeconds: 35 });
    for (let i = 0; i <= 160; i++) runtime.observe(JSON.stringify({ song: { id: 42 }, duration: 240,
      occurrence: 'b', position: i / 4, playing: true, nowMs: 42_000 + i * 250 }));
    expect(runtime.settle(83_000)).toBe('null');
  });
});

describe('shared listening eligibility and report protocol', () => {
  it('excludes other providers, uploads and malformed/unsafe catalogue IDs', () => {
    for (const value of [null, song('qq'), song('netease', '42', 'cloud'), song('netease', '0'),
      ...['-1', '1.2', 'NaN', 'Infinity', '9007199254740992', '9'.repeat(128)].map(id => song('netease', id)),
      { sourceRef: { kind: 'local', mediaId: '42' } } as SongResult]) expect(resolveNeteaseListeningIdentity(value)).toBeNull();
    expect(resolveNeteaseListeningIdentity(song())).toEqual({ songKey: candidate.songKey, mediaId: '42' });
  });
  it.each([['standard', 'standard', 128], ['high', 'exhigh', 320], ['lossless', 'lossless', 999], ['hires', 'hires', 1999]] as const)
  ('preserves the original %s request and omits invented playlist origins', (quality, level, bitrate) => {
    expect(buildNeteaseReportParams({ id: 42, name: 'Song', artists: [{ name: 'A' }, { name: 'B' }] },
      { playedSeconds: 45.6, totalSeconds: 240.2, quality })).toEqual({ id: 42, name: 'Song', artist: 'A, B', time: 46, total: 240, level, bitrate });
  });
  it('requires actual success and preserves authentication failures', () => {
    expect(() => requireNeteaseReportSuccess({ code: 200 })).not.toThrow();
    for (const value of [null, {}, { code: 500 }]) expect(() => requireNeteaseReportSuccess(value)).toThrow();
    for (const code of [301, 401, 403]) {
      try { requireNeteaseReportSuccess({ code }); throw Error('unexpected-success'); }
      catch (error) { expect(error).toMatchObject({ code: 'auth-required', providerId: 'netease' }); }
    }
  });
});

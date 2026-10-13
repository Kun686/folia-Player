import { describe, expect, it } from 'vitest';
import { createNavidrome } from '../../../src/mobile/nativeListeningRuntime';
import { NavidromeScrobbleSessionTracker, type NavidromeScrobbleReport } from '../../../src/utils/navidromeScrobble';

// navidromeScrobbleRuntime.test.ts — original threshold and dedupe parity across native playback boundaries.
describe('native Navidrome scrobble runtime', () => {
  it('matches the original tracker for start, resume, forward seek and repeated snapshots', () => {
    const runtime = createNavidrome(), original: NavidromeScrobbleReport[] = [];
    const tracker = new NavidromeScrobbleSessionTracker(report => original.push(report));
    tracker.startSession('song', 180000);
    const actual: NavidromeScrobbleReport[] = [];
    for (const position of [0, 0, 15, 15, 65, 90, 0, 60]) {
      tracker.handlePlaybackStart(position);
      actual.push(...JSON.parse(runtime.observe('song', 180000, position, true)));
    }
    expect(actual).toEqual(original);
    expect(actual.map(x => x.kind)).toEqual(['now-playing', 'submission']);
  });
  it('does not start or submit while paused or buffered', () => {
    const runtime = createNavidrome();
    expect(JSON.parse(runtime.observe('song', 0, 0, false))).toEqual([]);
    expect(JSON.parse(runtime.observe('song', 20000, 0, true)).map((r: any) => r.kind)).toEqual(['now-playing']);
    expect(JSON.parse(runtime.observe('song', 20000, 15, false))).toEqual([]);
    expect(JSON.parse(runtime.observe('song', 20000, 15, true)).map((r: any) => r.kind)).toEqual(['submission']);
  });
  it('settles final EOF progress and lets repeat-one create a fresh session', () => {
    const runtime = createNavidrome();
    runtime.observe('song', 2000, 0, true);
    expect(JSON.parse(runtime.finish(2)).map((r: any) => r.kind)).toEqual(['submission']);
    expect(JSON.parse(runtime.finish(2))).toEqual([]);
    expect(JSON.parse(runtime.observe('song', 2000, 0, true))[0].sessionId).toBe(2);
  });
  it('manual selection does not pretend the outgoing song reached EOF', () => {
    const runtime = createNavidrome(); runtime.observe('first', 180000, 1, true);
    expect(JSON.parse(runtime.finish())).toEqual([]);
    expect(JSON.parse(runtime.observe('second', 180000, 0, true))[0].songId).toBe('second');
    runtime.clear(); expect(JSON.parse(runtime.finish(999))).toEqual([]);
  });
  it('keeps the original sixty-second fallback and rejects invalid progress', () => {
    const runtime = createNavidrome(); runtime.observe('song', 0, 0, true);
    expect(JSON.parse(runtime.observe('song', 0, 59.9, true))).toEqual([]);
    expect(JSON.parse(runtime.observe('song', 0, 60, true))[0].kind).toBe('submission');
    expect(JSON.parse(runtime.observe('song', 0, NaN, true))).toEqual([]);
    expect(JSON.parse(runtime.finish(999))).toEqual([]);
  });
});
